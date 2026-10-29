import { app, BrowserWindow, session } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  appState,
  harnessServer,
  initializeController,
  openDataDirectory,
  openInBrowser,
  openLogFile,
  openSettings,
  quitApplication,
  resetConfiguration,
  restartServer,
  setSettingsChangedHook,
} from './controller'
import { registerIpcHandlers } from './ipc'
import { buildAppMenu, openDocumentation, openRepository, type MenuActions } from './menu'
import { dshVersion, resolveSpawnRuntime } from './runtime'
import { loadSettings } from './settings'
import { focusWorkspace, openShell, openWorkspace } from './windows'

app.setName('Chat Connect')

// Development-only remote debugging, used to verify the rendered UI end to end.
if (!app.isPackaged && process.env.CHAT_CONNECT_CDP_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.CHAT_CONNECT_CDP_PORT)
}

if (!app.isPackaged) {
  const devUserData = join(app.getPath('appData'), 'Chat Connect (Dev)')
  mkdirSync(devUserData, { recursive: true, mode: 0o700 })
  app.setPath('userData', devUserData)
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.shangguanjunwei.chatconnect')
}

const menuActions: MenuActions = {
  openSettings: () => openSettings(),
  restartServer: () => {
    void restartServer().catch(() => undefined)
  },
  openInBrowser: () => {
    void openInBrowser()
  },
  openLog: () => {
    void openLogFile()
  },
  openDataDir: () => {
    void openDataDirectory()
  },
  reset: () => {
    void resetConfiguration().catch(() => undefined)
  },
  quit: () => quitApplication(),
  openDocs: openDocumentation,
  openRepo: openRepository,
}

function rebuildMenu(): void {
  buildAppMenu(loadSettings().language, menuActions)
}

function showPrimaryWindow(): void {
  if (focusWorkspace()) return
  const running = harnessServer.getState()
  if (running.phase === 'running' && running.url !== null) {
    openWorkspace(running.url)
    return
  }
  openShell('')
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showPrimaryWindow()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      showPrimaryWindow()
    }
  })

  app.on('window-all-closed', () => {
    // A short grace period covers the shell-to-workspace handoff.
    setTimeout(() => {
      if (BrowserWindow.getAllWindows().length === 0) app.quit()
    }, 120)
  })

  let shuttingDown = false
  app.on('before-quit', (event) => {
    if (shuttingDown) return
    event.preventDefault()
    shuttingDown = true
    void harnessServer.dispose().finally(() => {
      app.quit()
    })
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
    })
  })

  void app.whenReady().then(() => {
    initializeController()
    registerIpcHandlers()
    setSettingsChangedHook(rebuildMenu)
    rebuildMenu()

    app.setAboutPanelOptions({
      applicationName: 'Chat Connect',
      applicationVersion: app.getVersion(),
      version: `Chat Connect ${app.getVersion()}`,
      copyright: 'Copyright © 2026 Chat Connect.',
      credits:
        'Chat Connect bundles the open-source DeepSeek Harness engine (MIT), developed by DeepSeek AI.',
    })

    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
      const allowed = new Set([
        'clipboard-read',
        'clipboard-sanitized-write',
        'media',
        'notifications',
        'fullscreen',
      ])
      callback(allowed.has(permission))
    })

    try {
      resolveSpawnRuntime()
    } catch (error) {
      console.error('[chat-connect] runtime resolution failed:', error)
    }

    openShell('')
    console.info(
      `[chat-connect] ${appState().info.appVersion} · engine ${dshVersion()} · Electron ${
        process.versions.electron
      } · Node ${process.versions.node}`,
    )
  })
}
