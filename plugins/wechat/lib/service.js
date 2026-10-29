/**
 * WeChat iLink control plane for Chat Connect.
 *
 * The service owns multiple WeChat bot accounts, their QR login sessions,
 * long-poll runtimes, and the per-account DSH agent bridge. It exposes a small
 * JSON API on the DSH Web host so the injected panel can manage everything
 * without a separate process.
 */
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import QRCode from 'qrcode'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { joinAssistantStreamText } from '@deepseek-ai/dsh-llm/assistant-stream'
import { IlinkClient } from './ilink/client.js'
import { WECHAT_UI_JS } from './ui.js'
import { WechatAccountRuntime } from './ilink/runtime.js'
import { WechatMediaStore } from './media.js'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import {
  createAccount,
  loadAccounts,
  loadCredentials,
  saveAccounts,
  saveCredentials,
} from './ilink/accounts.js'

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'
const LOGIN_TTL_MS = 180_000
const LOGIN_POLL_MS = 1_500

function delay(ms) {
  return new Promise((resolveTimer) => setTimeout(resolveTimer, ms))
}

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(payload)
}

async function readJson(req, limit = 65_536) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function publicLogin(login) {
  if (!login) return null
  return {
    status: login.status,
    image: login.image,
    content: login.content,
    expiresAt: login.expiresAt,
    error: login.error,
  }
}

