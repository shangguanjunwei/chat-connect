import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { ChooseDirectoryOptions, SettingsDraft, TestConnectionInput } from '../shared/types'
import {
  appState,
  applySettingsAndBoot,
  bootNow,
  chooseDirectory,
  openDataDirectory,
  openExternalUrl,
  openLogFile,
  openSettings,
  quitApplication,
  resetConfiguration,
  restartServer,
  saveSettingsOnly,
  startBootInBackground,
} from './controller'
import { testConnection } from './test-connection'
import { closeShell, getShellWindow } from './windows'

function assertShellSender(event: IpcMainInvokeEvent): void {
  const shell = getShellWindow()
  if (shell === null || event.sender.id !== shell.webContents.id) {
    throw new Error('Untrusted IPC sender')
  }
}

function register(channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, (event, ...args) => {
    assertShellSender(event)
    return handler(event, ...args)
  })
}

export function registerIpcHandlers(): void {
  register('app:state', () => appState())

  register('app:choose-directory', (_event, options: ChooseDirectoryOptions | undefined) =>
    chooseDirectory(options ?? {}),
  )

  register('app:test-connection', (_event, input: TestConnectionInput | undefined) =>
    testConnection(input ?? {}),
  )

  register('app:save-settings', (_event, draft: SettingsDraft) => saveSettingsOnly(draft))

  register('app:apply-settings', (_event, draft: SettingsDraft) => applySettingsAndBoot(draft))

  register('boot:start', () => {
    startBootInBackground()
  })

  register('boot:wait', () => bootNow())

  register('server:restart', () => restartServer())

  register('app:open-settings', () => {
    openSettings()
  })

  register('app:close-shell', () => {
    closeShell()
  })

  register('app:open-log', () => openLogFile())

  register('app:open-data-dir', () => openDataDirectory())

  register('app:open-external', (_event, url: string) => openExternalUrl(url))

  register('app:reset', () => resetConfiguration())

  register('app:quit', () => {
    quitApplication()
  })
}
