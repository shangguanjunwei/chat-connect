import { app, safeStorage } from 'electron'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { Language, PublicSettings, SettingsDraft } from '../shared/types'

const SETTINGS_VERSION = 1

interface SecretBox {
  alg: 'safe-storage' | 'plain'
  data: string
}

interface StoredSettings {
  version: number
  language: Language
  apiKey: SecretBox | null
  baseURL: string
  workspace: string
  dshHome: string
  port: number
  onboardingComplete: boolean
}

export class SettingsError extends Error {
  readonly field: string

  constructor(field: string, message: string) {
    super(message)
    this.name = 'SettingsError'
    this.field = field
  }
}

let cached: StoredSettings | null = null
let loadWarning: string | null = null

export function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function defaultWorkspacePath(): string {
  const documents = app.getPath('documents')
  return join(documents, 'Chat Connect')
}

export function defaultDshHomePath(): string {
  return join(app.getPath('userData'), 'engine')
}

export function expandHome(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return join(homedir(), trimmed.slice(2))
  }
  return trimmed
}

function isLanguage(value: unknown): value is Language {
  return value === 'zh-CN' || value === 'en-US'
}

function defaults(): StoredSettings {
  // Prefer the operating-system locale: a bundle without CFBundleLocalizations
  // reports en-US from getLocale() even on a Chinese system.
  let locale = app.getLocale()
  try {
    locale = app.getSystemLocale() || locale
  } catch {
    // Older Electron builds may not expose getSystemLocale.
  }
  return {
    version: SETTINGS_VERSION,
    language: locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US',
    apiKey: null,
    baseURL: '',
    workspace: defaultWorkspacePath(),
    dshHome: defaultDshHomePath(),
    port: 0,
    onboardingComplete: false,
  }
}

function normalizePort(input: unknown): number {
  const value = typeof input === 'string' ? Number(input.trim() === '' ? 0 : input) : input
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new SettingsError('port', '端口必须是整数')
  }
  if (value !== 0 && (value < 1024 || value > 65535)) {
    throw new SettingsError('port', '端口需要在 1024–65535 之间，或使用 0 自动分配')
  }
  return value
}

function normalizeDirectory(input: unknown, field: string): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new SettingsError(field, '路径不能为空')
  }
  const expanded = expandHome(input)
  if (!isAbsolute(expanded)) {
    throw new SettingsError(field, '请填写绝对路径')
  }
  const normalized = resolve(expanded)
  if (existsSync(normalized) && !statSync(normalized).isDirectory()) {
    throw new SettingsError(field, '该路径是一个文件，请选择文件夹')
  }
  return normalized
}

export function normalizeBaseURL(input: unknown): string {
  if (input === undefined || input === null) return ''
  if (typeof input !== 'string') throw new SettingsError('baseURL', 'API 地址格式不正确')
  const trimmed = input.trim().replace(/\/+$/, '')
  if (trimmed === '') return ''
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new SettingsError('baseURL', 'API 地址不是合法的 URL')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new SettingsError('baseURL', 'API 地址只支持 http 或 https')
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new SettingsError('baseURL', 'API 地址不能包含查询参数或锚点')
  }
  return trimmed
}

function normalizeApiKey(input: unknown): string {
  if (typeof input !== 'string') throw new SettingsError('apiKey', 'API Key 格式不正确')
  const trimmed = input.trim()
  if (trimmed === '') return ''
  if (/\s/.test(trimmed)) throw new SettingsError('apiKey', 'API Key 不能包含空格或换行')
  if (trimmed.length < 8) throw new SettingsError('apiKey', 'API Key 太短，请检查是否复制完整')
  if (trimmed.length > 512) throw new SettingsError('apiKey', 'API Key 过长')
  return trimmed
}

function encryptSecret(plain: string): SecretBox {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return {
        alg: 'safe-storage',
        data: safeStorage.encryptString(plain).toString('base64'),
      }
    }
  } catch {
    // Fall through to the plain box; the settings file itself is owner-only.
  }
  return { alg: 'plain', data: Buffer.from(plain, 'utf8').toString('base64') }
}

