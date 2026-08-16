import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, clipboard, nativeImage, dialog, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js'

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
let sqlModule: SqlJsStatic | null = null
let dbPath = ''
let configPath = ''
let clipboardTimer: ReturnType<typeof setInterval> | null = null
let isQuitting = false

// ── 自动更新（electron-updater，仅打包后生效；未安装依赖时静默禁用）──
let autoUpdater: any = null
let autoUpdaterError = ''
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  // @ts-ignore — electron-updater 可选依赖，未安装时静默降级
  const electronUpdater = require('electron-updater')
  autoUpdater = electronUpdater?.autoUpdater ?? null
} catch (err: any) {
  autoUpdaterError = err?.message ?? String(err)
  console.error('[Q-Paste] 加载 electron-updater 失败:', err)
}

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
  // 删除记录后清理不再被引用的图片文件
  cleanupOrphanImages()
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

/** 当前数据目录：配置的自定义路径或 userData */
function getDataDir(): string {
  return config.storagePath || app.getPath('userData')
}

// ── 图片落盘：DB 只存相对路径（images/xxx.png），避免 SQLite 存 base64 无限膨胀 ──

/** 图片目录（数据目录下） */
function getImagesDir(): string {
  return path.join(getDataDir(), 'images')
}

/** 保存 dataURL 图片到磁盘，返回相对路径（如 images/img_xxx.png）；失败返回 null */
function saveImageToDisk(dataUrl: string, hash: string): string | null {
  try {
    const m = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i)
    if (!m) return null
    const ext = m[1].toLowerCase() === 'jpeg' || m[1].toLowerCase() === 'jpg' ? 'jpg' : 'png'
    const dir = getImagesDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    // hash 含冒号（长度:值），文件名为安全字符：仅保留字母数字
    const safeHash = hash.replace(/[^a-zA-Z0-9]/g, '')
    const name = `img_${Date.now()}_${safeHash}.${ext}`
    fs.writeFileSync(path.join(dir, name), Buffer.from(m[2], 'base64'))
    return `images/${name}`
  } catch (err) {
    console.error('[Q-Paste] 图片落盘失败:', err)
    return null
  }
}

/** 从相对路径解析磁盘绝对路径（防路径穿越：仅允许 images 目录内） */
function resolveImagePath(relPath: string): string | null {
  if (!relPath || relPath.startsWith('data:')) return null
  const dir = path.resolve(getImagesDir())
  const abs = path.resolve(dir, relPath.replace(/^images[\\/]/, ''))
  if (!abs.startsWith(dir + path.sep)) return null
  return fs.existsSync(abs) ? abs : null
}

