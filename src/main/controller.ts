import { app, dialog, shell, type OpenDialogOptions } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AppState, BootError, ServerState, SettingsDraft } from '../shared/types'
import { writeDeepSeekKey } from './credentials'
import { runtimeInfo, runtimeWarning } from './runtime'
import { HarnessServer } from './server'
import {
  defaultDshHomePath,
  defaultWorkspacePath,
  loadSettings,
  publicSettings,
  resetSettings,
  saveDraft,
  takeLoadWarning,
} from './settings'
import { testConnection } from './test-connection'
import {
  closeShell,
  closeWorkspace,
  getShellWindow,
  openShell,
  openWorkspace,
  shellWindowRoute,
} from './windows'

export const harnessServer = new HarnessServer()

let activeBoot: { id: number; promise: Promise<ServerState> } | null = null
let bootSequence = 0
let startupWarning: string | null = null
let settingsChangedHook: () => void = () => undefined

export function initializeController(): void {
  startupWarning = takeLoadWarning()
  harnessServer.on('progress', (progress) => {
    getShellWindow()?.webContents.send('boot:progress', progress)
  })
  harnessServer.on('state', (state: ServerState) => {
    getShellWindow()?.webContents.send('server:state', state)
  })
}

export function setSettingsChangedHook(hook: () => void): void {
  settingsChangedHook = hook
}

export function appState(): AppState {
  return {
    info: runtimeInfo(),
    settings: publicSettings(),
    defaults: {
      workspace: defaultWorkspacePath(),
      dshHome: defaultDshHomePath(),
    },
    server: harnessServer.getState(),
    runtimeWarning: startupWarning ?? runtimeWarning(),
  }
}

function bootErrorPayload(error: unknown): BootError {
  return {
    message: error instanceof Error ? error.message : String(error),
    detail: harnessServer.tail(140).join('\n'),
    logFile: harnessServer.getState().logFile,
  }
}

function publishBootError(error: unknown): BootError {
  const payload = bootErrorPayload(error)
  getShellWindow()?.webContents.send('boot:error', payload)
  return payload
}

function closeTransientShell(): void {
  const route = shellWindowRoute()
  if (route === '' || route === '/boot') closeShell()
}

/**
 * Start the Host if it is not running and show the workspace. Concurrent
 * callers share one start attempt.
 */
export async function bootNow(): Promise<ServerState> {
  if (harnessServer.isRunning()) {
    const url = harnessServer.getState().url
    if (url !== null) {
      openWorkspace(url)
      closeTransientShell()
      return harnessServer.getState()
    }
  }
  if (activeBoot === null) {
    const id = ++bootSequence
    const promise = (async () => {
      const state = await harnessServer.start()
      if (state.url !== null) {
        openWorkspace(state.url)
        closeTransientShell()
      }
      return state
    })().finally(() => {
      if (activeBoot?.id === id) activeBoot = null
    })
    activeBoot = { id, promise }
  }
  return activeBoot.promise
}

function invalidateBoot(): void {
  activeBoot = null
  bootSequence += 1
}

export function startBootInBackground(): void {
  if (activeBoot !== null) return
  void bootNow().catch((error: unknown) => {
    publishBootError(error)
  })
}

export function saveSettingsOnly(draft: SettingsDraft): AppState {
  saveDraft({ ...draft, onboardingComplete: true })
  settingsChangedHook()
  return appState()
}

export async function applySettingsAndBoot(draft: SettingsDraft): Promise<AppState> {
  saveDraft({ ...draft, onboardingComplete: true })
  settingsChangedHook()
  invalidateBoot()
  await harnessServer.stop()
  closeWorkspace()
  try {
    await bootNow()
  } catch (error) {
    publishBootError(error)
    throw error
  }
  return appState()
}

export async function restartServer(): Promise<void> {
  invalidateBoot()
  await harnessServer.stop()
  openShell('/boot')
  closeWorkspace()
}

export function openSettings(): void {
  openShell('/settings')
}

export async function chooseDirectory(options: {
  title?: string
  defaultPath?: string
}): Promise<string | null> {
  const window = getShellWindow()
  const zh = loadSettings().language === 'zh-CN'
  const settings: OpenDialogOptions = {
    title: options.title,
    defaultPath: options.defaultPath,
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: zh ? '选择' : 'Choose',
  }
  const result = window
    ? await dialog.showOpenDialog(window, settings)
    : await dialog.showOpenDialog(settings)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0] ?? null
}

export async function openLogFile(): Promise<void> {
  const path = harnessServer.getState().logFile
  if (path === '') return
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  if (!existsSync(path)) writeFileSync(path, '（尚未启动本地服务）\n', { mode: 0o600 })
  await shell.openPath(path)
}

export async function openDataDirectory(): Promise<void> {
  const settings = loadSettings()
  mkdirSync(settings.dshHome, { recursive: true, mode: 0o700 })
  await shell.openPath(settings.dshHome)
}

export async function openInBrowser(): Promise<boolean> {
  const url = harnessServer.getState().url
  if (url === null) return false
  await shell.openExternal(url)
  return true
}

export async function openExternalUrl(url: string): Promise<void> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('只允许打开 http 或 https 链接')
  }
  await shell.openExternal(url)
}

export async function resetConfiguration(): Promise<AppState> {
  const window = getShellWindow()
  const zh = loadSettings().language === 'zh-CN'
  const options = {
    type: 'warning' as const,
    buttons: zh ? ['取消', '重置'] : ['Cancel', 'Reset'],
    defaultId: 0,
    cancelId: 0,
    title: zh ? '重置应用配置' : 'Reset app configuration',
    message: zh ? '重置后会回到初始配置向导。' : 'This returns to the setup wizard.',
    detail: zh
      ? '工作区文件、会话记录和 Harness 数据目录不会被删除，但应用会忘记已保存的 API Key、工作区路径和端口设置。'
      : 'Workspace files, sessions, and the Harness data folder are kept. The app forgets the saved API key, workspace path, and port.',
  }
  const choice = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  if (choice.response !== 1) return appState()

  invalidateBoot()
  await harnessServer.stop()
  try {
    writeDeepSeekKey(loadSettings().dshHome, '')
  } catch {
    // A malformed credential file must not block the reset.
  }
  resetSettings()
  settingsChangedHook()
  openShell('')
  closeWorkspace()
  return appState()
}

export function quitApplication(): void {
  app.quit()
}

export { harnessServer as server }
