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

app.setName('DSH Studio')

// Development-only remote debugging, used to verify the rendered UI end to end.
if (!app.isPackaged && process.env.DSH_STUDIO_CDP_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.DSH_STUDIO_CDP_PORT)
}

if (!app.isPackaged) {
  const devUserData = join(app.getPath('appData'), 'DSH Studio (Dev)')
  mkdirSync(devUserData, { recursive: true, mode: 0o700 })
  app.setPath('userData', devUserData)
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.dshstudio.app')
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
      applicationName: 'DSH Studio',
      applicationVersion: app.getVersion(),
      version: `DeepSeek Harness ${dshVersion()}`,
      copyright: 'DeepSeek Harness is developed by DeepSeek AI.',
      credits:
        'DSH Studio bundles the open-source DeepSeek Harness release and runs it entirely on this computer.',
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
      console.error('[dsh-studio] runtime resolution failed:', error)
    }

    openShell('')
    console.info(
      `[dsh-studio] ${appState().info.appVersion} · Harness ${dshVersion()} · Electron ${
        process.versions.electron
      } · Node ${process.versions.node}`,
    )
  })
}
