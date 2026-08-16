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
  is_pinned: number
  alias: string
  tags: string
  is_sensitive: number
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
  /** 记录保留天数：数字或 'forever'（未设置 = 不自动清理） */
  retentionDays?: number | 'forever'
  /** 最大记录条数（未设置 = 不自动裁剪） */
  maxRecords?: number
  /** 忽略捕获规则：正则表达式列表，匹配的剪贴板内容不捕获 */
  ignorePatterns?: string[]
  /** 重复内容自动去重置顶（false 时保留重复记录） */
  dedupeOnCapture?: boolean
}

const defaultConfig: AppConfig = {
  toggleShortcut: 'Alt+Space',
  autoStart: true,
  startMinimized: true,
  retentionDays: 'forever',
  maxRecords: 500,
  dedupeOnCapture: true,
}
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

// ── 保留策略：仅清理未收藏的记录，金库数据永远保留 ──

let retentionTimer: ReturnType<typeof setInterval> | null = null

/** 按保留天数清理过期记录（retentionDays 未设置或为 'forever' 时跳过） */
function enforceRetention(): void {
  if (!db) return
  const days = config.retentionDays
  if (!days || days === 'forever') return
  db.run(
    `DELETE FROM items WHERE is_pinned = 0 AND created_at < datetime('now', 'localtime', '-${days} days')`
  )
}

/** 超出最大记录条数时，裁剪最旧的未收藏记录 */
function enforceMaxRecords(): void {
  if (!db) return
  const max = config.maxRecords
  if (!max || max <= 0) return

  const stmt = db.prepare('SELECT COUNT(*) AS total, SUM(is_pinned) AS pinned FROM items')
  let total = 0
  let pinned = 0
  if (stmt.step()) {
    const row = stmt.getAsObject()
    total = (row.total as number) || 0
    pinned = (row.pinned as number) || 0
  }
  stmt.free()

  const allowedUnpinned = Math.max(0, max - pinned)
  const unpinned = total - pinned
  if (unpinned <= allowedUnpinned) return

  // 保留最新 allowedUnpinned 条未收藏记录，删除其余更旧的
  db.run(
    `DELETE FROM items WHERE is_pinned = 0 AND id NOT IN (
       SELECT id FROM items WHERE is_pinned = 0 ORDER BY created_at DESC, id DESC LIMIT :keep
     )`,
    { ':keep': allowedUnpinned }
  )
}

function enforceRetentionRules(): void {
  enforceRetention()
  enforceMaxRecords()
}

function startRetentionTimer(): void {
  if (retentionTimer) clearInterval(retentionTimer)
  retentionTimer = setInterval(() => {
    enforceRetentionRules()
    saveDb()
  }, 60 * 60 * 1000) // 每小时执行一次
}

function stopRetentionTimer(): void {
  if (retentionTimer) {
    clearInterval(retentionTimer)
    retentionTimer = null
  }
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

  // 迁移：添加金库功能字段（幂等 — 列已存在则忽略）
  const migrations = [
    "ALTER TABLE items ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE items ADD COLUMN alias TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE items ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE items ADD COLUMN is_sensitive INTEGER NOT NULL DEFAULT 0",
  ]
  for (const sql of migrations) {
    try { db!.run(sql) } catch { /* 列已存在，忽略 */ }
  }

  saveDb()
}

/** 返回本地时间字符串 YYYY-MM-DD HH:mm:ss */
function nowLocal(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
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

/** 剪贴板文本是否命中忽略规则（正则列表） */
function isIgnoredContent(text: string): boolean {
  const patterns = config.ignorePatterns ?? []
  if (patterns.length === 0) return false
  for (const p of patterns) {
    try {
      if (new RegExp(p).test(text)) return true
    } catch {
      // 忽略非法正则
    }
  }
  return false
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
    const createdAt = nowLocal()
    mainWindow.webContents.send('clipboard-changed', {
      type: 'image',
      content: dataUrl,
      preview: `图片 ${size.width}×${size.height}`,
      storageSize: buf.length,
      createdAt,
    })
    return
  }

  // Text path
  const text = clipboard.readText().trim()
  if (!text || text === lastTextContent) return
  lastTextContent = text

  // 忽略规则：匹配正则的内容不捕获（如密码管理器复制的密码）
  if (isIgnoredContent(text)) {
    console.log('[Q-Paste] 剪贴板内容命中忽略规则，已跳过')
    return
  }

  const isUrl = /^https?:\/\/\S+/i.test(text)
  const preview = text.length > 100 ? text.slice(0, 100) + '...' : text
  const createdAt = nowLocal()

  mainWindow.webContents.send('clipboard-changed', {
    type: isUrl ? 'url' : 'text',
    content: text,
    preview,
    charCount: text.length,
    storageSize: Buffer.byteLength(text, 'utf8'),
    createdAt,
  })
}

