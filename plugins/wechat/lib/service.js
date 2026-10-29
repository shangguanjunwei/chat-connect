/**
 * WeChat iLink control plane for Chat Connect.
 *
 * The service owns multiple WeChat bot accounts, their QR login sessions,
 * long-poll runtimes, and the per-account DSH agent bridge. It exposes a small
 * JSON API on the DSH Web host so the injected panel can manage everything
 * without a separate process.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import QRCode from 'qrcode'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { joinAssistantStreamText } from '@deepseek-ai/dsh-llm/assistant-stream'
import { IlinkClient } from './ilink/client.js'
import { WECHAT_UI_JS } from './ui.js'
import { WechatAccountRuntime } from './ilink/runtime.js'
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
      provider: config.provider || 'deepseek-official',
      model: config.model || 'deepseek-flash',
      autoReply: config.autoReply !== false,
      workspaceRoot: config.workspaceRoot || '',
    }
    this.token = randomUUID()
    this.accounts = new Map()
    this.sessionToAccount = new Map()
    this.disposers = []
    this.disposed = false
    this.loggedIn = 0
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
        table.push({ kind: 'script-src', placement: 'body', src: '/wechat-ui.js' })
      }),
    )
    this.disposers.push(
      this.ctx.on('session/event', (session, event) => this.onSessionEvent(session, event)),
    )
    await this.loadAccounts()
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
        sessionId: `wechat-${account.id}`,
      })
    }
  }

  async dispose() {
    this.disposed = true
    for (const state of this.accounts.values()) {
      await this.stopAccount(state).catch(() => undefined)
    }
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
      login: publicLogin(state.login),
    }))
    return {
      accounts,
      online: accounts.filter((account) => account.status === 'online').length,
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
      sessionId: `wechat-${account.id}`,
    })
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

  async renameAccount(accountId, label) {
    const state = this.accounts.get(accountId)
    if (!state) throw new Error('账号不存在')
    const name = (label || '').trim()
    if (!name) throw new Error('账号备注不能为空')
    state.account.label = name
    const accounts = await loadAccounts(this.config.dataDir)
    const target = accounts.find((account) => account.id === accountId)
    if (target) target.label = name
    await saveAccounts(this.config.dataDir, accounts)
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
      const agent = await this.ensureAgent(accountId, state)
      const text = `来自微信${message.chatType === 'group' ? '群聊' : '私聊'}（发送者 ${message.senderId}）：\n${message.text}`
      agent.followup(
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        }),
      )
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

  async ensureAgent(accountId, state) {
    if (state.handle) return state.handle.agent
    const workspace = join(
      this.config.workspaceRoot || join(this.config.dataDir, 'wechat', 'workspaces'),
      accountId,
    )
    await mkdir(workspace, { recursive: true, mode: 0o700 })
    const agentOptions =
      this.config.provider && this.config.model
        ? { provider: this.config.provider, model: this.config.model }
        : undefined
    try {
      state.handle = await this.ctx.agents.resume({
        resumeSessionId: state.sessionId,
        ...(agentOptions === undefined ? {} : { agentOptions }),
      })
    } catch {
      state.handle = await this.ctx.agents.create({
        sessionId: state.sessionId,
        meta: { cwd: workspace },
        ...(agentOptions === undefined ? {} : { agentOptions }),
      })
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
      if (process.env.CHAT_CONNECT_WECHAT_DEV === '1' && method === 'POST' && path === '/dev/message') {
        const body = await readJson(req)
        const state = this.find(body.accountId)
        if (!state) throw new Error('账号不存在')
        state.status = 'online'
        this.onMessage(body.accountId, {
          text: String(body.text || '你好'),
          senderId: 'dev',
          chatType: 'single',
          chatId: 'dev',
          raw: {
            dev: true,
            context_token: 'dev',
            from_user_id: 'dev',
            to_user_id: 'bot',
            message_id: Date.now(),
          },
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

      const accountMatch = /^\/accounts\/([^/]+)$/.exec(path)
      if (accountMatch) {
        const accountId = decodeURIComponent(accountMatch[1])
        if (method === 'DELETE') {
          json(res, 200, await this.removeAccount(accountId))
          return
        }
        if (method === 'PATCH' || method === 'PUT') {
          const body = await readJson(req)
          json(res, 200, await this.renameAccount(accountId, body.label))
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
