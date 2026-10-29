import { BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { WORKSPACE_BRAND_CSS } from './workspace-branding'
import { loadSettings } from './settings'

const RENDERER_URL = process.env.ELECTRON_RENDERER_URL
const preloadPath = join(__dirname, '../preload/index.js')
const rendererFile = join(__dirname, '../renderer/index.html')

let shellWindow: BrowserWindow | null = null
let workspaceWindow: BrowserWindow | null = null
let shellRoute = ''
let shellFitTimer: ReturnType<typeof setInterval> | null = null

function loadRoute(window: BrowserWindow, route: string): void {
  if (!window.isDestroyed()) {
    if (RENDERER_URL !== undefined && RENDERER_URL !== '') {
      void window.loadURL(`${RENDERER_URL}/#${route}`)
    } else {
      void window.loadFile(rendererFile, { hash: route })
    }
  }
}

function openExternalSafely(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      void shell.openExternal(url)
    }
  } catch {
    // Ignore malformed URLs.
  }
}

export function hasShellWindow(): boolean {
  return shellWindow !== null && !shellWindow.isDestroyed()
}

export function getShellWindow(): BrowserWindow | null {
  return hasShellWindow() ? shellWindow : null
}

export function getWorkspaceWindow(): BrowserWindow | null {
  return workspaceWindow !== null && !workspaceWindow.isDestroyed() ? workspaceWindow : null
}

export function shellWindowRoute(): string {
  return shellRoute
}

/**
 * Open (or reuse) the local UI window: onboarding, boot progress, or settings.
 * This is the only window with a preload bridge.
 */
export function openShell(route = ''): BrowserWindow {
  if (hasShellWindow()) {
    const window = shellWindow as BrowserWindow
    if (route !== '' && shellRoute !== route) {
      shellRoute = route
      loadRoute(window, route)
    }
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    return window
  }

  const compactBoot =
    (route === '' || route === '/boot') && loadSettings().onboardingComplete === true
  const window = new BrowserWindow({
    width: compactBoot ? 652 : 1080,
    height: compactBoot ? 700 : 720,
    minWidth: compactBoot ? 560 : 900,
    minHeight: compactBoot ? 420 : 620,
    show: false,
    title: 'Chat Connect',
    backgroundColor: '#0b1220',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  shellWindow = window
  shellRoute = route

  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (shellWindow === window) shellWindow = null
    if (shellFitTimer !== null) {
      clearInterval(shellFitTimer)
      shellFitTimer = null
    }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    // The shell only ever hosts local documents.
    const local = url.startsWith('file://') || (RENDERER_URL !== undefined && url.startsWith(RENDERER_URL))
    if (!local) {
      event.preventDefault()
      openExternalSafely(url)
    }
  })

  loadRoute(window, route)
  fitShellWindow(window)
  return window
}

/**
 * Fit the shell window to the boot card once it is on screen. The boot screen
 * does not need the large onboarding canvas: measure the rendered card and
 * resize its content area to that card plus the frame padding. Setup/settings
 * still restore the normal 1080x720 canvas.
 */
function fitShellWindow(window: BrowserWindow): void {
  if (shellFitTimer !== null) {
    clearInterval(shellFitTimer)
    shellFitTimer = null
  }
  let lastMode = ''
  const tick = async (): Promise<void> => {
    if (window.isDestroyed()) {
      if (shellFitTimer !== null) {
        clearInterval(shellFitTimer)
        shellFitTimer = null
      }
      return
    }
    try {
      const layout = (await window.webContents.executeJavaScript(
        `(() => {
          const wizard = document.querySelector('.wizard')
          if (wizard) return { mode: 'wizard', width: 1080, height: 720 }
          const card = document.querySelector('.boot-card')
          if (!card) return { mode: 'other', width: 0, height: 0 }
          const frame = document.querySelector('.boot-frame')
          const style = frame ? getComputedStyle(frame) : getComputedStyle(document.body)
          const rect = card.getBoundingClientRect()
          const px = (value) => Number.parseFloat(value) || 0
          return {
            mode: 'boot',
            width: Math.ceil(rect.width + px(style.paddingLeft) + px(style.paddingRight)),
            height: Math.ceil(rect.height + px(style.paddingTop) + px(style.paddingBottom)),
          }
        })()`,
        true,
      )) as { mode: 'boot' | 'wizard' | 'other'; width: number; height: number }

      if (layout.mode === 'wizard') {
        if (lastMode !== 'wizard') {
          window.setMinimumSize(900, 620)
          window.setContentSize(1080, 720)
          window.center()
          lastMode = 'wizard'
        }
        return
      }
      if (layout.mode !== 'boot' || layout.width <= 0 || layout.height <= 0) {
        lastMode = layout.mode
        return
      }

      // Pin the boot width: measuring width from the card creates a feedback
      // loop once the viewport (and therefore the card) shrinks with it.
      const width = 652
      const height = Math.max(420, layout.height)
      window.setMinimumSize(560, 420)
      const [currentWidth = 0, currentHeight = 0] = window.getContentSize()
      if (Math.abs(currentWidth - width) > 2 || Math.abs(currentHeight - height) > 2) {
        window.setContentSize(width, height)
        window.center()
      }
      lastMode = 'boot'
    } catch {
      // The renderer may not be ready yet, or the window is navigating.
    }
  }
  shellFitTimer = setInterval(() => void tick(), 500)
  setTimeout(() => void tick(), 180)
}

