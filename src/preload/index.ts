import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AppState,
  BootError,
  BootProgress,
  ChooseDirectoryOptions,
  DshStudioApi,
  ServerState,
  SettingsDraft,
  TestConnectionInput,
  TestConnectionResult,
} from '../shared/types'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: DshStudioApi = {
  platform: process.platform,
  getState: () => ipcRenderer.invoke('app:state') as Promise<AppState>,
  chooseDirectory: (options?: ChooseDirectoryOptions) =>
    ipcRenderer.invoke('app:choose-directory', options) as Promise<string | null>,
  testConnection: (input: TestConnectionInput) =>
    ipcRenderer.invoke('app:test-connection', input) as Promise<TestConnectionResult>,
  saveSettings: (draft: SettingsDraft) =>
    ipcRenderer.invoke('app:save-settings', draft) as Promise<AppState>,
  applySettings: (draft: SettingsDraft) =>
    ipcRenderer.invoke('app:apply-settings', draft) as Promise<AppState>,
  start: () => ipcRenderer.invoke('boot:start') as Promise<void>,
  openSettings: () => ipcRenderer.invoke('app:open-settings') as Promise<void>,
  closeSettings: () => ipcRenderer.invoke('app:close-shell') as Promise<void>,
  openLog: () => ipcRenderer.invoke('app:open-log') as Promise<void>,
  openDataDir: () => ipcRenderer.invoke('app:open-data-dir') as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url) as Promise<void>,
  resetApp: () => ipcRenderer.invoke('app:reset') as Promise<AppState>,
  quit: () => ipcRenderer.invoke('app:quit') as Promise<void>,
  onProgress: (listener: (progress: BootProgress) => void) => subscribe('boot:progress', listener),
  onError: (listener: (error: BootError) => void) => subscribe('boot:error', listener),
  onServerState: (listener: (state: ServerState) => void) => subscribe('server:state', listener),
  onOpenSettings: (listener: () => void) => {
    const handler = (): void => listener()
    ipcRenderer.on('shell:open-settings', handler)
    return () => {
      ipcRenderer.removeListener('shell:open-settings', handler)
    }
  },
}

contextBridge.exposeInMainWorld('dshStudio', api)