export class WechatService {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = {
      dataDir: resolve(config.dataDir || './.data'),
      baseUrl: config.baseUrl || DEFAULT_BASE_URL,
      provider: config.provider || '',
      model: config.model || '',
      autoReply: config.autoReply !== false,
      permissionPreset: config.permissionPreset || 'danger-full-access',
      agentPreset: config.agentPreset || '',
      workspaceRoot: config.workspaceRoot || '',
      cdnBaseUrl: config.cdnBaseUrl || 'https://novac2c.cdn.weixin.qq.com/c2c',
      mediaMaxBytes: config.mediaMaxBytes ?? 100 * 1024 * 1024,
      mediaTimeoutMs: config.mediaTimeoutMs ?? 60_000,
    }
    this.defaultWorkspaceRoot = resolve(
      config.workspaceRoot || join(this.config.dataDir, 'wechat', 'workspaces'),
    )
    this.workspaceRoot = this.defaultWorkspaceRoot
    this.settingsPath = join(this.config.dataDir, 'wechat', 'settings.json')
    this.token = randomUUID()
    this.accounts = new Map()
    this.sessionToAccount = new Map()
    this.skillProviders = new Map()
    this.skillDisposer = null
    this.picking = false
    this.disposers = []
    this.disposed = false
    this.loggedIn = 0
  }

  async loadSettings() {
    try {
      const parsed = JSON.parse(await readFile(this.settingsPath, 'utf8'))
      if (typeof parsed.workspaceRoot === 'string' && isAbsolute(parsed.workspaceRoot)) {
        this.workspaceRoot = resolve(parsed.workspaceRoot)
      }
    } catch {
      // No saved settings yet: the bundled default applies.
    }
  }

  async saveSettings() {
    await mkdir(join(this.config.dataDir, 'wechat'), { recursive: true, mode: 0o700 })
    await writeFile(
      this.settingsPath,
      `${JSON.stringify({ workspaceRoot: this.workspaceRoot }, null, 2)}\n`,
      { mode: 0o600 },
    )
  }

  async resolveWorkspace(input) {
    let value = String(input ?? '').trim()
    if (!value) throw new Error('工作区路径不能为空')
    if (value === '~') value = homedir()
    else if (value.startsWith('~/') || value.startsWith('~\\')) {
      value = join(homedir(), value.slice(2))
    }
    if (!isAbsolute(value)) throw new Error('请填写绝对路径（例如 /Users/you/WeChat）')
    const absolute = resolve(value)
    await mkdir(absolute, { recursive: true, mode: 0o700 })
    const info = await stat(absolute)
    if (!info.isDirectory()) throw new Error('该路径不是文件夹')
    return absolute
  }

  workspaceForAccount(account) {
    if (typeof account.workspace === 'string' && isAbsolute(account.workspace)) {
      return resolve(account.workspace)
    }
    return join(this.workspaceRoot, account.id)
  }

  defaultAccountWorkspace(accountId) {
    return join(this.defaultWorkspaceRoot, accountId)
  }

  sessionIdFor(accountId, workspace) {
    if (resolve(workspace) === resolve(this.defaultAccountWorkspace(accountId))) {
      return `wechat-${accountId}`
    }
    const digest = createHash('sha256').update(resolve(workspace)).digest('hex').slice(0, 10)
    return `wechat-${accountId}-${digest}`
  }

  async install() {
    this.disposers.push(
      this.ctx.webServer.register({
        kind: 'prefix',
        path: '/wechat-api',
        handler: (req, res) => this.handleApi(req, res),
      }),
    )
    this.disposers.push(
      this.ctx.webServer.register({
        kind: 'exact',
        path: '/wechat-ui.js',
        handler: (req, res) => {
          res.statusCode = 200
          res.setHeader('content-type', 'text/javascript; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(WECHAT_UI_JS)
        },
      }),
    )
    this.disposers.push(
      this.ctx.on('webserver/index-inject', (table) => {
        table.push({
          kind: 'script',
          placement: 'body',
          text: `window.__CHAT_CONNECT_WECHAT__ = ${JSON.stringify({
            base: '/wechat-api',
            token: this.token,
          })}`,
        })
        table.push({
          kind: 'html',
          placement: 'head',
          html:
            `<meta name="chat-connect-wechat-token" content="${this.token}">` +
            `<meta name="chat-connect-wechat-lang" content="${process.env.CHAT_CONNECT_WECHAT_LANG ?? ''}">`,
        })
        table.push({
          kind: 'html',
          placement: 'head',
          html:
            '<style id="chat-connect-wechat-session-style">' +
            'html[data-chat-connect-wechat-session] [data-composer-seat],' +
            'html[data-chat-connect-wechat-session] [data-conversation-region="composer"]{display:none!important}' +
            '</style>',
        })
        table.push({ kind: 'script-src', placement: 'body', src: '/wechat-ui.js' })
      }),
    )
    this.disposers.push(
      this.ctx.on('session/event', (session, event) => this.onSessionEvent(session, event)),
    )
    this.disposers.push(
      this.ctx.on('approval/request', (request, next) => {
        const session = request.agent.session
        const accountId = this.sessionToAccount.get(String(session.id))
        const cwd = session.meta?.cwd
        if (!accountId && !this.isWechatWorkspace(cwd)) return next()
        this.ctx.logger.warn(
          `微信会话自动批准权限请求：${request.toolName}${request.reason ? `（${request.reason}）` : ''}`,
        )
        return Promise.resolve('allowed-once')
      }, { prepend: true }),
    )
    await this.loadSettings()
    await this.loadAccounts()
    this.installSkills()
    this.ctx.logger.info(`Chat Connect 微信插件已加载（${this.accounts.size} 个账号）`)
  }

  async loadAccounts() {
    const accounts = await loadAccounts(this.config.dataDir)
    for (const account of accounts) {
      const credentials = await loadCredentials(this.config.dataDir, account.id)
      this.accounts.set(account.id, {
        account,
        credentials,
        status: 'idle',
        login: null,
        runtime: null,
        controller: null,
        messageCount: 0,
        lastMessageAt: null,
        lastError: null,
        queue: [],
        busy: false,
        handle: null,
        pendingText: undefined,
        lastIncoming: undefined,
        sessionId: this.sessionIdFor(account.id, this.workspaceForAccount(account)),
      })
      await this.ensureSkillsDir(account.id).catch(() => undefined)
    }
  }

  async dispose() {
    this.disposed = true
    for (const state of this.accounts.values()) {
      await this.stopAccount(state).catch(() => undefined)
    }
    for (const provider of this.skillProviders.values()) {
      await provider.dispose().catch(() => undefined)
    }
    this.skillProviders.clear()
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose()
      } catch {
        // The owning fiber may already have torn the route down.
      }
    }
    this.accounts.clear()
    this.sessionToAccount.clear()
  }

  publicState() {
    const accounts = [...this.accounts.values()].map((state) => ({
      id: state.account.id,
      label: state.account.label,
      status: state.status,
      hasCredentials: Boolean(state.credentials),
      messageCount: state.messageCount,
      lastMessageAt: state.lastMessageAt,
      lastError: state.lastError,
      workspace: this.workspaceForAccount(state.account),
      skillPath: join(this.workspaceForAccount(state.account), 'skills'),
      customWorkspace: Boolean(state.account.workspace),
      login: publicLogin(state.login),
      sessionId: state.sessionId,
    }))
    return {
      accounts,
      online: accounts.filter((account) => account.status === 'online').length,
      settings: {
        workspaceRoot: this.workspaceRoot,
        defaultWorkspaceRoot: this.defaultWorkspaceRoot,
      },
    }
  }

  find(accountId) {
    return this.accounts.get(accountId)
  }

  async addAccount(label) {
    const name = (label || '').trim() || `微信账号 ${this.accounts.size + 1}`
    const account = await createAccount(this.config.dataDir, name)
    const credentials = await loadCredentials(this.config.dataDir, account.id)
    this.accounts.set(account.id, {
      account,
      credentials,
      status: 'idle',
      login: null,
      runtime: null,
      controller: null,
      messageCount: 0,
      lastMessageAt: null,
      lastError: null,
      queue: [],
      busy: false,
      handle: null,
      pendingText: undefined,
      lastIncoming: undefined,
      sessionId: this.sessionIdFor(account.id, this.workspaceForAccount(account)),
    })
    await this.ensureSkillsDir(account.id).catch(() => undefined)
    return this.publicState()
  }

  async removeAccount(accountId) {
    const state = this.accounts.get(accountId)
    if (!state) throw new Error('账号不存在')
    await this.stopAccount(state)
    const accounts = (await loadAccounts(this.config.dataDir)).filter(
      (account) => account.id !== accountId,
    )
    await saveAccounts(this.config.dataDir, accounts)
    await rm(join(this.config.dataDir, 'wechat', 'accounts', accountId), {
      recursive: true,
      force: true,
    })
    this.accounts.delete(accountId)
    return this.publicState()
  }

  async updateAccount(accountId, patch) {
    const state = this.accounts.get(accountId)
    if (!state) throw new Error('账号不存在')
    const hasLabel = Object.prototype.hasOwnProperty.call(patch, 'label')
    const hasWorkspace = Object.prototype.hasOwnProperty.call(patch, 'workspace')
    let nextLabel
    if (hasLabel) {
      nextLabel = String(patch.label ?? '').trim()
      if (!nextLabel) throw new Error('账号备注不能为空')
    }
    let nextWorkspace
    if (hasWorkspace) {
      nextWorkspace =
        patch.workspace === '' || patch.workspace === null
          ? undefined
          : await this.resolveWorkspace(patch.workspace)
    }

    const before = this.workspaceForAccount(state.account)
    if (hasLabel) state.account.label = nextLabel
    if (hasWorkspace) {
      if (nextWorkspace === undefined) delete state.account.workspace
      else state.account.workspace = nextWorkspace
    }
    const after = this.workspaceForAccount(state.account)
    if (hasWorkspace && resolve(after) !== resolve(before)) {
      await this.stopRuntime(state)
      state.sessionId = this.sessionIdFor(accountId, after)
      state.status = 'idle'
      state.lastError = null
      await this.ensureSkillsDir(accountId).catch(() => undefined)
    }

    const accounts = await loadAccounts(this.config.dataDir)
    const target = accounts.find((account) => account.id === accountId)
    if (target) {
      if (hasLabel) target.label = nextLabel
      if (hasWorkspace) {
        if (nextWorkspace === undefined) delete target.workspace
        else target.workspace = nextWorkspace
      }
    }
    await saveAccounts(this.config.dataDir, accounts)
    return this.publicState()
  }

  async updateWorkspaceRoot(input) {
    const next =
      input === '' || input === null || input === undefined
        ? this.defaultWorkspaceRoot
        : await this.resolveWorkspace(input)
    if (next === this.defaultWorkspaceRoot) {
      await mkdir(next, { recursive: true, mode: 0o700 })
    }

    const before = new Map()
    for (const [accountId, state] of this.accounts) {
      if (!state.account.workspace) {
        before.set(accountId, resolve(this.workspaceForAccount(state.account)))
      }
    }
    this.workspaceRoot = next
    await this.saveSettings()

    for (const [accountId, state] of this.accounts) {
      if (state.account.workspace) continue
      const after = resolve(this.workspaceForAccount(state.account))
      if (before.get(accountId) === after) continue
      await this.stopRuntime(state)
      state.sessionId = this.sessionIdFor(accountId, after)
      state.status = 'idle'
      state.lastError = null
      await this.ensureSkillsDir(accountId).catch(() => undefined)
    }
    return this.publicState()
  }

  async startLogin(accountId) {
    const state = this.accounts.get(accountId)
    if (!state) throw new Error('账号不存在')
    if (state.status === 'online' || state.status === 'connecting') {
      throw new Error('账号已连接，请先断开再重新扫码')
    }
    this.clearLogin(state)
    const client = new IlinkClient({ baseUrl: this.config.baseUrl, requestTimeoutMs: 30_000 })
    const qr = await client.getBotQrcode()
    const content = qr.qrcode_img_content || qr.qrcode
    const image = await QRCode.toDataURL(content, {
      width: 280,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
    state.login = {
      client,
      qrcode: qr.qrcode,
      content,
      image,
      status: 'wait',
      error: null,
      expiresAt: Date.now() + LOGIN_TTL_MS,
    }
    state.status = 'waiting_qr'
    state.lastError = null
    void this.pollLogin(accountId, state, state.login)
    return this.publicState()
  }

  clearLogin(state) {
    if (state.login?.timer !== undefined) clearTimeout(state.login.timer)
    state.login = null
  }

  async pollLogin(accountId, state, login) {
    while (!this.disposed && state.login === login) {
      if (Date.now() > login.expiresAt) {
        login.status = 'expired'
        login.error = '二维码已过期，请重新扫码'
        state.status = 'error'
        state.lastError = login.error
        return
      }
      try {
        const result = await login.client.getQrcodeStatus(login.qrcode)
        const status = result.status
        if (status === 'scaned') {
          login.status = 'scaned'
          state.status = 'scaned'
        } else if (status === 'confirmed') {
          if (!result.bot_token) throw new Error('扫码已确认，但 iLink 没有返回 bot_token')
          login.status = 'confirmed'
          state.credentials = {
            botToken: result.bot_token,
            baseUrl: result.baseurl || this.config.baseUrl,
            ilinkBotId: result.ilink_bot_id,
            ilinkUserId: result.ilink_user_id,
          }
          await saveCredentials(this.config.dataDir, accountId, state.credentials)
          state.login = null
          state.status = 'connecting'
          await this.connect(accountId)
          return
        } else if (status === 'expired') {
          login.status = 'expired'
          login.error = '二维码已过期，请重新扫码'
          state.status = 'error'
          state.lastError = login.error
          return
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // iLink can hold the status request until the user scans. A request
        // timeout is a normal poll boundary, not a failed login.
        if (/超时|timed?\s*out/i.test(message)) {
          await delay(LOGIN_POLL_MS)
          continue
        }
        login.status = 'error'
        login.error = message
        state.status = 'error'
        state.lastError = message
        return
      }
      await delay(LOGIN_POLL_MS)
    }
  }

  async connect(accountId) {
    const state = this.accounts.get(accountId)
    if (!state) throw new Error('账号不存在')
    if (!state.credentials) {
      state.credentials = await loadCredentials(this.config.dataDir, accountId)
    }
    if (!state.credentials) return this.startLogin(accountId)
    await this.stopRuntime(state)
    const controller = new AbortController()
    const runtime = new WechatAccountRuntime({
      accountId,
      baseUrl: state.credentials.baseUrl,
      botToken: state.credentials.botToken,
      statePath: join(this.config.dataDir, 'wechat', 'accounts', accountId, 'state.json'),
      logger: this.ctx.logger,
      pollTimeoutMs: 35_000,
    })
    state.controller = controller
    state.runtime = runtime
    state.status = 'connecting'
    state.lastError = null
    try {
      await runtime.start((message) => this.onMessage(accountId, message), controller.signal)
      state.status = 'online'
      this.sessionToAccount.set(state.sessionId, accountId)
      this.ctx.logger.info(`微信账号已连接: ${state.account.label}`)
    } catch (error) {
      state.status = 'error'
      state.lastError = error instanceof Error ? error.message : String(error)
      await this.stopRuntime(state)
    }
    return this.publicState()
  }

  async disconnect(accountId) {
    const state = this.accounts.get(accountId)
    if (!state) throw new Error('账号不存在')
    await this.stopRuntime(state)
    state.status = 'idle'
    state.lastError = null
    return this.publicState()
  }

  async stopRuntime(state) {
    this.clearLogin(state)
    if (state.controller) state.controller.abort()
    if (state.runtime) await state.runtime.stop().catch(() => undefined)
    state.controller = null
    state.runtime = null
    state.busy = false
    state.queue.length = 0
    state.pendingText = undefined
    state.lastIncoming = undefined
    if (state.handle) {
      await state.handle.dispose().catch(() => undefined)
      state.handle = null
    }
    if (state.status === 'online' || state.status === 'connecting' || state.status === 'scaned' || state.status === 'waiting_qr') {
      state.status = 'idle'
    }
  }

  async stopAccount(state) {
    await this.stopRuntime(state)
  }

  onMessage(accountId, message) {
    const state = this.accounts.get(accountId)
    if (!state) return
    state.messageCount += 1
    state.lastMessageAt = new Date().toISOString()
    state.lastError = null
    if (!this.config.autoReply) return
    state.queue.push(message)
    void this.drain(accountId)
  }

  async drain(accountId) {
    const state = this.accounts.get(accountId)
    if (!state || state.busy) return
    const message = state.queue.shift()
    if (!message) return
    state.busy = true
    state.lastIncoming = message
    state.pendingText = undefined
    try {
      const content = await this.buildContent(accountId, message)
      const agent = await this.ensureAgent(accountId, state)
      agent.followup(createUserMessage({ content, source: { kind: 'user' } }))
    } catch (error) {
      state.busy = false
      state.lastError = error instanceof Error ? error.message : String(error)
      this.ctx.logger.error(`微信消息转 Agent 失败: ${state.lastError}`)
      void this.drain(accountId)
    }
  }

  onSessionEvent(session, event) {
    const accountId = this.sessionToAccount.get(String(session.id))
    if (!accountId) return
    const state = this.accounts.get(accountId)
    if (!state) return
    if (event.type === 'assistant/message') {
      try {
        const text = joinAssistantStreamText(event.data.stream).trim()
        if (text) state.pendingText = text
      } catch {
        // Ignore malformed stream fragments; a later event may carry text.
      }
      return
    }
    if (event.type === 'turn/end') {
      const reason = event.data?.reason
      if (reason && reason.kind !== 'completed') {
        state.pendingText = undefined
        state.lastIncoming = undefined
        state.busy = false
        if (reason.kind === 'error') {
          state.lastError = 'Agent 请求失败，请检查模型配置或服务日志'
        }
        void this.drain(accountId)
        return
      }
      void this.finishTurn(accountId)
    }
  }

  async finishTurn(accountId) {
    const state = this.accounts.get(accountId)
    if (!state) return
    const text = state.pendingText
    const incoming = state.lastIncoming
    state.pendingText = undefined
    state.lastIncoming = undefined
    state.busy = false
    if (text && incoming && !incoming.raw?.dev && state.runtime) {
      try {
        await state.runtime.sendReply(incoming.raw, text.slice(0, 4000))
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : String(error)
        this.ctx.logger.error(`微信回复发送失败: ${state.lastError}`)
      }
    }
    void this.drain(accountId)
  }

  workspacePath(accountId) {
    const state = this.accounts.get(accountId)
    if (!state) throw new Error('账号不存在')
    return this.workspaceForAccount(state.account)
  }

  skillPath(accountId) {
    return join(this.workspacePath(accountId), 'skills')
  }

  async ensureSkillsDir(accountId) {
    const dir = this.skillPath(accountId)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    return dir
  }

  isWechatWorkspace(cwd) {
    if (!cwd) return false
    const target = resolve(cwd)
    for (const state of this.accounts.values()) {
      if (resolve(this.workspaceForAccount(state.account)) === target) return true
    }
    return false
  }

  installSkills() {
    this.skillDisposer = this.ctx.skills.registerProvider((control) => {
      const disposeProviders = () => {
        for (const provider of this.skillProviders.values()) {
          void provider.dispose()
        }
        this.skillProviders.clear()
      }
      control.signal.addEventListener('abort', disposeProviders, { once: true })
      const service = this
      return {
        name: 'wechat-skills',
        async list(options) {
          if (!service.isWechatWorkspace(options.cwd)) return []
          return service.skillProviderFor(options.cwd, control).list(options)
        },
        async get(candidate, options) {
          if (!service.isWechatWorkspace(options.cwd)) return undefined
          return service.skillProviderFor(options.cwd, control).get(candidate, options)
        },
      }
    })
    this.disposers.push(this.skillDisposer)
  }

  skillProviderFor(cwd, control) {
    const key = resolve(cwd)
    let provider = this.skillProviders.get(key)
    if (!provider) {
      provider = new FileSystemSkillProvider(this.ctx, control, {
        providerName: 'wechat-skills',
        includeDefaultRoots: false,
        customSkillDirs: [join(key, 'skills')],
        watch: true,
        watchUsePolling: false,
      })
      this.skillProviders.set(key, provider)
    }
    return provider
  }

  async openSkills(accountId) {
    const dir = await this.ensureSkillsDir(accountId)
    const command =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
    const child = spawn(command, [dir], { detached: true, stdio: 'ignore' })
    child.on('error', (error) => {
      this.ctx.logger.warn(`打开技能文件夹失败: ${error.message}`)
    })
    child.unref()
    return dir
  }

  async listSkills(accountId) {
    const cwd = this.workspacePath(accountId)
    const skills = await this.ctx.skills.list({ cwd })
    return skills
      .filter((skill) => skill.provider === 'wechat-skills')
      .map((skill) => ({
        name: skill.name,
        description: skill.description,
        source: skill.source,
      }))
  }

  async pickDirectory(req, res) {
    if (this.picking) {
      json(res, 409, { error: '已有文件夹选择框打开' })
      return
    }
    const capability = this.ctx.directoryPicker?.capability?.()
    if (!capability || capability.kind !== 'native') {
      json(res, 409, {
        error: '当前 DSH 目录选择器不是本机原生模式，请手动输入绝对路径',
        kind: capability?.kind ?? 'none',
      })
      return
    }
    this.picking = true
    const controller = new AbortController()
    const abort = () => controller.abort()
    req.once('aborted', abort)
    res.once('close', abort)
    try {
      const selected = await capability.pick(controller.signal)
      if (!res.writableEnded && !res.destroyed) json(res, 200, { path: selected ?? null })
    } catch (error) {
      if (res.writableEnded || res.destroyed) return
      if (controller.signal.aborted) json(res, 200, { path: null })
      else json(res, 400, { error: error instanceof Error ? error.message : String(error) })
    } finally {
      this.picking = false
      req.off('aborted', abort)
      res.off('close', abort)
    }
  }

  async buildContent(accountId, message) {
    const sender = message.chatType === 'group' ? '群聊' : '私聊'
    const pieces = [`来自微信${sender}（发送者 ${message.senderId}）`]
    let messageText = message.text
    if (!messageText) {
      messageText = (message.raw?.item_list ?? [])
        .flatMap((item) => [
          typeof item.text_item?.text === 'string' ? item.text_item.text : '',
          typeof item.voice_item?.text === 'string' ? item.voice_item.text : '',
        ])
        .filter(Boolean)
        .join('\n')
        .trim()
    }
    if (messageText) pieces.push(messageText)
    const content = [{ type: 'text', text: pieces.join('\n') }]
    const mediaStore = new WechatMediaStore({
      dir: join(this.workspacePath(accountId), 'media'),
      cdnBaseUrl: this.config.cdnBaseUrl,
      maxBytes: this.config.mediaMaxBytes,
      timeoutMs: this.config.mediaTimeoutMs,
    })
    const media = await mediaStore.downloadAll(message.raw)
    for (const item of media) {
      const label = item.kind === 'image' ? '图片' : item.kind === 'file' ? '文件' : item.kind === 'video' ? '视频' : '语音'
      if (item.error) {
        content.push({ type: 'text', text: `[${label}处理失败] ${item.error}` })
        continue
      }
      if (!item.data) continue
      if (item.kind === 'image' && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(item.mimeType)) {
        try {
          const attachment = await this.ctx.attachments.saveImage({
            data: item.data,
            mediaType: item.mimeType,
            name: item.fileName,
          })
          content.push({ type: 'text', text: `[图片 ${item.fileName ?? ''}]` })
          content.push({ type: 'image', attachment })
          continue
        } catch (error) {
          content.push({
            type: 'text',
            text: `[图片 ${item.fileName ?? ''}] 未作为图片附件接收（${error instanceof Error ? error.message : String(error)}），已保存到 ${item.localPath}`,
          })
        }
      }
      try {
        const attachment = await this.ctx.attachments.saveFile({
          data: item.data,
          name: item.fileName || `${item.kind}-${Date.now()}`,
        })
        const note =
          item.kind === 'voice'
            ? `[语音 ${item.fileName ?? ''}] 微信没有提供转写，音频已保存为文件；当前不能自动识别音频内容。`
            : `[${label} ${item.fileName ?? ''}]`
        content.push({ type: 'text', text: note })
        content.push({ type: 'file', attachment })
      } catch (error) {
        content.push({
          type: 'text',
          text: `[${label} ${item.fileName ?? ''}] 已保存到 ${item.localPath}，但无法作为附件交给 Agent：${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }
    if (content.length === 1 && !message.text && media.length === 0) {
      content.push({ type: 'text', text: '[收到一条暂不支持的消息类型]' })
    }
    return content
  }

  async ensureAgent(accountId, state) {
    if (state.handle) return state.handle.agent
    const workspace = this.workspacePath(accountId)
    await mkdir(workspace, { recursive: true, mode: 0o700 })
    await this.ensureSkillsDir(accountId).catch(() => undefined)
    let agentOptions
    if (this.config.provider && this.config.model) {
      agentOptions = { provider: this.config.provider, model: this.config.model }
    } else {
      const selection = this.ctx.agentDefaultModel?.currentSelection?.()
      if (selection?.provider && selection?.model) {
        agentOptions = {
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
        }
      }
    }

    const presetId = this.config.agentPreset || this.ctx.agentPresets.defaultId
    const preset = await this.ctx.agentPresets.resolve(presetId)
    const presetScope = await this.ctx.agentPresets.acquireScope(preset.id)
    const setup = async (agentCtx) => {
      await this.ctx.agentPresets.mount(agentCtx, preset.id)
    }
    try {
      try {
        state.handle = await this.ctx.agents.resume({
          resumeSessionId: state.sessionId,
          ...(agentOptions === undefined ? {} : { agentOptions }),
          setup,
        })
      } catch {
        state.handle = await this.ctx.agents.create({
          sessionId: state.sessionId,
          meta: { cwd: workspace, agentPreset: preset.id },
          ...(agentOptions === undefined ? {} : { agentOptions }),
          setup,
        })
      }
    } finally {
      await presetScope[Symbol.asyncDispose]()
    }
    try {
      if (this.config.permissionPreset) {
        this.ctx.permissionPresets.set(state.handle.agent.session, this.config.permissionPreset)
        // The full-access preset pins approval=never, which would reject any
        // ask that still reaches the approval seam. WeChat sessions instead
        // stay on full sandbox and auto-approve through the listener above.
        setApprovalPolicy(state.handle.agent.session, 'ask')
      }
    } catch (error) {
      this.ctx.logger.warn(
        `微信会话设置权限预设失败（${this.config.permissionPreset}）: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    this.sessionToAccount.set(state.sessionId, accountId)
    return state.handle.agent
  }

  authorized(req) {
    return req.headers['x-chat-connect-token'] === this.token
  }

  async handleApi(req, res) {
    if (!this.authorized(req)) {
      json(res, 401, { error: 'unauthorized' })
      return
    }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const path = url.pathname.slice('/wechat-api'.length) || '/'
      const method = req.method ?? 'GET'

      if (method === 'GET' && (path === '/state' || path === '/')) {
        json(res, 200, this.publicState())
        return
      }
      if (method === 'GET' && path === '/health') {
        json(res, 200, { ok: true, accounts: this.accounts.size })
        return
      }
      if (method === 'GET' && path === '/sessions') {
        json(res, 200, {
          sessionIds: [...this.accounts.values()].map((state) => state.sessionId),
        })
        return
      }
      if (method === 'GET' && path === '/picker') {
        const capability = this.ctx.directoryPicker?.capability?.()
        json(res, 200, { kind: capability?.kind ?? 'none', native: capability?.kind === 'native' })
        return
      }
      if (method === 'POST' && path === '/pick-directory') {
        await this.pickDirectory(req, res)
        return
      }
      if (method === 'GET' && path === '/settings') {
        json(res, 200, {
          workspaceRoot: this.workspaceRoot,
          defaultWorkspaceRoot: this.defaultWorkspaceRoot,
        })
        return
      }
      if (method === 'PUT' && path === '/settings') {
        const body = await readJson(req)
        json(res, 200, await this.updateWorkspaceRoot(body.workspaceRoot))
        return
      }
      if (process.env.CHAT_CONNECT_WECHAT_DEV === '1' && method === 'POST' && path === '/dev/message') {
        const body = await readJson(req)
        const state = this.find(body.accountId)
        if (!state) throw new Error('账号不存在')
        state.status = 'online'
        const raw = {
          dev: true,
          context_token: 'dev',
          from_user_id: 'dev',
          to_user_id: 'bot',
          message_id: Date.now(),
          create_time_ms: Date.now(),
        }
        if (Array.isArray(body.itemList)) {
          raw.item_list = body.itemList
        } else {
          raw.item_list = [{ type: 1, text_item: { text: String(body.text || '你好') } }]
        }
        this.onMessage(body.accountId, {
          text: String(body.text || ''),
          senderId: 'dev',
          chatType: 'single',
          chatId: 'dev',
          raw,
        })
        json(res, 200, this.publicState())
        return
      }

      const addMatch = /^\/accounts$/.exec(path)
      if (method === 'POST' && addMatch) {
        const body = await readJson(req)
        json(res, 200, await this.addAccount(body.label))
        return
      }

      const openSkillsMatch = /^\/accounts\/([^/]+)\/open-skills$/.exec(path)
      if (method === 'POST' && openSkillsMatch) {
        const accountId = decodeURIComponent(openSkillsMatch[1])
        json(res, 200, { path: await this.openSkills(accountId) })
        return
      }
      const skillsMatch = /^\/accounts\/([^/]+)\/skills$/.exec(path)
      if (method === 'GET' && skillsMatch) {
        const accountId = decodeURIComponent(skillsMatch[1])
        json(res, 200, { skills: await this.listSkills(accountId) })
        return
      }

      const accountMatch = /^\/accounts\/([^/]+)$/.exec(path)
      if (accountMatch) {
        const accountId = decodeURIComponent(accountMatch[1])
        if (method === 'DELETE') {
          json(res, 200, await this.removeAccount(accountId))
          return
        }
        if (method === 'PATCH' || method === 'PUT') {
          const body = await readJson(req)
          json(res, 200, await this.updateAccount(accountId, body))
          return
        }
      }

      const actionMatch = /^\/accounts\/([^/]+)\/(login|connect|disconnect)$/.exec(path)
      if (actionMatch && method === 'POST') {
        const accountId = decodeURIComponent(actionMatch[1])
        const action = actionMatch[2]
        if (action === 'login') json(res, 200, await this.startLogin(accountId))
        else if (action === 'connect') json(res, 200, await this.connect(accountId))
        else json(res, 200, await this.disconnect(accountId))
        return
      }

      const loginMatch = /^\/accounts\/([^/]+)\/login$/.exec(path)
      if (loginMatch && method === 'GET') {
        const accountId = decodeURIComponent(loginMatch[1])
        const state = this.find(accountId)
        if (!state) throw new Error('账号不存在')
        json(res, 200, publicLogin(state.login) ?? { status: 'none' })
        return
      }

      json(res, 404, { error: 'not found' })
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}