function decryptSecret(box: SecretBox | null): string {
  if (box === null) return ''
  try {
    if (box.alg === 'safe-storage') {
      return safeStorage.decryptString(Buffer.from(box.data, 'base64'))
    }
    return Buffer.from(box.data, 'base64').toString('utf8')
  } catch {
    loadWarning = '已保存的 API Key 无法解密（可能更换了系统账户或应用签名），请重新填写。'
    return ''
  }
}

function readRaw(): StoredSettings {
  const path = getSettingsPath()
  const base = defaults()
  if (!existsSync(path)) return base
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredSettings>
    const merged: StoredSettings = {
      ...base,
      ...parsed,
      version: SETTINGS_VERSION,
      language: isLanguage(parsed.language) ? parsed.language : base.language,
      baseURL: typeof parsed.baseURL === 'string' ? parsed.baseURL : '',
      workspace:
        typeof parsed.workspace === 'string' && parsed.workspace.trim() !== ''
          ? expandHome(parsed.workspace)
          : base.workspace,
      dshHome:
        typeof parsed.dshHome === 'string' && parsed.dshHome.trim() !== ''
          ? expandHome(parsed.dshHome)
          : base.dshHome,
      port: Number.isInteger(parsed.port) ? (parsed.port as number) : 0,
      onboardingComplete: parsed.onboardingComplete === true,
      apiKey: parsed.apiKey ?? null,
    }
    return merged
  } catch (error) {
    loadWarning = `配置文件损坏，已使用默认配置启动（${String(error)}）`
    try {
      renameSync(path, `${path}.corrupt-${Date.now()}`)
    } catch {
      // Ignore: the caller still gets defaults.
    }
    return base
  }
}

export function loadSettings(): StoredSettings {
  if (cached !== null) return cached
  cached = readRaw()
  return cached
}

export function takeLoadWarning(): string | null {
  const warning = loadWarning
  loadWarning = null
  return warning
}

export function currentApiKey(): string {
  return decryptSecret(loadSettings().apiKey)
}

export function previewSecret(secret: string): string {
  if (secret === '') return ''
  if (secret.length <= 10) return '••••••'
  return `${secret.slice(0, 3)}••••${secret.slice(-4)}`
}

export function toPublicSettings(settings: StoredSettings, withKey: string): PublicSettings {
  return {
    language: settings.language,
    apiKeyConfigured: withKey !== '',
    apiKeyPreview: previewSecret(withKey),
    baseURL: settings.baseURL,
    workspace: settings.workspace,
    dshHome: settings.dshHome,
    port: settings.port,
    onboardingComplete: settings.onboardingComplete,
  }
}

export function publicSettings(): PublicSettings {
  return toPublicSettings(loadSettings(), currentApiKey())
}

function persist(settings: StoredSettings): void {
  const path = getSettingsPath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.tmp-${process.pid}`
  writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
  try {
    chmodSync(path, 0o600)
  } catch {
    // Best effort on filesystems without POSIX modes.
  }
  cached = settings
}

export function ensureDirectory(path: string): void {
  if (existsSync(path) && statSync(path).isDirectory()) return
  mkdirSync(path, { recursive: true, mode: 0o700 })
}

export function saveDraft(draft: SettingsDraft): PublicSettings {
  if (!isLanguage(draft.language)) throw new SettingsError('language', '语言设置不正确')
  const previous = loadSettings()
  const normalizedKey = normalizeApiKey(draft.apiKey ?? '')

  let keyBox = previous.apiKey
  if (draft.clearApiKey === true) {
    keyBox = null
  } else if (normalizedKey !== '') {
    keyBox = encryptSecret(normalizedKey)
  }

  const next: StoredSettings = {
    version: SETTINGS_VERSION,
    language: draft.language,
    apiKey: keyBox,
    baseURL: normalizeBaseURL(draft.baseURL),
    workspace: normalizeDirectory(draft.workspace, 'workspace'),
    dshHome: normalizeDirectory(draft.dshHome, 'dshHome'),
    port: normalizePort(draft.port),
    onboardingComplete: draft.onboardingComplete ?? previous.onboardingComplete,
  }

  ensureDirectory(next.workspace)
  ensureDirectory(next.dshHome)

  persist(next)
  return toPublicSettings(next, currentApiKey())
}

export function resetSettings(): PublicSettings {
  const fresh = defaults()
  persist(fresh)
  return toPublicSettings(fresh, '')
}