export function closeShell(): void {
  const window = getShellWindow()
  if (window !== null) window.close()
}

/**
 * Show the Harness workspace itself. This window intentionally has no preload:
 * the bundled web app never receives the desktop bridge.
 */
export function openWorkspace(url: string): BrowserWindow {
  const existing = getWorkspaceWindow()
  if (existing !== null) {
    void existing.loadURL(url)
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return existing
  }

  const window = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Chat Connect',
    backgroundColor: '#151517',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: true,
    },
  })

  workspaceWindow = window
  // The upstream page sets its own document title on every navigation.
  // Keep the native window/menu identity on Chat Connect.
  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle('Chat Connect')
  })
  window.webContents.on('did-finish-load', () => {
    void window.webContents.insertCSS(WORKSPACE_BRAND_CSS).catch(() => undefined)
    dismissUpstreamPreview(window)
  })

  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.show()
      window.focus()
    }
  })
  window.on('closed', () => {
    if (workspaceWindow === window) workspaceWindow = null
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, target) => {
    let sameOrigin = false
    try {
      sameOrigin = new URL(target).origin === new URL(url).origin
    } catch {
      sameOrigin = false
    }
    if (!sameOrigin) {
      event.preventDefault()
      openExternalSafely(target)
    }
  })

  bindWorkspaceTheme(window)
  void window.loadURL(url)
  return window
}

const dismissedPreviewWindows = new WeakSet<BrowserWindow>()

/**
 * The engine ships its own first-run preview notice with upstream branding.
 * Chat Connect deliberately skips that notice so the first workspace view is
 * its own product surface. The check is scoped by the dialog's accessible
 * title and primary action, never by a generic "close any dialog" rule.
 */
function dismissUpstreamPreview(window: BrowserWindow): void {
  if (dismissedPreviewWindows.has(window)) return
  dismissedPreviewWindows.add(window)

  let attempts = 0
  const timer = setInterval(() => {
    if (window.isDestroyed() || attempts >= 20) {
      clearInterval(timer)
      return
    }
    attempts += 1
    void window.webContents
      .executeJavaScript(
        `(() => {
          const titles = ['预览版说明', 'Preview Notice']
          const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
            .find(node => titles.includes((node.getAttribute('aria-label') || '').trim()))
          if (!dialog) return false
          const button = Array.from(dialog.querySelectorAll('button'))
            .find(node => /^(继续|Continue)$/.test((node.textContent || '').trim()))
          if (!button) return false
          button.click()
          return true
        })()`,
      )
      .then((dismissed: boolean) => {
        if (dismissed) clearInterval(timer)
      })
      .catch(() => undefined)
  }, 500)

  window.on('closed', () => clearInterval(timer))
}

const themedWindows = new WeakSet<BrowserWindow>()

/**
 * The Harness page owns its own light/dark preference. Mirror that preference
 * onto the native window so the macOS title bar never stays dark above a light
 * page (or light above a dark one).
 */
export function bindWorkspaceTheme(window: BrowserWindow): void {
  if (themedWindows.has(window)) return
  themedWindows.add(window)

  let timer: NodeJS.Timeout | undefined
  let lastPreference: string | null = null
  let lastDark: boolean | null = null

  const apply = async (): Promise<void> => {
    if (window.isDestroyed()) return
    try {
      const theme = (await window.webContents.executeJavaScript(
        `(() => ({
          preference: document.documentElement.dataset.dsThemeSource || 'system',
          dark: document.body ? document.body.hasAttribute('data-ds-dark-theme') : false
        }))()`,
      )) as { preference: string; dark: boolean }

      if (theme.preference !== lastPreference) {
        lastPreference = theme.preference
        nativeTheme.themeSource =
          theme.preference === 'light' || theme.preference === 'dark'
            ? theme.preference
            : 'system'
      }
      if (theme.dark !== lastDark) {
        lastDark = theme.dark
        window.setBackgroundColor(theme.dark ? '#151517' : '#ffffff')
      }
    } catch {
      // Navigation may still be in flight; the next tick retries.
    }
  }

  window.webContents.on('did-finish-load', () => {
    void apply()
    if (timer === undefined) {
      timer = setInterval(() => {
        void apply()
      }, 1_000)
    }
  })
  window.on('closed', () => {
    if (timer !== undefined) clearInterval(timer)
  })
}

export function reloadWorkspace(url: string): void {
  const window = getWorkspaceWindow()
  if (window !== null) {
    void window.loadURL(url)
    window.show()
    window.focus()
  } else {
    openWorkspace(url)
  }
}

export function closeWorkspace(): void {
  const window = getWorkspaceWindow()
  if (window !== null) window.close()
}

export function focusWorkspace(): boolean {
  const window = getWorkspaceWindow()
  if (window === null) return false
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return true
}

export function theOnlyWindowClosed(): boolean {
  return !hasShellWindow() && getWorkspaceWindow() === null
}