function startClipboardMonitor(): void {
  // 设基线：启动/恢复监听时不捕获当前剪贴板已有内容（文本与图片行为一致）
  lastTextContent = clipboard.readText().trim() || ''
  const formats = clipboard.availableFormats()
  if (formats.includes('image/png') || formats.includes('image/jpeg')) {
    lastImageHash = hashBuffer(clipboard.readImage().toPNG())
  } else {
    lastImageHash = ''
  }
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
    return path.join(process.resourcesPath, 'tray-icon.ico')
  }
  return path.join(__dirname, '../../build/tray-icon.ico')
}

let monitoringPaused = false

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

  const buildMenu = () => Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => showWindow(),
    },
    {
      label: '打开设置',
      click: () => {
        showWindow()
        mainWindow?.webContents.send('open-settings')
      },
    },
    { type: 'separator' },
    {
      label: monitoringPaused ? '恢复监听剪贴板' : '暂停监听剪贴板',
      click: () => {
        monitoringPaused = !monitoringPaused
        if (monitoringPaused) {
          stopClipboardMonitor()
        } else {
          startClipboardMonitor()
        }
        tray?.setContextMenu(buildMenu())
      },
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
  tray.setContextMenu(buildMenu())
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

  // Hide to tray instead of closing (Windows/Linux)；macOS 关窗即退出，由 activate 重建
  mainWindow.on('close', (e) => {
    if (process.platform !== 'darwin' && !isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ── IPC handlers ──

ipcMain.handle('db:get-items', (_event, { limit, offset, search }: { limit: number; offset: number; search?: string }) => {
  if (!db) return []
  const q = (search || '').trim()
  let sql =
    'SELECT id, type, content, preview, char_count, storage_size, created_at, is_pinned, alias, tags, is_sensitive FROM items'
  const binds: Record<string, any> = { ':limit': limit, ':offset': offset }
  if (q) {
    // 转义 LIKE 通配符，避免 % _ 被当作通配符
    const escaped = q.replace(/[\\%_]/g, (m) => '\\' + m)
    sql +=
      " WHERE content LIKE :q ESCAPE '\\' OR preview LIKE :q ESCAPE '\\' OR alias LIKE :q ESCAPE '\\' OR tags LIKE :q ESCAPE '\\'"
    binds[':q'] = `%${escaped}%`
  }
  // created_at 精度到秒，同秒多条用 id 兜底保证稳定排序
  sql += ' ORDER BY created_at DESC, id DESC LIMIT :limit OFFSET :offset'
  const stmt = db.prepare(sql)
  stmt.bind(binds)
  const items: StoredItem[] = []
  while (stmt.step()) {
    items.push(stmt.getAsObject() as unknown as StoredItem)
  }
  stmt.free()
  return items
})

ipcMain.handle('db:insert-item', (_event, item: { type: string; content: string; preview: string; charCount: number; storageSize: number; createdAt: string; isSensitive?: boolean }) => {
  if (!db) return null

  // 内容去重置顶（可配置）：文本/URL 存在相同内容的未收藏记录时，复用该记录并更新到最新（避免重复堆积）
  if (config.dedupeOnCapture !== false && item.type !== 'image' && item.content) {
    const dup = db.prepare('SELECT id FROM items WHERE type = :type AND content = :content AND is_pinned = 0 LIMIT 1')
    dup.bind({ ':type': item.type, ':content': item.content })
    let dupId: number | null = null
    if (dup.step()) dupId = (dup.getAsObject().id as number) ?? null
    dup.free()

    if (dupId !== null) {
      db.run(
        `UPDATE items SET preview = :preview, char_count = :charCount, storage_size = :storageSize, created_at = :createdAt WHERE id = :id`,
        {
          ':id': dupId,
          ':preview': item.preview,
          ':charCount': item.charCount,
          ':storageSize': item.storageSize,
          ':createdAt': item.createdAt,
        }
      )
      saveDb()
      return { id: dupId, updated: true }
    }
  }

  db.run(
    `INSERT INTO items (type, content, preview, char_count, storage_size, created_at, is_sensitive)
     VALUES (:type, :content, :preview, :charCount, :storageSize, :createdAt, :isSensitive)`,
    {
      ':type': item.type,
      ':content': item.content,
      ':preview': item.preview,
      ':charCount': item.charCount,
      ':storageSize': item.storageSize,
      ':createdAt': item.createdAt,
      ':isSensitive': item.isSensitive ? 1 : 0,
    }
  )
  const res = db.exec('SELECT last_insert_rowid()')
  const id = res[0]?.values[0]?.[0] ?? null
  saveDb()
  enforceMaxRecords()
  return { id, updated: false }
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

ipcMain.handle('db:update-item-meta', (_event, params: { id: number; isPinned?: boolean; alias?: string; tags?: string; isSensitive?: boolean }) => {
  if (!db) return false
  const sets: string[] = []
  const binds: Record<string, any> = { ':id': params.id }

  if (typeof params.isPinned === 'boolean') {
    sets.push('is_pinned = :isPinned')
    binds[':isPinned'] = params.isPinned ? 1 : 0
  }
  if (typeof params.alias === 'string') {
    sets.push('alias = :alias')
    binds[':alias'] = params.alias
  }
  if (typeof params.tags === 'string') {
    sets.push('tags = :tags')
    binds[':tags'] = params.tags
  }
  if (typeof params.isSensitive === 'boolean') {
    sets.push('is_sensitive = :isSensitive')
    binds[':isSensitive'] = params.isSensitive ? 1 : 0
  }

  if (sets.length === 0) return false
  db.run(`UPDATE items SET ${sets.join(', ')} WHERE id = :id`, binds)
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
      db.run("DELETE FROM items WHERE type = 'image' AND is_pinned = 0")
    } else if (type === 'all') {
      db.run('DELETE FROM items WHERE is_pinned = 0')
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

// ── 保留策略（保留时间 / 最大记录条数）──
ipcMain.handle('settings:get-retention', () => {
  return {
    retentionDays: config.retentionDays ?? 'forever',
    maxRecords: config.maxRecords ?? 500,
  }
})

ipcMain.handle('settings:set-retention', (_event, settings: { retentionDays?: number | 'forever'; maxRecords?: number }) => {
  if (settings.retentionDays !== undefined) {
    const v = settings.retentionDays
    config.retentionDays = v === 'forever' || v === 7 || v === 30 || v === 90 ? v : 'forever'
  }
  if (settings.maxRecords !== undefined) {
    const n = Math.round(Number(settings.maxRecords))
    config.maxRecords = Number.isFinite(n) && n > 0 ? Math.min(9999, Math.max(100, n)) : undefined
  }
  saveConfig()
  enforceRetentionRules()
  saveDb()
  return { success: true }
})

// ── 捕获规则（忽略规则 / 去重置顶开关）──
ipcMain.handle('settings:get-capture-rules', () => {
  return {
    ignorePatterns: config.ignorePatterns ?? [],
    dedupeOnCapture: config.dedupeOnCapture ?? true,
  }
})

ipcMain.handle('settings:set-capture-rules', (_event, settings: { ignorePatterns?: string[]; dedupeOnCapture?: boolean }) => {
  if (Array.isArray(settings.ignorePatterns)) {
    // 过滤空串与非法正则
    const valid: string[] = []
    for (const p of settings.ignorePatterns) {
      const s = String(p).trim()
      if (!s) continue
      try { new RegExp(s); valid.push(s) } catch { /* 忽略非法正则 */ }
    }
    config.ignorePatterns = valid
  }
  if (typeof settings.dedupeOnCapture === 'boolean') {
    config.dedupeOnCapture = settings.dedupeOnCapture
  }
  saveConfig()
  return { success: true }
})

// ── 版本号（与 package.json 保持一致）──
ipcMain.handle('app:get-version', () => app.getVersion())

// ── 数据备份 / 导出 ──
ipcMain.handle('data:export-db', async () => {
  try {
    if (!db) throw new Error('数据库未就绪')
    if (!mainWindow) throw new Error('窗口未就绪')
    saveDb() // 确保导出的是最新数据
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '备份数据库文件',
      defaultPath: `q-paste-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }
    fs.copyFileSync(dbPath, result.filePath)
    return { success: true, path: result.filePath }
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) }
  }
})

ipcMain.handle('data:export-json', async () => {
  try {
    if (!db) throw new Error('数据库未就绪')
    if (!mainWindow) throw new Error('窗口未就绪')
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出 JSON 备份',
      defaultPath: `q-paste-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }

    const rows: Record<string, any>[] = []
    const stmt = db.prepare(
      'SELECT id, type, content, preview, char_count, storage_size, created_at, is_pinned, alias, tags, is_sensitive FROM items ORDER BY id'
    )
    while (stmt.step()) rows.push(stmt.getAsObject())
    stmt.free()

    fs.writeFileSync(
      result.filePath,
      JSON.stringify(
        {
          app: 'Q-Paste',
          version: '1.2.0',
          exportedAt: new Date().toISOString(),
          count: rows.length,
          items: rows,
        },
        null,
        2
      ),
      'utf-8'
    )
    return { success: true, path: result.filePath }
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
  isQuitting = true
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
    // Windows 任务栏/通知归属标识
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.qpaste.app')
    }

    await initDatabase()
    // 启动时执行一次保留策略（仅清理未收藏记录）
    enforceRetentionRules()
    saveDb()

    // 应用自启设置（Windows 注册表）
    app.setLoginItemSettings({ openAtLogin: config.autoStart ?? true })

    createWindow()
    createTray()
    registerGlobalShortcut()
    startClipboardMonitor()
    startRetentionTimer()
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
    stopRetentionTimer()
    globalShortcut.unregisterAll()
    if (db) { saveDb(); db.close() }
  })
}
