import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, clipboard, nativeImage, dialog, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'

interface StoredItem {
  id: number
  type: string
  content: string
  preview: string
  char_count: number
  storage_size: number
  created_at: string
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let db: SqlJsDatabase | null = null
let dbPath = ''
let configPath = ''
let clipboardTimer: ReturnType<typeof setInterval> | null = null
let isQuitting = false

interface AppConfig {
  toggleShortcut: string
  storagePath?: string
  autoStart?: boolean
  startMinimized?: boolean
}

const defaultConfig: AppConfig = { toggleShortcut: 'Alt+Space', autoStart: true, startMinimized: true }
let config: AppConfig = { ...defaultConfig }

function loadConfig(): void {
  try {
    if (fs.existsSync(configPath)) {
      config = { ...defaultConfig, ...JSON.parse(fs.readFileSync(configPath, 'utf-8')) }
    } else {
      config = { ...defaultConfig }
      saveConfig()
    }
  } catch {
    config = { ...defaultConfig }
  }
}

function saveConfig(): void {
  try { fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8') } catch {}
}

function saveDb(): void {
  if (!db) return
  fs.writeFileSync(dbPath, Buffer.from(db.export()))
}

async function initDatabase(): Promise<void> {
  const userDataPath = app.getPath('userData')
  configPath = path.join(userDataPath, 'q-paste-config.json')
  loadConfig()

  // Use custom storage path if set, otherwise fallback to default
  const dataDir = config.storagePath || userDataPath
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
  dbPath = path.join(dataDir, 'q-paste.db')
  const SQL = await initSqlJs({
    locateFile: (file: string) => {
      // Production: WASM copied to resources/ by electron-builder extraResources
      // Development: WASM inside node_modules/sql.js/dist/
      if (app.isPackaged) {
        return path.join(process.resourcesPath, file)
      }
      return path.join(__dirname, '../../node_modules/sql.js/dist', file)
    },
  })

  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath)
    db = new SQL.Database(buf)
  } else {
    db = new SQL.Database()
  }

  db!.run('PRAGMA journal_mode = WAL')

