import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  type WriteStream,
} from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { BootProgress, ServerState } from '../shared/types'
import { writeDeepSeekKey } from './credentials'
import { resolveSpawnRuntime } from './runtime'
import { seedWorkspace } from './seed-workspace'
import { ensureWechatPlugin } from './wechat-plugin'
import { currentApiKey, loadSettings } from './settings'

const ANSI = /\u001B\[[0-?]*[ -/]*[@-~]/g
const URL_PATTERN = /(https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+(?:\/[^\s"']*)?)/

function stripAnsi(line: string): string {
  return line.replace(ANSI, '')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class HarnessServer extends EventEmitter {
  private child: ChildProcess | null = null
  private logStream: WriteStream | null = null
  private lines: string[] = []
  private generation = 0
  private state: ServerState

  constructor() {
    super()
    this.state = {
      phase: 'stopped',
      url: null,
      message: null,
      startedAt: null,
      logFile: '',
    }
  }

  private get logDir(): string {
    return join(app.getPath('userData'), 'logs')
  }

  private get logFile(): string {
    return join(this.logDir, 'server.log')
  }

  getState(): ServerState {
    return { ...this.state, logFile: this.logFile }
  }

  isRunning(): boolean {
    return this.state.phase === 'running' && this.state.url !== null
  }

  tail(count = 100): string[] {
    return this.lines.slice(-count)
  }

  private setState(patch: Partial<ServerState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.getState())
  }

  private progress(message: string, level: BootProgress['level'] = 'info'): void {
    this.emit('progress', { message, level, at: Date.now() } satisfies BootProgress)
  }

  private openLog(): void {
    mkdirSync(this.logDir, { recursive: true, mode: 0o700 })
    if (existsSync(this.logFile)) {
      try {
        renameSync(this.logFile, join(this.logDir, 'server.previous.log'))
      } catch {
        // Rotation is best effort only.
      }
    }
    this.logStream = createWriteStream(this.logFile, { flags: 'w', mode: 0o600 })
  }

  private closeLog(): void {
    this.logStream?.end()
    this.logStream = null
  }

  private record(line: string): void {
    const clean = stripAnsi(line).replace(/\s+$/, '')
    if (clean === '') return
    this.lines.push(clean)
    if (this.lines.length > 600) this.lines.splice(0, this.lines.length - 600)
    this.logStream?.write(`${clean}\n`)
    this.emit('log', clean)
  }

  private parseUrl(line: string): string | null {
    const match = URL_PATTERN.exec(line)
    return match?.[1] ?? null
  }

  async start(): Promise<ServerState> {
    await this.stop()

    const settings = loadSettings()
    if (!settings.onboardingComplete) {
      throw new Error('尚未完成初始配置')
    }

    const generation = ++this.generation
    this.lines = []
    this.openLog()
    this.setState({
      phase: 'starting',
      url: null,
      message: '正在启动本地服务…',
      startedAt: Date.now(),
    })
    this.progress('正在准备本地 AI 引擎…')

    const key = currentApiKey()
    if (key !== '') {
      writeDeepSeekKey(settings.dshHome, key)
    }
    mkdirSync(settings.workspace, { recursive: true, mode: 0o700 })
    seedWorkspace(settings.dshHome, settings.workspace)
    try {
      ensureWechatPlugin(settings.dshHome)
      this.progress('微信连接插件已准备。')
    } catch (error) {
      this.progress(
        `微信连接插件准备失败，应用将继续启动：${error instanceof Error ? error.message : String(error)}`,
        'warn',
      )
    }

    const runtime = resolveSpawnRuntime()
    const args = [
      ...runtime.prefixArgs,
      runtime.dshBin,
      'web',
      '--no-open',
      '--host',
      '127.0.0.1',
      '--port',
      String(settings.port),
    ]

    // Do not inherit the launcher's Harness variables (a terminal opened inside
    // another Harness run may export DSH_PROFILE, DSH_SESSION_ID, ...). The app
    // owns the child's complete Harness environment.
    const env: NodeJS.ProcessEnv = {}
    for (const [name, value] of Object.entries(process.env)) {
      if (value === undefined || name.startsWith('DSH_')) continue
      env[name] = value
    }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.DEEPSEEK_API_KEY
    delete env.DEEPSEEK_BASE_URL
    Object.assign(env, runtime.env, {
      DSH_HOME: settings.dshHome,
      CHAT_CONNECT: '1',
      CHAT_CONNECT_WECHAT_DATA_DIR: settings.dshHome,
      CHAT_CONNECT_WECHAT_LANG: loadSettings().language,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      TERM: 'dumb',
    })
    if (key !== '') env.DEEPSEEK_API_KEY = key
    if (settings.baseURL !== '') env.DEEPSEEK_BASE_URL = settings.baseURL

    this.progress(`正在启动本地服务（端口 ${settings.port === 0 ? '自动' : settings.port}）…`)

    let child: ChildProcess
    try {
      child = spawn(runtime.command, args, {
        cwd: settings.workspace,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      })
    } catch (error) {
      this.closeLog()
      const message = error instanceof Error ? error.message : String(error)
      this.setState({ phase: 'error', message })
      throw error
    }

    this.child = child
    let candidateUrl: string | null = null
    const exitState: { value: { code: number | null; signal: NodeJS.Signals | null } | null } = {
      value: null,
    }

    const consume = (chunk: Buffer): void => {
      for (const rawLine of chunk.toString('utf8').split(/\r?\n/)) {
        if (rawLine === '') continue
        this.record(rawLine)
        const clean = stripAnsi(rawLine)
        const parsed = this.parseUrl(clean)
        if (parsed !== null) {
          candidateUrl = parsed
          this.progress('本地服务已开始监听，正在等待就绪…')
        } else if (/error|failed|失败|错误/i.test(clean)) {
          this.progress(clean.slice(0, 240), 'warn')
        }
      }
    }

    child.stdout?.on('data', consume)
    child.stderr?.on('data', consume)

    child.once('exit', (code, signal) => {
      exitState.value = { code, signal }
      if (generation !== this.generation) return
      if (this.state.phase === 'running') {
        this.closeLog()
        this.setState({
          phase: 'error',
          message: `本地服务已退出（code=${code ?? 'null'}）`,
        })
        this.progress('本地服务意外退出。', 'error')
      }
    })

    child.once('error', (error) => {
      if (generation !== this.generation) return
      this.record(`spawn error: ${error.message}`)
      this.progress(`无法启动本地服务：${error.message}`, 'error')
    })

    const deadline = Date.now() + 120_000
    let lastReport = 0
    while (Date.now() < deadline) {
      if (generation !== this.generation) {
        throw new Error('启动已被取消')
      }
      if (exitState.value !== null) {
        this.closeLog()
        const message = `本地服务启动失败（code=${exitState.value.code ?? 'null'}）`
        this.setState({ phase: 'error', message })
        throw new Error(message)
      }
      const url = candidateUrl ?? (settings.port === 0 ? null : `http://127.0.0.1:${settings.port}/`)
      if (url !== null) {
        try {
          const response = await fetch(url, {
            redirect: 'manual',
            signal: AbortSignal.timeout(2_000),
          })
          if (response.status < 500) {
            this.setState({ phase: 'running', url, message: null })
            this.progress(url.includes('token=') ? '工作区已就绪。' : '本地服务已就绪。')
            return this.getState()
          }
        } catch {
          // Not listening yet.
        }
      }
      if (Date.now() - lastReport > 8_000) {
        lastReport = Date.now()
        this.progress('仍在等待本地服务就绪（首次启动需要初始化配置）…')
      }
      await sleep(350)
    }

    this.closeLog()
    this.setState({ phase: 'error', message: '启动超时（120 秒）' })
    this.progress('启动超时，请查看日志。', 'error')
    await this.killChild(child)
    throw new Error('启动超时（120 秒）')
  }

  async stop(): Promise<void> {
    this.generation += 1
    const child = this.child
    this.child = null
    if (child === null) {
      if (this.state.phase !== 'stopped') {
        this.setState({ phase: 'stopped', url: null, message: null, startedAt: null })
      }
      this.closeLog()
      return
    }
    this.setState({ phase: 'stopping', message: '正在停止本地服务…' })
    await this.killChild(child)
    this.closeLog()
    this.setState({ phase: 'stopped', url: null, message: null, startedAt: null })
  }

  private async killChild(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise<void>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve()
        return
      }
      child.once('exit', () => resolve())
    })

    try {
      if (process.platform === 'win32' && child.pid !== undefined) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      } else if (child.pid !== undefined) {
        if (process.platform !== 'win32') {
          try {
            process.kill(-child.pid, 'SIGTERM')
          } catch {
            child.kill('SIGTERM')
          }
        } else {
          child.kill('SIGTERM')
        }
      }
    } catch {
      // The process may already be gone.
    }

    await Promise.race([exited, sleep(5_000)])
    if (child.exitCode === null && child.signalCode === null) {
      try {
        if (process.platform !== 'win32' && child.pid !== undefined) {
          process.kill(-child.pid, 'SIGKILL')
        } else {
          child.kill('SIGKILL')
        }
      } catch {
        // Ignore.
      }
      await Promise.race([exited, sleep(1_500)])
    }
  }

  async dispose(): Promise<void> {
    await this.stop()
    this.closeLog()
    this.removeAllListeners()
  }
}
