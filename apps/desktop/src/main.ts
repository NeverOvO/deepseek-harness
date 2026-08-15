import { app, BrowserWindow, dialog, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { installApplicationMenu } from './menu.ts'
import {
  startDesktopRuntime,
  stopDesktopRuntime,
  type DesktopRuntime,
} from './runtime.ts'

const APP_NAME = '八奈见工作台'
const DEFAULT_WIDTH = 1440
const DEFAULT_HEIGHT = 920
const MIN_WIDTH = 1080
const MIN_HEIGHT = 700

let mainWindow: BrowserWindow | undefined
let runtime: DesktopRuntime | undefined
let quitting = false

function preloadPath(): string {
  return fileURLToPath(new URL('./preload.js', import.meta.url))
}

async function ensureRuntime(): Promise<DesktopRuntime> {
  runtime ??= await startDesktopRuntime()
  return runtime
}

async function createMainWindow(): Promise<BrowserWindow> {
  const activeRuntime = await ensureRuntime()
  const isMac = process.platform === 'darwin'

  const window = new BrowserWindow({
    title: APP_NAME,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: '#f6fbff',
    ...(isMac
      ? {
        titleBarStyle: 'hiddenInset' as const,
        trafficLightPosition: { x: 18, y: 18 },
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

  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(activeRuntime.url)) event.preventDefault()
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })

  await window.loadURL(activeRuntime.url)
  return window
}

async function activate(): Promise<void> {
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return
  }
  mainWindow = await createMainWindow()
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
    if (quitting || runtime === undefined) return
    event.preventDefault()
    quitting = true
    void stopDesktopRuntime(runtime).finally(() => {
      runtime = undefined
      app.quit()
    })
  })

  void app.whenReady()
    .then(boot)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error)
      dialog.showErrorBox(`${APP_NAME} 启动失败`, message)
      app.quit()
    })
}