  db!.run(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      preview TEXT NOT NULL DEFAULT '',
      char_count INTEGER NOT NULL DEFAULT 0,
      storage_size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `)
  saveDb()
}

// ══════════════════════════════════════════════════════════════
// Clipboard monitor — high-frequency polling + format sniffing
// ══════════════════════════════════════════════════════════════

const IMAGE_SIZE_LIMIT_MB = 10
let lastTextContent = ''
let lastImageHash = ''

/** Lightweight hash of a Buffer — avoids expensive crypto for large images */
function hashBuffer(buf: Buffer): string {
  let h = 0
  // Sample up to 4096 bytes spread across the buffer
  const step = Math.max(1, Math.floor(buf.length / 64))
  for (let i = 0; i < buf.length; i += step) {
    h = ((h << 5) - h + buf[i]) | 0
  }
  return `${buf.length}:${h}`
}

function checkClipboard(): void {
  if (!mainWindow) return

  // ── 1. Format sniffing (lightweight, no heavy read) ──
  const formats = clipboard.availableFormats()

  // Image path
  if (formats.includes('image/png') || formats.includes('image/jpeg')) {
    const image = clipboard.readImage()
    if (image.isEmpty()) return // Still writing — wait for next poll

    const buf = image.toPNG()
    const hash = hashBuffer(buf)

    // Duplicate check
    if (hash === lastImageHash) return
    lastImageHash = hash

    // Size threshold
    const sizeMB = buf.length / (1024 * 1024)
    if (sizeMB > IMAGE_SIZE_LIMIT_MB) {
      console.log(`[Q-Paste] 图片 ${sizeMB.toFixed(1)} MB 超过上限 ${IMAGE_SIZE_LIMIT_MB} MB，已拦截`)
      return
    }

    const dataUrl = image.toDataURL()
    const size = image.getSize()
    mainWindow.webContents.send('clipboard-changed', {
      type: 'image',
      content: dataUrl,
      preview: `图片 ${size.width}×${size.height}`,
      storageSize: buf.length,
    })
    return
  }

  // Text path
  const text = clipboard.readText().trim()
  if (!text || text === lastTextContent) return
  lastTextContent = text

  const isUrl = /^https?:\/\/\S+/i.test(text)
  const preview = text.length > 100 ? text.slice(0, 100) + '...' : text

  mainWindow.webContents.send('clipboard-changed', {
    type: isUrl ? 'url' : 'text',
    content: text,
    preview,
    charCount: text.length,
    storageSize: Buffer.byteLength(text, 'utf8'),
  })
}

function startClipboardMonitor(): void {
  lastTextContent = clipboard.readText().trim() || ''
  clipboardTimer = setInterval(checkClipboard, 500)
}

function stopClipboardMonitor(): void {
  if (clipboardTimer) {
    clearInterval(clipboardTimer)
    clipboardTimer = null
  }
}

// ── Tray ──

function getIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icon.png')
  }
  return path.join(__dirname, '../../build/icon.png')
}

function createTray(): void {
  let icon: Electron.NativeImage

  const iconPath = getIconPath()
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath)
  } else {
    // 图标文件缺失，创建纯色占位图标（16x16 RGBA）
    console.warn(`[Q-Paste] 托盘图标未找到: ${iconPath}，使用占位图标`)
    const buf = Buffer.alloc(16 * 16 * 4)
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = 59; buf[i + 1] = 130; buf[i + 2] = 246; buf[i + 3] = 255 // 蓝色 #3b82f6
    }
    icon = nativeImage.createFromBuffer(buf, { width: 16, height: 16 })
  }

  // 不强制 resize，让系统根据 DPI 自动缩放
  tray = new Tray(icon)
  tray.setToolTip('Q-Paste')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => showWindow(),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => showWindow())
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow()
  } else {
    mainWindow.show()
    mainWindow.focus()
  }
}

// ── Global shortcut ──

function toggleWindowShortcut() {
  if (mainWindow?.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide()
  } else {
    showWindow()
  }
}

function registerGlobalShortcut(): void {
  const shortcut = config.toggleShortcut || defaultConfig.toggleShortcut
  try {
    const registered = globalShortcut.register(shortcut, toggleWindowShortcut)
    if (!registered) {
      console.warn(`Global shortcut "${shortcut}" registration failed — may conflict with another app`)
    }
  } catch (err) {
    console.error(`Failed to register global shortcut "${shortcut}":`, err)
  }
}

function updateGlobalShortcut(newShortcut: string): boolean {
  // Unregister old
  const oldShortcut = config.toggleShortcut
  globalShortcut.unregister(oldShortcut)

  // Register new
  try {
    const registered = globalShortcut.register(newShortcut, toggleWindowShortcut)
    if (!registered) {
      // Rollback: re-register old shortcut
      console.warn(`Shortcut "${newShortcut}" registration failed, reverting to "${oldShortcut}"`)
      globalShortcut.register(oldShortcut, toggleWindowShortcut)
      return false
    }
    config.toggleShortcut = newShortcut
    saveConfig()
    return true
  } catch (err) {
    console.error(`Failed to register shortcut "${newShortcut}":`, err)
    globalShortcut.register(oldShortcut, toggleWindowShortcut)
    return false
  }
}

// ── Window ──

function createWindow(): void {
  const hideOnStart = config.autoStart && config.startMinimized
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 700,
    minHeight: 450,
    backgroundColor: '#09090b',
    title: 'Q-Paste',
    titleBarStyle: 'hiddenInset',
    frame: process.platform === 'darwin' ? false : true,
    show: !hideOnStart,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Hide to tray instead of closing on non-macOS
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ── IPC handlers ──

ipcMain.handle('db:get-items', (_event, { limit, offset }: { limit: number; offset: number }) => {
  if (!db) return []
  const stmt = db.prepare(
    'SELECT id, type, content, preview, char_count, storage_size, created_at FROM items ORDER BY created_at DESC LIMIT :limit OFFSET :offset'
  )
  stmt.bind({ ':limit': limit, ':offset': offset })
  const items: StoredItem[] = []
  while (stmt.step()) {
    items.push(stmt.getAsObject() as unknown as StoredItem)
  }
  stmt.free()
  return items
})

ipcMain.handle('db:insert-item', (_event, item: { type: string; content: string; preview: string; charCount: number; storageSize: number }) => {
  if (!db) return null
  db.run(
    `INSERT INTO items (type, content, preview, char_count, storage_size)
     VALUES (:type, :content, :preview, :charCount, :storageSize)`,
    {
      ':type': item.type,
      ':content': item.content,
      ':preview': item.preview,
      ':charCount': item.charCount,
      ':storageSize': item.storageSize,
    }
  )
  const res = db.exec('SELECT last_insert_rowid()')
  saveDb()
  return res[0]?.values[0]?.[0] ?? null
})

ipcMain.handle('db:delete-item', (_event, id: number) => {
  if (!db) return false
  db.run('DELETE FROM items WHERE id = :id', { ':id': id })
  saveDb()
  return true
})

ipcMain.handle('db:update-item', (_event, { id, content, preview, charCount, storageSize }: { id: number; content: string; preview: string; charCount: number; storageSize: number }) => {
  if (!db) return false
  db.run(
    'UPDATE items SET content = :content, preview = :preview, char_count = :charCount, storage_size = :storageSize WHERE id = :id',
    { ':id': id, ':content': content, ':preview': preview, ':charCount': charCount, ':storageSize': storageSize }
  )
  saveDb()
  return true
})

ipcMain.handle('db:get-item-count', () => {
  if (!db) return 0
  const stmt = db.prepare('SELECT COUNT(*) AS cnt FROM items')
  let count = 0
  if (stmt.step()) {
    count = stmt.getAsObject().cnt as number
  }
  stmt.free()
  return count
})

ipcMain.handle('db:get-storage-usage', () => {
  if (!db) return { textBytes: 0, imageBytes: 0, totalBytes: 0 }
  const stmt = db.prepare(
    "SELECT type, SUM(storage_size) AS size FROM items GROUP BY type"
  )
  let textBytes = 0
  let imageBytes = 0
  while (stmt.step()) {
    const row = stmt.getAsObject()
    if (row.type === 'image') imageBytes += (row.size as number) || 0
    else textBytes += (row.size as number) || 0
  }
  stmt.free()
  // Also count the db file overhead
  const dbFileBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0
  return { textBytes, imageBytes, totalBytes: dbFileBytes }
})

// ── 空间释放：force-clear-data（'images' | 'all'）──
ipcMain.handle('force-clear-data', async (_event, type: string) => {
  try {
    if (!db) throw new Error('数据库未就绪')

    if (type === 'images') {
      db.run("DELETE FROM items WHERE type = 'image'")
    } else if (type === 'all') {
      db.run('DELETE FROM items')
      clipboard.clear()
    } else {
      throw new Error('无效的清理类型：' + type)
    }

    saveDb()
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) }
  }
})

ipcMain.handle('clipboard:write-text', (_event, text: string) => {
  clipboard.writeText(text)
  return true
})

ipcMain.handle('clipboard:write-image', (_event, dataUrl: string) => {
  const img = nativeImage.createFromDataURL(dataUrl)
  clipboard.writeImage(img)
  return true
})

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})

ipcMain.handle('window:close', () => {
  mainWindow?.hide()
})

// ── Auto-start ──
ipcMain.handle('autostart:get', () => {
  return {
    autoStart: config.autoStart ?? true,
    startMinimized: config.startMinimized ?? true,
  }
})

ipcMain.handle('autostart:set', (_event, settings: { autoStart?: boolean; startMinimized?: boolean }) => {
  if (typeof settings.autoStart === 'boolean') {
    config.autoStart = settings.autoStart
    app.setLoginItemSettings({ openAtLogin: settings.autoStart })
  }
  if (typeof settings.startMinimized === 'boolean') {
    config.startMinimized = settings.startMinimized
  }
  saveConfig()
  return { success: true }
})

ipcMain.handle('shortcut:get', () => {
  return config.toggleShortcut
})

ipcMain.handle('shortcut:update', (_event, newShortcut: string) => {
  const success = updateGlobalShortcut(newShortcut)
  return { success, shortcut: success ? newShortcut : config.toggleShortcut }
})

ipcMain.handle('config:get-path', () => {
  return config.storagePath || app.getPath('userData')
})

ipcMain.handle('dialog:select-directory', async () => {
  if (!mainWindow) return { canceled: true, path: null }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择数据存储目录',
    properties: ['openDirectory', 'createDirectory'],
  })
  return { canceled: result.canceled, path: result.filePaths[0] ?? null }
})

ipcMain.handle('shell:open-folder', (_event, dirPath: string) => {
  shell.openPath(dirPath)
})

ipcMain.handle('storage:change-path', async (_event, newPath: string) => {
  // 1. 保存新路径到配置文件，确保下次启动生效
  config.storagePath = newPath
  saveConfig()

  // 2. 迁移数据：关闭当前数据库，将文件拷贝到新目录
  stopClipboardMonitor()
  if (db) { saveDb(); db.close(); db = null }

  const newDir = path.join(newPath, 'Q-Paste-Data')
  if (!fs.existsSync(newDir)) {
    fs.mkdirSync(newDir, { recursive: true })
  }

  // 拷贝数据库和配置文件到新目录
  const filesToCopy = ['q-paste.db', 'q-paste-config.json']
  for (const file of filesToCopy) {
    const src = path.join(app.getPath('userData'), file)
    const dst = path.join(newDir, file)
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst)
    }
  }

  // 3. 强制重启
  app.relaunch()
  app.exit(0)
})

// ── Single instance lock ──
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showWindow()
  })

  // ── App lifecycle ──

  // Hide default menu bar (File, Edit, View...)
  Menu.setApplicationMenu(null)

  app.whenReady().then(async () => {
    await initDatabase()

    // 应用自启设置（Windows 注册表）
    app.setLoginItemSettings({ openAtLogin: config.autoStart ?? true })

    createWindow()
    createTray()
    registerGlobalShortcut()
    startClipboardMonitor()
  })

  app.on('window-all-closed', () => {
    // Don't quit — keep running in tray
  })

  app.on('activate', () => {
    // macOS: re-create window when dock icon clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  app.on('before-quit', () => {
    isQuitting = true
    stopClipboardMonitor()
    globalShortcut.unregisterAll()
    if (db) { saveDb(); db.close() }
  })
}
