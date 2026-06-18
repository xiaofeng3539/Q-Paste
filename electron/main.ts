import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, clipboard, nativeImage } from 'electron'
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
}

const defaultConfig: AppConfig = { toggleShortcut: 'Alt+Space' }
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
  dbPath = path.join(userDataPath, 'q-paste.db')
  configPath = path.join(userDataPath, 'q-paste-config.json')
  loadConfig()
  const SQL = await initSqlJs()

  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath)
    db = new SQL.Database(buf)
  } else {
    db = new SQL.Database()
  }

  db.run('PRAGMA journal_mode = WAL')

  db.run(`
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

function createTrayIcon(): Electron.NativeImage {
  // 16x16 tray icon — simple clipboard shape drawn programmatically
  const size = 16
  const canvas = Buffer.alloc(size * size * 4, 0) // RGBA
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      // Clipboard body: rounded rect from (2,1) to (13,14)
      const inBody = x >= 2 && x <= 13 && y >= 1 && y <= 14 && !(x < 4 && y < 3) && !(x > 11 && y < 3) && !(x < 4 && y > 12) && !(x > 11 && y > 12)
      // Clip at top center
      const inClip = y >= 0 && y <= 2 && x >= 5 && x <= 10
      if (inBody || inClip) {
        canvas[i] = 180     // R
        canvas[i + 1] = 180 // G
        canvas[i + 2] = 180 // B
        canvas[i + 3] = 255 // A
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size })
}

function createTray(): void {
  tray = new Tray(createTrayIcon())
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
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 700,
    minHeight: 450,
    backgroundColor: '#09090b',
    title: 'Q-Paste',
    titleBarStyle: 'hiddenInset',
    frame: process.platform === 'darwin' ? false : true,
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

ipcMain.handle('shortcut:get', () => {
  return config.toggleShortcut
})

ipcMain.handle('shortcut:update', (_event, newShortcut: string) => {
  const success = updateGlobalShortcut(newShortcut)
  return { success, shortcut: success ? newShortcut : config.toggleShortcut }
})

// ── App lifecycle ──

// Hide default menu bar (File, Edit, View...)
Menu.setApplicationMenu(null)

app.whenReady().then(async () => {
  await initDatabase()
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
