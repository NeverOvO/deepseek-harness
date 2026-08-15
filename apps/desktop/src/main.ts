import { app, BrowserWindow, dialog, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { installApplicationMenu } from './menu.ts'
import {
  startDesktopRuntime,
  stopDesktopRuntime,
  type DesktopRuntime,
} from './runtime.ts'

const APP_NAME = '云屿来工作台'
const DEFAULT_WIDTH = 1440
const DEFAULT_HEIGHT = 920
const MIN_WIDTH = 1080
const MIN_HEIGHT = 700

let mainWindow: BrowserWindow | undefined
let runtime: DesktopRuntime | undefined
let runtimeStarting: Promise<DesktopRuntime> | undefined
let runtimeAbortController: AbortController | undefined
let quitting = false

function preloadPath(): string {
  return fileURLToPath(new URL('./preload.js', import.meta.url))
}

function splashPath(): string {
  return fileURLToPath(new URL('../assets/splash.html', import.meta.url))
}

async function ensureRuntime(): Promise<DesktopRuntime> {
  if (runtime !== undefined) return runtime
  if (runtimeStarting === undefined) {
    const controller = new AbortController()
    runtimeAbortController = controller
    runtimeStarting = startDesktopRuntime(controller.signal)
  }

  try {
    runtime = await runtimeStarting
    return runtime
  } finally {
    runtimeStarting = undefined
    runtimeAbortController = undefined
  }
}

async function shutdownRuntime(): Promise<void> {
  runtimeAbortController?.abort()
  const starting = runtimeStarting
  if (starting !== undefined) {
    try {
      await starting
    } catch {
      // Startup cancellation is the expected path when the user quits while
      // the splash screen is still waiting for DSH readiness.
    }
  }
  await stopDesktopRuntime(runtime)
  runtime = undefined
}

function sameOrigin(candidate: string, allowedOrigin: string): boolean {
  try {
    return new URL(candidate).origin === allowedOrigin
  } catch {
    return false
  }
}

function createWindowShell(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const window = new BrowserWindow({
    title: APP_NAME,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: '#171719',
    ...(isMac
      ? {
        // Keep the native macOS title bar until the Workbench client owns a
        // dedicated drag/no-drag region. `hiddenInset` overlays the traffic
        // lights on top of the upstream DSH sidebar, which makes the window
        // hard to drag and collides with the DeepSeek brand mark.
        titleBarStyle: 'default' as const,
      }
      : {}),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show()
  })

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })

  return window
}

async function hydrateWindow(window: BrowserWindow): Promise<void> {
  await window.loadFile(splashPath())
  if (!window.isVisible()) window.show()

  const activeRuntime = await ensureRuntime()
  if (window.isDestroyed()) return

  const allowedOrigin = new URL(activeRuntime.url).origin
  window.webContents.on('will-navigate', (event, url) => {
    if (!sameOrigin(url, allowedOrigin)) event.preventDefault()
  })

  activeRuntime.process.once('exit', () => {
    if (quitting) return
    if (runtime?.process === activeRuntime.process) runtime = undefined
    if (!window.isDestroyed()) {
      dialog.showErrorBox(
        'DSH Runtime 已停止',
        '云屿来工作台的执行引擎意外退出。关闭并重新打开窗口可重新启动 Runtime。',
      )
    }
  })

  await window.loadURL(activeRuntime.url)
}

async function activate(): Promise<void> {
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return
  }

  const window = createWindowShell()
  mainWindow = window
  try {
    await hydrateWindow(window)
  } catch (error) {
    if (!window.isDestroyed()) window.close()
    throw error
  }
}

async function boot(): Promise<void> {
  app.setName(APP_NAME)
  installApplicationMenu()
  await activate()
}

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    void activate()
  })

  app.on('activate', () => {
    void activate()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', (event) => {
    if (quitting || (runtime === undefined && runtimeStarting === undefined)) return
    event.preventDefault()
    quitting = true
    void shutdownRuntime().finally(() => {
      app.quit()
    })
  })

  void app.whenReady()
    .then(boot)
    .catch((error: unknown) => {
      if (quitting) return
      const message = error instanceof Error ? error.stack ?? error.message : String(error)
      dialog.showErrorBox(`${APP_NAME} 启动失败`, message)
      app.quit()
    })
}
