/** Contract shared by the Electron main process, the preload bridge, and the renderer. */

export type Language = 'zh-CN' | 'en-US'

export type ServerPhase = 'stopped' | 'starting' | 'running' | 'error' | 'stopping'

export interface ServerState {
  phase: ServerPhase
  url: string | null
  message: string | null
  startedAt: number | null
  logFile: string
}

export interface PublicSettings {
  language: Language
  apiKeyConfigured: boolean
  apiKeyPreview: string
  baseURL: string
  workspace: string
  dshHome: string
  port: number
  onboardingComplete: boolean
}

export interface RuntimeInfo {
  appVersion: string
  dshVersion: string
  electronVersion: string
  nodeVersion: string
  platform: string
  arch: string
  isPackaged: boolean
  dshBin: string
  node: string
  nodeKind: 'bundled' | 'system' | 'electron'
}

export interface AppState {
  info: RuntimeInfo
  settings: PublicSettings
  defaults: {
    workspace: string
    dshHome: string
  }
  server: ServerState
  runtimeWarning: string | null
}

export interface SettingsDraft {
  language: Language
  /** Empty string or undefined keeps the stored key. */
  apiKey?: string
  clearApiKey?: boolean
  baseURL: string
  workspace: string
  dshHome: string
  port: number | string
  onboardingComplete?: boolean
}

export interface TestConnectionInput {
  /** Empty string uses the stored key. */
  apiKey?: string
  baseURL?: string
}

export type ConnectionCode =
  | 'ok'
  | 'missing-key'
  | 'unauthorized'
  | 'not-found'
  | 'rate-limited'
  | 'timeout'
  | 'network'
  | 'server'
  | 'bad-response'

export interface TestConnectionResult {
  ok: boolean
  code: ConnectionCode
  status: number | null
  latencyMs: number
  models: string[]
  message: string
}

export interface BootProgress {
  message: string
  level: 'info' | 'warn' | 'error'
  at: number
}

export interface BootError {
  message: string
  detail: string
  logFile: string
}

export interface ChooseDirectoryOptions {
  title?: string
  defaultPath?: string
}

export interface DshStudioApi {
  /** Host platform, used for window-chrome layout. */
  readonly platform: string
  getState: () => Promise<AppState>
  chooseDirectory: (options?: ChooseDirectoryOptions) => Promise<string | null>
  testConnection: (input: TestConnectionInput) => Promise<TestConnectionResult>
  saveSettings: (draft: SettingsDraft) => Promise<AppState>
  applySettings: (draft: SettingsDraft) => Promise<AppState>
  start: () => Promise<void>
  openSettings: () => Promise<void>
  closeSettings: () => Promise<void>
  openLog: () => Promise<void>
  openDataDir: () => Promise<void>
  openExternal: (url: string) => Promise<void>
  resetApp: () => Promise<AppState>
  quit: () => Promise<void>
  onProgress: (listener: (progress: BootProgress) => void) => () => void
  onError: (listener: (error: BootError) => void) => () => void
  onServerState: (listener: (state: ServerState) => void) => () => void
  onOpenSettings: (listener: () => void) => () => void
}