/** 读取图片文件并转 dataURL（供渲染层预览/写回剪贴板） */
function readImageAsDataUrl(relPath: string): string | null {
  const abs = resolveImagePath(relPath)
  if (!abs) return null
  try {
    const buf = fs.readFileSync(abs)
    const ext = path.extname(abs).toLowerCase()
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/** 删除磁盘上不再被任何记录引用的孤儿图片文件 */
function cleanupOrphanImages(): void {
  if (!db) return
  const dir = getImagesDir()
  if (!fs.existsSync(dir)) return
  let files: string[]
  try { files = fs.readdirSync(dir) } catch { return }
  for (const f of files) {
    if (!f.startsWith('img_')) continue
    const rel = `images/${f}`
    const stmt = db.prepare("SELECT COUNT(*) AS cnt FROM items WHERE type = 'image' AND content = :rel")
    stmt.bind({ ':rel': rel })
    let cnt = 0
    if (stmt.step()) cnt = (stmt.getAsObject().cnt as number) || 0
    stmt.free()
    if (cnt === 0) {
      try { fs.unlinkSync(path.join(dir, f)) } catch { /* 忽略删除失败 */ }
    }
  }
}

async function initDatabase(): Promise<void> {
  const userDataPath = app.getPath('userData')
  configPath = path.join(userDataPath, 'q-paste-config.json')
  loadConfig()

  // Use custom storage path if set, otherwise fallback to default
  const dataDir = getDataDir()
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
  dbPath = path.join(dataDir, 'q-paste.db')
  // 缓存 sql.js 模块实例，避免重复加载 WASM
  const SQL = sqlModule ?? (sqlModule = await initSqlJs({
    locateFile: (file: string) => {
      // Production: WASM copied to resources/ by electron-builder extraResources
      // Development: WASM inside node_modules/sql.js/dist/
      if (app.isPackaged) {
        return path.join(process.resourcesPath, file)
      }
      return path.join(__dirname, '../../node_modules/sql.js/dist', file)
    },
  }))

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

  // 一次性迁移：把旧版存在 DB 里的 base64 图片落盘，content 替换为相对路径（缩小 DB）
  migrateLegacyImages()

  saveDb()
}

/**
 * 迁移旧数据：type='image' 且 content 是 dataURL 的记录，把图片写入磁盘，
 * content 改为相对路径（images/xxx.png）。幂等：新数据 content 是路径，直接跳过。
 */
function migrateLegacyImages(): void {
  if (!db) return
  const stmt = db.prepare(
    "SELECT id, content FROM items WHERE type = 'image' AND content LIKE 'data:%'"
  )
  const ids: number[] = []
  const contents: string[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject()
    ids.push(row.id as number)
    contents.push(row.content as string)
  }
  stmt.free()

  for (let i = 0; i < ids.length; i++) {
    const rel = saveImageToDisk(contents[i], hashBuffer(Buffer.from(contents[i])))
    if (rel) {
      db.run('UPDATE items SET content = :rel WHERE id = :id', { ':rel': rel, ':id': ids[i] })
    }
  }
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
let lastHtmlContent = ''
let lastFileHash = ''
/** 应用自身写入剪贴板后的保护窗口（毫秒）：窗口内轮询直接跳过，避免自我捕获 */
let selfWriteUntil = 0

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

/** 从 Windows 剪贴板读取文件路径列表（FileNameW 格式：UTF-16LE，\0 分隔） */
function readClipboardFilePaths(): string[] | null {
  const formats = clipboard.availableFormats()
  if (!formats.includes('FileNameW')) return null
  const buf = clipboard.readBuffer('FileNameW')
  if (buf.length === 0) return null
  // UTF-16LE 解码后按 \0 切分（结尾通常也有一个 \0）
  const raw = buf.toString('utf16le')
  const paths = raw.split('\0').map((s) => s.trim()).filter(Boolean)
  return paths.length > 0 ? paths : null
}

/** 极简 HTML → 纯文本（主进程侧，供预览/写回剪贴板使用） */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function checkClipboard(): void {
  if (!mainWindow) return

  // 应用自身写入剪贴板后，跳过本轮轮询，避免自我捕获（复制自己的记录不再重复入账）
  if (Date.now() < selfWriteUntil) return

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

    // 图片落盘：DB 只存相对路径（images/xxx.png），避免 SQLite 存 base64 无限膨胀
    const relPath = saveImageToDisk(image.toDataURL(), hash)
    const size = image.getSize()
    const createdAt = nowLocal()
    mainWindow.webContents.send('clipboard-changed', {
      type: 'image',
      content: relPath || '', // 相对路径；落盘失败时为空（渲染层不再收到 base64）
      preview: `图片 ${size.width}×${size.height}`,
      storageSize: buf.length,
      createdAt,
    })
    return
  }

  // Files path（Windows：资源管理器复制文件时剪贴板带 FileNameW 格式）
  const filePaths = readClipboardFilePaths()
  if (filePaths && filePaths.length > 0) {
    const raw = filePaths.join('\0') + '\0'
    const hash = hashBuffer(Buffer.from(raw, 'utf16le'))
    if (hash === lastFileHash) return
    lastFileHash = hash

    const first = filePaths[0].replace(/\\/g, '/').split('/').pop() || filePaths[0]
    const createdAt = nowLocal()
    mainWindow.webContents.send('clipboard-changed', {
      type: 'files',
      content: JSON.stringify(filePaths),
      preview: `文件 ${filePaths.length} 个：${first}`,
      charCount: 0,
      storageSize: Buffer.byteLength(raw, 'utf16le'),
      createdAt,
    })
    return
  }

  // HTML path（富文本：浏览器/Word 等复制时同时带 text/plain 与 text/html，优先富文本）
  if (formats.includes('text/html')) {
    const html = clipboard.readHTML()
    if (html && html !== lastHtmlContent) {
      const plain = htmlToText(html)
      if (plain) {
        lastHtmlContent = html
        lastTextContent = plain
        const preview = plain.length > 100 ? plain.slice(0, 100) + '...' : plain
        const createdAt = nowLocal()
        mainWindow.webContents.send('clipboard-changed', {
          type: 'html',
          content: html,
          preview,
          charCount: plain.length,
          storageSize: Buffer.byteLength(html, 'utf8'),
          createdAt,
        })
        return
      }
    }
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
  // 设基线：启动/恢复监听时不捕获当前剪贴板已有内容（各格式行为一致）
  lastTextContent = clipboard.readText().trim() || ''
  const formats = clipboard.availableFormats()
  if (formats.includes('image/png') || formats.includes('image/jpeg')) {
    lastImageHash = hashBuffer(clipboard.readImage().toPNG())
  } else {
    lastImageHash = ''
  }
  if (formats.includes('text/html')) {
    lastHtmlContent = clipboard.readHTML()
    lastTextContent = htmlToText(lastHtmlContent) || lastTextContent
  } else {
    lastHtmlContent = ''
  }
  const filePaths = readClipboardFilePaths()
  if (filePaths && filePaths.length > 0) {
    lastFileHash = hashBuffer(Buffer.from(filePaths.join('\0') + '\0', 'utf16le'))
  } else {
    lastFileHash = ''
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

ipcMain.handle('db:get-items', (_event, { limit, offset, search, pinnedOnly }: { limit: number; offset: number; search?: string; pinnedOnly?: boolean }) => {
  if (!db) return []
  const q = (search || '').trim()
  // 列表查询：图片 content 置空（大文件落盘后按需读取，避免全量 base64 过 IPC）
  let sql =
    "SELECT id, type, CASE WHEN type = 'image' THEN '' ELSE content END AS content, preview, char_count, storage_size, created_at, is_pinned, alias, tags, is_sensitive FROM items"
  const binds: Record<string, any> = { ':limit': limit, ':offset': offset }
  const conditions: string[] = []
  if (q) {
    // 转义 LIKE 通配符，避免 % _ 被当作通配符
    const escaped = q.replace(/[\\%_]/g, (m) => '\\' + m)
    conditions.push(
      " (content LIKE :q ESCAPE '\\' OR preview LIKE :q ESCAPE '\\' OR alias LIKE :q ESCAPE '\\' OR tags LIKE :q ESCAPE '\\')"
    )
    binds[':q'] = `%${escaped}%`
  }
  if (pinnedOnly) {
    conditions.push(' is_pinned = 1')
  }
  if (conditions.length > 0) {
    sql += ' WHERE' + conditions.join(' AND')
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

/** 按 id 取完整 content：图片返回 dataURL（兼容旧 base64 与新落盘路径） */
ipcMain.handle('db:get-item-content', (_event, id: number) => {
  if (!db) return ''
  const stmt = db.prepare('SELECT type, content FROM items WHERE id = :id')
  stmt.bind({ ':id': id })
  let type = ''
  let content = ''
  if (stmt.step()) {
    const row = stmt.getAsObject()
    type = String(row.type || '')
    content = String(row.content || '')
  }
  stmt.free()
  if (type === 'image' && content && !content.startsWith('data:')) {
    // 新格式：content 是 images/xxx 相对路径，读文件转 dataURL
    return readImageAsDataUrl(content) || ''
  }
  return content
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
  cleanupOrphanImages()
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
      // 清理不再被引用的图片文件
      cleanupOrphanImages()
    } else if (type === 'all') {
      db.run('DELETE FROM items WHERE is_pinned = 0')
      cleanupOrphanImages()
      // 注意：不清理系统剪贴板，避免清空用户正在使用的剪贴板内容
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

// ── 自动更新（electron-updater）──

/** 推送更新状态给渲染层 */
function sendUpdateStatus(status: string, payload?: any): void {
  mainWindow?.webContents.send('update-status', { status, ...payload })
}

function setupAutoUpdater(): void {
  if (!autoUpdater) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'))
  autoUpdater.on('update-available', (info: any) => {
    sendUpdateStatus('available', { version: info.version, url: info.files?.[0]?.url })
  })
  autoUpdater.on('update-not-available', () => sendUpdateStatus('not-available'))
  autoUpdater.on('download-progress', (progress: any) => {
    sendUpdateStatus('downloading', { percent: Math.round(progress.percent ?? 0), transferred: progress.transferred, total: progress.total })
  })
  autoUpdater.on('update-downloaded', (info: any) => {
    sendUpdateStatus('downloaded', { version: info.version })
  })
  autoUpdater.on('error', (err: Error) => {
    sendUpdateStatus('error', { message: err?.message ?? String(err) })
  })
}

ipcMain.handle('update:check', () => {
  if (!autoUpdater) {
    const reason = autoUpdaterError
      ? `electron-updater 加载失败：${autoUpdaterError}`
      : '未安装 electron-updater 或未打包运行'
    return { success: false, error: reason }
  }
  if (!app.isPackaged) return { success: false, error: '开发模式下不检查更新（需打包安装后才能使用）' }
  try {
    autoUpdater.checkForUpdates().catch((err: any) => {
      sendUpdateStatus('error', { message: err?.message ?? String(err) })
    })
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) }
  }
})

ipcMain.handle('update:install', () => {
  if (!autoUpdater) return { success: false, error: '自动更新不可用' }
  try {
    autoUpdater.quitAndInstall()
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) }
  }
})

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
    // 图片落盘后 DB 只存路径：备份数据库时同步复制 images 目录，保证备份完整
    const srcImages = getImagesDir()
    let imagesCopied = false
    if (fs.existsSync(srcImages)) {
      const dstImages = result.filePath + '.images'
      fs.cpSync(srcImages, dstImages, { recursive: true })
      imagesCopied = true
    }
    return { success: true, path: result.filePath, imagesCopied }
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
    while (stmt.step()) {
      const row = stmt.getAsObject()
      // 图片 content 是相对路径：导出时转为 dataURL，保证 JSON 自包含
      if (row.type === 'image' && typeof row.content === 'string' && row.content && !row.content.startsWith('data:')) {
        row.content = readImageAsDataUrl(row.content) || ''
      }
      rows.push(row)
    }
    stmt.free()

    fs.writeFileSync(
      result.filePath,
      JSON.stringify(
        {
          app: 'Q-Paste',
          version: app.getVersion(),
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

// ── JSON 导入：从之前导出的备份恢复记录（按内容去重）──
ipcMain.handle('data:import-json', async () => {
  try {
    if (!db) throw new Error('数据库未就绪')
    if (!mainWindow) throw new Error('窗口未就绪')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '从 JSON 备份导入',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return { success: false, canceled: true }

    const raw = fs.readFileSync(result.filePaths[0], 'utf-8')
    const data = JSON.parse(raw)
    // 兼容两种结构：数组本身，或 { app, version, items: [...] }
    const rows: Record<string, any>[] = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : [])
    if (rows.length === 0) return { success: true, count: 0 }

    let imported = 0
    db.run('BEGIN TRANSACTION')
    try {
      for (const row of rows) {
        if (!row || typeof row.content !== 'string') continue
        const type = ['text', 'url', 'image', 'html', 'files'].includes(row.type) ? row.type : 'text'

        // 图片 content 是 dataURL（旧版或 JSON 自包含导出）：落盘转相对路径
        let content = row.content
        if (type === 'image' && content.startsWith('data:')) {
          const saved = saveImageToDisk(content, hashBuffer(Buffer.from(content)))
          if (!saved) continue // 图片数据损坏，跳过该条
          content = saved
        }

        // 内容去重：相同 type + content 已存在则跳过
        const dup = db.prepare('SELECT id FROM items WHERE type = :type AND content = :content LIMIT 1')
        dup.bind({ ':type': type, ':content': content })
        let exists = false
        if (dup.step()) exists = true
        dup.free()
        if (exists) continue

        const tags = Array.isArray(row.tags) ? row.tags : []
        db.run(
          `INSERT INTO items (type, content, preview, char_count, storage_size, created_at, is_pinned, alias, tags, is_sensitive)
           VALUES (:type, :content, :preview, :charCount, :storageSize, :createdAt, :isPinned, :alias, :tags, :isSensitive)`,
          {
            ':type': type,
            ':content': content,
            ':preview': typeof row.preview === 'string' ? row.preview : content.slice(0, 100),
            ':charCount': Number(row.char_count) || 0,
            ':storageSize': Number(row.storage_size) || Buffer.byteLength(content, 'utf8'),
            ':createdAt': typeof row.created_at === 'string' ? row.created_at : nowLocal(),
            ':isPinned': row.is_pinned ? 1 : 0,
            ':alias': typeof row.alias === 'string' ? row.alias : '',
            ':tags': JSON.stringify(tags),
            ':isSensitive': row.is_sensitive ? 1 : 0,
          }
        )
        imported++
      }
      db.run('COMMIT')
    } catch (err) {
      db.run('ROLLBACK')
      throw err
    }
    saveDb()
    return { success: true, count: imported }
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) }
  }
})

ipcMain.handle('clipboard:write-text', (_event, text: string) => {
  clipboard.writeText(text)
  // 应用自身写入系统剪贴板：更新基线 + 保护窗口，避免下一轮轮询重复捕获
  lastTextContent = text.trim() || ''
  lastImageHash = ''
  selfWriteUntil = Date.now() + 1000
  return true
})

ipcMain.handle('clipboard:write-image', (_event, content: string) => {
  // 兼容两种来源：旧数据 dataURL / 新数据相对路径（images/xxx.png）
  let img: Electron.NativeImage
  if (content && content.startsWith('data:')) {
    img = nativeImage.createFromDataURL(content)
  } else {
    const abs = resolveImagePath(content)
    if (!abs) return false
    img = nativeImage.createFromPath(abs)
  }
  clipboard.writeImage(img)
  lastImageHash = hashBuffer(img.toPNG())
  lastTextContent = clipboard.readText().trim() || ''
  selfWriteUntil = Date.now() + 1000
  return true
})

ipcMain.handle('clipboard:write-html', (_event, html: string) => {
  // 写回富文本（同时带纯文本兜底，保证粘贴到不支持 HTML 的程序也正常）
  const plain = htmlToText(html)
  clipboard.write({ html, text: plain })
  lastHtmlContent = html
  lastTextContent = plain
  lastImageHash = ''
  selfWriteUntil = Date.now() + 1000
  return true
})

ipcMain.handle('clipboard:write-files', (_event, paths: string[]) => {
  if (!Array.isArray(paths) || paths.length === 0) return false
  // 重新构造 FileNameW 格式（UTF-16LE，\0 分隔）写回，资源管理器可直接粘贴
  const raw = paths.join('\0') + '\0'
  clipboard.writeBuffer('FileNameW', Buffer.from(raw, 'utf16le'))
  lastFileHash = hashBuffer(Buffer.from(raw, 'utf16le'))
  lastTextContent = clipboard.readText().trim() || ''
  lastImageHash = ''
  selfWriteUntil = Date.now() + 1000
  return true
})

ipcMain.handle('shell:open-url', (_event, url: string) => {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    shell.openExternal(url)
    return true
  } catch {
    return false
  }
})

ipcMain.handle('shell:open-file', (_event, filePath: string) => {
  if (typeof filePath !== 'string' || !filePath) return false
  shell.openPath(filePath)
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
  try {
    // 旧数据目录：当前配置的自定义路径或默认 userData
    const oldDataDir = getDataDir()
    const newDataDir = path.resolve(newPath)

    // 选择的目录与当前数据目录相同：无需迁移，直接成功返回
    if (path.resolve(oldDataDir) === newDataDir) {
      return { success: true }
    }

    // 1. 停止监听并落盘当前数据库（先停监听避免迁移期间新增内容，保证拷贝的是最新数据）
    stopClipboardMonitor()
    if (db) saveDb()

    // 2. 拷贝数据库与图片目录到新位置（源 = 旧数据目录，而非写死 userData）
    //    配置文件始终固定在 userData/q-paste-config.json，无需迁移
    if (!fs.existsSync(newDataDir)) {
      fs.mkdirSync(newDataDir, { recursive: true })
    }
    const srcDb = path.join(oldDataDir, 'q-paste.db')
    const dstDb = path.join(newDataDir, 'q-paste.db')
    if (fs.existsSync(srcDb)) {
      fs.copyFileSync(srcDb, dstDb)
    }
    // 迁移图片目录（图片落盘后 DB 只存相对路径，图片文件必须跟随迁移）
    const srcImages = path.join(oldDataDir, 'images')
    const dstImages = path.join(newDataDir, 'images')
    if (fs.existsSync(srcImages)) {
      fs.cpSync(srcImages, dstImages, { recursive: true })
    }

    // 3. 校验数据库文件确实迁移成功，失败则回滚配置，不重启
    const hadDb = fs.existsSync(srcDb)
    const dbMigrated = fs.existsSync(dstDb)
    if (hadDb && !dbMigrated) {
      throw new Error('数据库文件迁移失败')
    }

    // 4. 迁移成功后才更新配置，确保下次启动读取新路径
    config.storagePath = newDataDir
    saveConfig()

    // 5. 关闭当前数据库并强制重启
    if (db) { db.close(); db = null }
    isQuitting = true
    app.relaunch()
    app.exit(0)
    return { success: true }
  } catch (err: any) {
    // 迁移失败：恢复剪贴板监听，应用继续使用旧数据目录
    if (!clipboardTimer) startClipboardMonitor()
    console.error('[Q-Paste] 存储路径迁移失败:', err)
    return { success: false, error: err?.message ?? String(err) }
  }
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

    // 自动更新：仅打包后启动检查；开发模式跳过
    if (app.isPackaged) {
      setupAutoUpdater()
      try { autoUpdater?.checkForUpdates() } catch {}
    }
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
