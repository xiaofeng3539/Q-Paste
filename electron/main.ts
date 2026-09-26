import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, clipboard, nativeImage, dialog, shell, protocol, net, nativeTheme, safeStorage, screen } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js'
import log from 'electron-log'
import { createHash, randomUUID } from 'node:crypto'
import { SyncEngine } from '../src/main/sync/SyncEngine'
import { WebDavService, verifyWebDav } from '../src/main/sync/WebDavService'
import type { ClipboardSyncItem, ClipboardSyncType, CloudSyncStatus, WebDavToggleResult } from '../src/main/sync/types'
import { FileTransferServer, getAvailableIps, guessMime, FILE_TRANSFER_DEFAULT_PORT, type FtStatus } from './file-transfer/server'
import { ensureStorageLayout, getStorageLayout, type StorageLayout } from '../src/main/storage-layout'
import { prepareStorageRoot, writeStorageRootPointer } from '../src/main/storage-migration'
import { cleanupStaleTempFiles } from '../src/main/temp-cleanup'
import { resolveAppMode, type AppMode } from '../src/lib/app-mode'
import { persistClipboardCapture, type ClipboardCapture } from '../src/main/clipboard-capture'
import { FloralNotesStore } from './floral/notes-store'
import { copyExistingFloralData } from './floral/data-migration'
import { findFloralSurfaceWindow } from './floral/surface-window'
import { broadcastFloralEvent } from './floral/event-broadcast'
import { toFloralUpdateState, type HostUpdateStatus } from './floral/host-update'

interface StoredItem {
  id: number
  type: string
  content: string
  preview: string
  char_count: number
  storage_size: number
  created_at: string
  is_pinned: number
  pinned_at: string | null
  alias: string
  tags: string
  is_sensitive: number
  sort_order?: number | null
  vault_sort_order?: number | null
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
const pendingInstallReports = new Map<string, Map<number, (ready: boolean) => void>>()

// 文件传输聊天视图的本地文件流式预览（等价 Tiez convertFileSrc；须在 app ready 前注册）
protocol.registerSchemesAsPrivileged([
  { scheme: 'ft-file', privileges: { stream: true, supportFetchAPI: true, bypassCSP: true } },
])
let db: SqlJsDatabase | null = null
let sqlModule: SqlJsStatic | null = null
let dbPath = ''
let configPath = ''
let storageLayout: StorageLayout | null = null
let floralStore: FloralNotesStore | null = null
let floralDataRoot = ''
const floralSurfaceWindows = new Map<string, BrowserWindow>()
let floralNoteShortcut = ''
let clipboardTimer: ReturnType<typeof setInterval> | null = null
const pendingOversizeCaptures: Array<{ content: string; kb: number }> = []
let isQuitting = false
let dbIntegrityIssue = false // 启动完整性检查发现异常时置位
let legacyMaxSortOrder = 0 // 迁移回填时历史记录的最大 sort_order，供新条目置顶基准（启动后由实际 MAX 兜底）
let legacyMaxVaultSortOrder = 0 // 迁移回填时金库记录的最大 vault_sort_order，供新收藏置顶基准
const BOOT_T0 = Date.now() // 冷启动耗时基线

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
  activeMode?: AppMode
  qPasteDeleteShortcut?: string
  floralDataDir?: string
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
  /** 单条捕获上限（KB），超大内容跳过捕获防库膨胀；0 = 不限制 */
  maxCaptureKb?: number
  /** 云同步（WebDAV，多设备）：连接信息与开关 */
  cloudSyncEnabled?: boolean
  cloudSyncUrl?: string
  cloudSyncUsername?: string
  cloudSyncPassword?: string
  cloudSyncBasePath?: string
  cloudSyncIntervalSecs?: number
  cloudSyncDeviceId?: string
  /** 云端快照内容哈希：数据无变化时跳过重复上传 */
  cloudSnapshotHash?: string
  /** 首次启用后的全量上传是否已完成（存量历史上云，一次即可） */
  cloudSyncFullPushDone?: boolean
  /** 局域网文件传输（手机 ↔ PC）：服务配置 */
  fileTransferEnabled?: boolean
  fileTransferPort?: number
  fileTransferPath?: string
  /** 绑定的网卡 IP（空 = 全部接口 0.0.0.0） */
  fileTransferBindIp?: string
  fileTransferAutoOpen?: boolean
  /** 5 分钟无传输自动关闭（Tiez file_transfer_auto_close） */
  fileTransferAutoClose?: boolean
  /** 接收后自动复制/入库（Tiez auto_copy_file） */
  fileTransferAutoCopy?: boolean
}

const defaultConfig: AppConfig = {
  toggleShortcut: 'Alt+Space',
  qPasteDeleteShortcut: 'D',
  autoStart: true,
  startMinimized: true,
  retentionDays: 'forever',
  maxRecords: 500,
  dedupeOnCapture: true,
  maxCaptureKb: 1024,
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
    // 主进程日志落盘（console.error/log 重定向到统一目录 logs/main.log）
    try {
      log.transports.file.resolvePathFn = () => path.join(getStorageLayoutOrThrow().logsDir, 'main.log')
      log.transports.file.maxSize = 5 * 1024 * 1024
      const origError = console.error.bind(console)
      console.error = (...args: unknown[]) => {
        origError(...args)
        log.error(...args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a))))
      }
      const origInfo = console.log.bind(console)
      console.log = (...args: unknown[]) => {
        origInfo(...args)
        log.info(...args.map((a) => String(a)))
      }
    } catch {}

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

function getStorageLayoutOrThrow(): StorageLayout {
  if (!storageLayout) throw new Error('存储目录尚未初始化')
  return storageLayout
}

function getOcrConfig(): { langPath: string; workerPath: string; corePath: string } {
  const ocrDir = app.isPackaged
    ? path.join(process.resourcesPath, 'ocr')
    : path.join(app.getAppPath(), 'build', 'ocr')
  const workerFile = path.join(ocrDir, 'worker.min.js')
  const coreDir = path.join(ocrDir, 'core')
  const requiredFiles = [
    path.join(ocrDir, 'chi_sim.traineddata.gz'),
    path.join(ocrDir, 'eng.traineddata.gz'),
    workerFile,
    path.join(coreDir, 'tesseract-core.wasm.js'),
    path.join(coreDir, 'tesseract-core-simd.wasm.js'),
    path.join(coreDir, 'tesseract-core-lstm.wasm.js'),
    path.join(coreDir, 'tesseract-core-simd-lstm.wasm.js'),
  ]
  const missing = requiredFiles.find((file) => !fs.existsSync(file))
  if (missing) throw new Error(`OCR 本地资源缺失：${path.basename(missing)}`)
  return {
    langPath: pathToFileURL(ocrDir).toString(),
    workerPath: pathToFileURL(workerFile).toString(),
    corePath: pathToFileURL(coreDir).toString(),
  }
}

// ── 图片落盘：DB 只存相对路径（images/xxx.png），避免 SQLite 存 base64 无限膨胀 ──

/** 图片目录（数据目录下） */
function getImagesDir(): string {
  return getStorageLayoutOrThrow().imagesDir
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
  const legacyConfigPath = path.join(userDataPath, 'q-paste-config.json')
  const pointerPath = path.join(userDataPath, 'q-paste-storage-root.json')
  const prepared = prepareStorageRoot({ pointerPath, legacyConfigPath, userDataPath })
  storageLayout = prepared.layout
  configPath = storageLayout.configPath
  loadConfig()
  config.storagePath = storageLayout.rootDir
  floralDataRoot = config.floralDataDir ? path.join(config.floralDataDir, 'floral') : storageLayout.floralDir
  if (!config.floralDataDir) {
    try {
      const legacyFloral = path.join(app.getPath('documents'), '花笺')
      if (await copyExistingFloralData(legacyFloral, floralDataRoot)) console.log('[Q-Paste] 已复制现有花笺数据，源目录保留:', legacyFloral)
    } catch (error) { log.error('Failed to copy existing Floral data:', error) }
  }
  dbPath = storageLayout.dbPath
  ensureStorageLayout(storageLayout)
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

  // 数据恢复扫描：枚举数据目录全部库文件候选（含 .bak / .pre-rollback / history.* / .tmp 残留），
  // 逐一校验完整性（可解析 + integrity_check + items 行数），按数据量择优加载；绝不删除任何原文件
  const bakPath = dbPath + '.bak'
  const candidates = new Set<string>([
    dbPath, bakPath, dbPath + '.pre-rollback',
    path.join(storageLayout.databaseDir, 'history.db'), path.join(storageLayout.databaseDir, 'history.bak'),
  ])
  try {
    for (const f of fs.readdirSync(storageLayout.databaseDir)) {
      if (/(?:^|\/)history\.(?:db|bak)$|\.db\.tmp$|\.pre-rollback$/.test(f)) candidates.add(path.join(storageLayout.databaseDir, f))
    }
  } catch {}
  const evaluate = (file: string): { ok: boolean; count: number } => {
    let probe: any = null
    try {
      if (!fs.existsSync(file) || fs.statSync(file).size === 0) return { ok: false, count: -1 }
      probe = new SQL.Database(fs.readFileSync(file))
      probe.exec('SELECT COUNT(*) FROM sqlite_master')
      const r = probe.exec('SELECT COUNT(*) FROM items')
      const count = Number(r[0]?.values[0]?.[0] ?? 0)
      probe.exec('PRAGMA integrity_check')
      probe.close()
      return { ok: true, count }
    } catch {
      try { probe?.close() } catch {}
      return { ok: false, count: -1 }
    }
  }
  const ranked = [...candidates]
    .filter((f) => fs.existsSync(f))
    .map((f) => ({ file: f, mtime: fs.statSync(f).mtimeMs, ...evaluate(f) }))
    .sort((x, y) => y.count - x.count || y.mtime - x.mtime)
  for (const c of ranked) {
    console.log(`[Q-Paste] 库文件候选: ${path.basename(c.file)} 可用=${c.ok} 条数=${c.count}`)
  }
  const mainEval = ranked.find((c) => c.file === dbPath)
  let chosen = ranked[0]
  if (mainEval?.ok && mainEval.count >= (chosen?.count ?? 0)) chosen = mainEval
  if (chosen?.ok) {
    if (chosen.file !== dbPath) {
      // 主库不是最优：以最优候选覆盖主库（原主库保留为 .damaged，绝不删除）
      try { fs.copyFileSync(dbPath, dbPath + '.damaged') } catch {}
      fs.copyFileSync(chosen.file, dbPath)
      console.error(`[Q-Paste] 主库数据(${mainEval?.count ?? 0}条)少于候选(${chosen.count}条)，已从 ${path.basename(chosen.file)} 恢复`)
    }
    const buf = fs.readFileSync(dbPath)
    db = new SQL.Database(buf)
  } else {
    console.error('[Q-Paste] 未找到任何可用数据库文件，以空库启动（原文件全部保留待人工恢复）')
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
    "ALTER TABLE items ADD COLUMN pinned_at TEXT",
    "ALTER TABLE items ADD COLUMN sort_order REAL",
    "ALTER TABLE items ADD COLUMN vault_sort_order REAL",
  ]
  for (const sql of migrations) {
    try { db!.run(sql) } catch { /* 列已存在，忽略 */ }
  }
  // 存量收藏没有收藏时间：以复制时间兜底，保证金库可按收藏先后稳定排序
  db!.run("UPDATE items SET pinned_at = created_at WHERE is_pinned = 1 AND pinned_at IS NULL")
  // 自定义拖拽排序：存量数据无 sort_order 时，以复制时间兜底（数值越大越靠前，与默认时间倒序一致）
  {
    const stmt = db!.prepare(
      "SELECT id, created_at FROM items WHERE sort_order IS NULL"
    )
    let maxSo = 0
    while (stmt.step()) {
      const row = stmt.getAsObject() as { id: number; created_at: string }
      const so = localDateToMs(row.created_at)
      if (so > maxSo) maxSo = so
      db!.run("UPDATE items SET sort_order = :so WHERE id = :id", { ':so': so, ':id': row.id })
    }
    stmt.free()
    // 防止置顶时新条目 sort_order 与旧值碰撞：以当前最大值为基准，首个新条目 +1
    legacyMaxSortOrder = maxSo
  }
  // 金库自定义拖拽排序：存量收藏无 vault_sort_order 时，以收藏时间兜底（与默认收藏倒序一致）
  {
    const stmt = db!.prepare(
      "SELECT id, pinned_at, created_at FROM items WHERE is_pinned = 1 AND vault_sort_order IS NULL"
    )
    let maxVso = 0
    while (stmt.step()) {
      const row = stmt.getAsObject() as { id: number; pinned_at: string | null; created_at: string }
      const so = localDateToMs(row.pinned_at || row.created_at)
      if (so > maxVso) maxVso = so
      db!.run("UPDATE items SET vault_sort_order = :so WHERE id = :id", { ':so': so, ':id': row.id })
    }
    stmt.free()
    legacyMaxVaultSortOrder = maxVso
  }

  // 回滚迁移：移除优化期新增的 content_hash 冗余列（幂等；未加过该列的库静默跳过）
  try { db!.exec('ALTER TABLE items DROP COLUMN content_hash') } catch { /* 列不存在或已回滚 */ }

  // 查询性能索引（幂等）
  db!.run('CREATE INDEX IF NOT EXISTS idx_items_created ON items (created_at DESC, id DESC)')
  db!.run('CREATE INDEX IF NOT EXISTS idx_items_type ON items (type)')
  db!.run('CREATE INDEX IF NOT EXISTS idx_items_pinned ON items (is_pinned)')

  // 完整性检查：异常置位（窗口就绪后提示用户）
  try {
    const ic = db!.exec('PRAGMA integrity_check')
    const status = String(ic[0]?.values[0]?.[0] ?? 'ok')
    if (status !== 'ok') {
      dbIntegrityIssue = true
      console.error('[Q-Paste] 数据库完整性异常:', status)
    }
  } catch { /* 检查失败不阻塞启动 */ }

  // 一次性迁移：把旧版存在 DB 里的 base64 图片落盘，content 替换为相对路径（缩小 DB）
  migrateLegacyImages()

  // 启动补录：上次运行中入库失败进入待写队列的记录（数据零丢失兜底）
  try {
    const qPath = path.join(storageLayout.databaseDir, 'pending-inserts.json')
    if (fs.existsSync(qPath)) {
      const arr = JSON.parse(fs.readFileSync(qPath, 'utf-8')) as Array<Record<string, unknown>>
      let ok = 0
      for (const it of arr) {
        if (insertItemDb(it as any)) ok++
      }
      if (ok > 0) {
        saveDb()
        console.log(`[Q-Paste] 已补录 ${ok}/${arr.length} 条待写记录`)
      }
      if (ok === arr.length) fs.rmSync(qPath, { force: true })
      else fs.writeFileSync(qPath, JSON.stringify(arr.slice(ok)), 'utf-8')
    }
  } catch (err) {
    console.error('[Q-Paste] 待写队列补录失败（原队列保留）:', err)
  }

  saveDb()
  if (prepared.isNewPointer) writeStorageRootPointer(pointerPath, storageLayout.rootDir)
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

function recordClipboardCapture(capture: ClipboardCapture): void {
  const result = persistClipboardCapture(
    capture,
    insertItemDbWithRetry,
    (item) => mainWindow?.webContents.send('clipboard-changed', item),
  )
  if (result) void pushCaptureToCloud(capture)
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
    recordClipboardCapture({
      type: 'image',
      content: relPath || '', // 相对路径；落盘失败时为空（渲染层不再收到 base64）
      preview: `图片 ${size.width}×${size.height}`,
      charCount: 0,
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
    recordClipboardCapture({
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
        const maxBytes = (config.maxCaptureKb ?? 1024) * 1024
        if (maxBytes > 0 && Buffer.byteLength(html, 'utf8') > maxBytes) {
          mainWindow?.webContents.send('clipboard:capture-skipped', Math.round(maxBytes / 1024))
          return
        }
       lastHtmlContent = html
        lastTextContent = plain
        const preview = plain.length > 100 ? plain.slice(0, 100) + '...' : plain
        const createdAt = nowLocal()
        recordClipboardCapture({
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
  // 单条捕获超限：交由用户弹窗选择「完整保留 / 截断保留」，确认后经 insert-oversize 入库（永不静默丢弃）
  const maxBytes = (config.maxCaptureKb ?? 1024) * 1024
  lastTextContent = text
  if (maxBytes > 0 && Buffer.byteLength(text, 'utf8') > maxBytes) {
    pendingOversizeCaptures.push({
      content: text,
      kb: Math.round(maxBytes / 1024),
    })
    if (pendingOversizeCaptures.length === 1 && resolveAppMode(config.activeMode) === 'clipboard') {
      mainWindow?.webContents.send('clipboard:oversize-confirm', pendingOversizeCaptures[0])
    }
    return
  }

  // 忽略规则：匹配正则的内容不捕获（如密码管理器复制的密码）
  if (isIgnoredContent(text)) {
    console.log('[Q-Paste] 剪贴板内容命中忽略规则，已跳过')
    return
  }

  const isUrl = /^https?:\/\/\S+/i.test(text)
  const preview = text.length > 100 ? text.slice(0, 100) + '...' : text
  const createdAt = nowLocal()

  recordClipboardCapture({
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
  clipboardTimer = setInterval(checkClipboard, clipboardPollMs)
}

/** 前台高频捕获，后台降频省电；窗口显示/隐藏时切换 */
let clipboardPollMs = 500

function setClipboardPollRate(ms: number): void {
  clipboardPollMs = ms
  if (clipboardTimer) {
    clearInterval(clipboardTimer)
    clipboardTimer = setInterval(checkClipboard, clipboardPollMs)
  }
}

function stopClipboardMonitor(): void {
  if (clipboardTimer) {
    clearInterval(clipboardTimer)
    clipboardTimer = null
  }
}

// ── Tray ──

function getIconPath(): string {
  // 官方原始图标（512×512 RGBA，含完整透明通道）：托盘与标题栏共用，系统按 DPI 自动缩放
  if (app.isPackaged) {
    const packaged = path.join(process.resourcesPath, 'icon.png')
    if (fs.existsSync(packaged)) return packaged
    return path.join(process.resourcesPath, 'tray-icon.ico')
  }
  const devPng = path.join(__dirname, '../../build/icon.png')
  if (fs.existsSync(devPng)) return devPng
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
    {
      label: '新建花笺便签',
      click: () => openFloralSurface('notepad'),
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

const MAIN_WINDOW_DEFAULT_WIDTH = 1180
const MAIN_WINDOW_DEFAULT_HEIGHT = 760

function restoreMainWindowDefaultSize(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const workArea = screen.getDisplayMatching(mainWindow.getBounds()).workArea
  const width = Math.min(MAIN_WINDOW_DEFAULT_WIDTH, workArea.width)
  const height = Math.min(MAIN_WINDOW_DEFAULT_HEIGHT, workArea.height)
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  mainWindow.setBounds({
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  })
}

function createWindow(): void {
  // 「启动后最小化到系统托盘」：开启时窗口驻留托盘不弹出，关闭时正常显示并前置
  const startMinimizedToTray = config.startMinimized === true
  const workArea = screen.getPrimaryDisplay().workArea

  mainWindow = new BrowserWindow({
    width: Math.min(MAIN_WINDOW_DEFAULT_WIDTH, workArea.width),
    height: Math.min(MAIN_WINDOW_DEFAULT_HEIGHT, workArea.height),
    minWidth: 700,
    minHeight: 450,
    // 真实透明：仅标题栏区域透出桌面/后方窗口，内容区由页面自绘不透明背景承接
    transparent: process.platform === 'win32',
    frame: false,
    backgroundColor: '#00000000',
    title: 'Q-Paste',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.platform === 'win32') {
    // 拖动区域的双击由 Windows 作为标题栏消息处理，页面不一定收到双击事件。
    mainWindow.hookWindowMessage(0x00a3, (wParam) => {
      if (wParam.readUInt32LE(0) !== 2) return // WM_NCLBUTTONDBLCLK / HTCAPTION
      const window = mainWindow
      if (!window || window.isDestroyed()) return
      let restored = false
      const restore = () => {
        if (restored) return
        restored = true
        window.removeListener('maximize', restore)
        window.removeListener('unmaximize', restore)
        if (window === mainWindow) setImmediate(restoreMainWindowDefaultSize)
      }
      window.once('maximize', restore)
      window.once('unmaximize', restore)
      setTimeout(restore, 100)
    })
  }

  if (resolveAppMode(config.activeMode) === 'floral') {
    void mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'floral', 'index.html'))
  } else if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // 加载完成后：未开启启动最小化 → 显示、激活并前置；已开启 → 驻留托盘不弹出
  mainWindow.once('ready-to-show', () => {
    if (dbIntegrityIssue) mainWindow?.webContents.send('db:integrity-issue', true)
    if (startMinimizedToTray) return
    mainWindow?.show()
    mainWindow?.focus()
  })

  // 最大化状态同步给渲染层（自定义标题栏按钮图标切换）
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximize-changed', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximize-changed', false))

  mainWindow.on('show', () => setClipboardPollRate(500))
  mainWindow.on('hide', () => setClipboardPollRate(1500))

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

ipcMain.handle('app:switch-mode', async (event, requestedMode: unknown, requestedDeleteShortcut?: unknown) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { success: false, error: 'invalid-window' }
  const mode = resolveAppMode(requestedMode)
  if (requestedMode !== mode) return { success: false, error: 'invalid-mode' }
  const previousMode = resolveAppMode(config.activeMode)
  try {
    if (mode === 'floral') {
      await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'floral', 'index.html'))
    } else if (process.env.VITE_DEV_SERVER_URL) {
      await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    } else {
      await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
    }
    if (mode === 'floral' && typeof requestedDeleteShortcut === 'string' && requestedDeleteShortcut.trim()) {
      config.qPasteDeleteShortcut = requestedDeleteShortcut.trim()
    }
    config.activeMode = mode
    saveConfig()
    return { success: true }
  } catch (error) {
    log.error('Failed to switch application mode:', error)
    try {
      if (previousMode === 'floral') await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'floral', 'index.html'))
      else if (process.env.VITE_DEV_SERVER_URL) await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
      else await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
    } catch (rollbackError) {
      log.error('Failed to restore previous application mode:', rollbackError)
    }
    return { success: false, error: 'load-failed' }
  }
})

ipcMain.handle('app:get-q-paste-delete-shortcut', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return 'D'
  return config.qPasteDeleteShortcut || 'D'
})

function getFloralStore(): FloralNotesStore {
  if (!storageLayout) throw new Error('Floral storage is not initialized')
  if (!floralDataRoot) floralDataRoot = storageLayout.floralDir
  if (!floralStore || floralStore.root !== floralDataRoot) floralStore = new FloralNotesStore(floralDataRoot)
  return floralStore
}

function assertFloralSender(event: Electron.IpcMainInvokeEvent): void {
  if (mainWindow && event.sender === mainWindow.webContents) return
  if ([...floralSurfaceWindows.values()].some((window) => !window.isDestroyed() && event.sender === window.webContents)) return
  throw new Error('Invalid Floral IPC sender')
}

function openFloralSurface(kind: 'notepad' | 'tile', noteId?: string, bounds?: { x: number; y: number; width: number; height: number } | null): string {
  if (!mainWindow) throw new Error('Main window is not available')
  const key = kind === 'tile' ? `tile:${noteId}` : `notepad:${noteId || 'new'}`
  const existing = floralSurfaceWindows.get(key)
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    if (kind === 'notepad') existing.webContents.send('floral:event:notepad:activate', 'main')
    return key
  }
  const child = new BrowserWindow({
    parent: mainWindow,
    width: Math.max(kind === 'tile' ? 180 : 260, Math.min(1600, Number(bounds?.width) || (kind === 'tile' ? 220 : 360))),
    height: Math.max(kind === 'tile' ? 180 : 320, Math.min(1400, Number(bounds?.height) || (kind === 'tile' ? 220 : 440))),
    x: Number.isFinite(bounds?.x) ? bounds!.x : undefined,
    y: Number.isFinite(bounds?.y) ? bounds!.y : undefined,
    frame: false,
    transparent: kind === 'tile',
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  floralSurfaceWindows.set(key, child)
  child.once('ready-to-show', () => child.show())
  child.on('closed', () => { if (floralSurfaceWindows.get(key) === child) floralSurfaceWindows.delete(key) })
  void child.loadFile(path.join(app.getAppPath(), 'dist', 'floral', 'index.html'), {
    query: { view: kind, ...(noteId ? { noteId } : {}) },
  })
  return key
}

function applyFloralShortcuts(saved: { globalShortcut?: string }): void {
  if (floralNoteShortcut) globalShortcut.unregister(floralNoteShortcut)
  floralNoteShortcut = ''
  const noteShortcut = String(saved.globalShortcut ?? '')
  if (noteShortcut && noteShortcut !== config.toggleShortcut && globalShortcut.register(noteShortcut, () => { openFloralSurface('notepad') })) {
    floralNoteShortcut = noteShortcut
  }
}

ipcMain.handle('floral:invoke', async (event, command: string, input?: any, options?: any) => {
  assertFloralSender(event)
  const store = getFloralStore()
  let result: unknown
  let changedEvent: 'notes-changed' | 'config-changed' | null = null
  switch (command) {
    case 'notes_list': result = await store.listNotes(); break
    case 'notes_get': result = await store.getNote(input?.id); break
    case 'notes_create': result = await store.createNote(input?.request); changedEvent = 'notes-changed'; break
    case 'notes_update': result = await store.updateNote(input?.id, input?.request); changedEvent = 'notes-changed'; break
    case 'notes_delete': result = await store.deleteNote(input?.id); changedEvent = 'notes-changed'; break
    case 'notes_move_category': result = await store.moveCategory(input?.id, input?.category); changedEvent = 'notes-changed'; break
    case 'notes_reorder': result = await store.reorderNotes(input?.category, input?.orderedIds); changedEvent = 'notes-changed'; break
    case 'categories_list': result = await store.listCategories(); break
    case 'categories_create': result = await store.createCategory(input?.name); changedEvent = 'notes-changed'; break
    case 'categories_rename': result = await store.renameCategory(input?.oldName, input?.newName); changedEvent = 'notes-changed'; break
    case 'categories_delete': result = await store.deleteCategory(input?.name); changedEvent = 'notes-changed'; break
    case 'config_get': result = { ...(await store.getConfig()), toggleVisibilityShortcut: config.toggleShortcut }; break
    case 'config_save': {
      result = await store.saveConfig({ ...input?.config, toggleVisibilityShortcut: config.toggleShortcut })
      applyFloralShortcuts(result as { globalShortcut?: string })
      changedEvent = 'config-changed'
      break
    }
    case 'config_migrate_data_dir': {
      const selected = path.resolve(String(input?.newDataDir ?? ''))
      if (!path.isAbsolute(selected) || selected === path.parse(selected).root) throw new Error('Invalid Floral data directory')
      const nextRoot = path.join(selected, 'floral')
      if (path.resolve(nextRoot) !== path.resolve(store.root)) {
        if (!await copyExistingFloralData(store.root, nextRoot)) throw new Error('目标目录已存在或原花笺数据无效，未覆盖')
        floralDataRoot = nextRoot
        floralStore = new FloralNotesStore(nextRoot)
        config.floralDataDir = selected
        saveConfig()
      }
      result = { ...(await getFloralStore().getConfig()), dataDir: selected, toggleVisibilityShortcut: config.toggleShortcut }
      changedEvent = 'config-changed'
      break
    }
    case 'images_save': {
      const bytes = input instanceof Uint8Array ? input : Array.isArray(input) ? Uint8Array.from(input) : null
      if (!bytes || bytes.byteLength > 25 * 1024 * 1024) throw new Error('Invalid or oversized image data')
      const headers = options?.headers ?? {}
      result = await store.saveImage(String(headers['x-note-id'] ?? ''), bytes, String(headers['x-image-ext'] ?? ''))
      break
    }
    case 'images_save_from_path': {
      const ext = path.extname(String(input?.filePath ?? '')).slice(1)
      if (!['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext.toLowerCase())) throw new Error('Unsupported image format')
      const stat = await fs.promises.stat(input.filePath)
      if (stat.size > 25 * 1024 * 1024) throw new Error('Image file is too large')
      result = await store.saveImage(String(input.noteId), await fs.promises.readFile(input.filePath), ext)
      break
    }
    case 'images_get_base_dir': result = store.root; break
    case 'copy_background_image': {
      const source = String(input?.sourcePath ?? '')
      const ext = path.extname(source).slice(1).toLowerCase()
      if (!['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) throw new Error('Unsupported background image format')
      const stat = await fs.promises.stat(source)
      if (stat.size > 30 * 1024 * 1024) throw new Error('Background image is too large')
      const dir = path.join(store.root, 'backgrounds')
      await fs.promises.mkdir(dir, { recursive: true })
      const destination = path.join(dir, `background-${randomUUID()}.${ext}`)
      await fs.promises.copyFile(source, destination)
      result = destination; break
    }
    case 'images_clean_unused': {
      const dir = path.join(store.root, 'images', String(input?.noteId ?? ''))
      if (!path.resolve(dir).startsWith(path.resolve(store.root) + path.sep)) throw new Error('Invalid image directory')
      const removed: string[] = []
      for (const name of await fs.promises.readdir(dir).catch(() => [] as string[])) {
        if (!String(input?.content ?? '').includes(`images/${input.noteId}/${name}`)) {
          await fs.promises.rm(path.join(dir, name), { force: true }); removed.push(name)
        }
      }
      result = removed; break
    }
    case 'notes_import_markdown': result = await store.importMarkdown(input?.path, input?.category ?? ''); changedEvent = 'notes-changed'; break
    case 'notes_export_markdown': result = await store.exportMarkdown(input?.id, input?.path); break
    case 'read_external_file': {
      const file = String(input?.path ?? '')
      if (path.extname(file).toLowerCase() !== '.md') throw new Error('Only Markdown files are supported')
      if ((await fs.promises.stat(file)).size > 20 * 1024 * 1024) throw new Error('Markdown file is too large')
      result = await fs.promises.readFile(file, 'utf8'); break
    }
    case 'save_external_file': {
      const file = String(input?.path ?? '')
      if (path.extname(file).toLowerCase() !== '.md') throw new Error('Only Markdown files are supported')
      await fs.promises.mkdir(path.dirname(file), { recursive: true }); await fs.promises.writeFile(file, String(input?.content ?? ''), 'utf8'); result = undefined; break
    }
    case 'get_file_modified_time': result = (await fs.promises.stat(String(input?.path ?? ''))).mtimeMs; break
    case 'global_shortcut_check': {
      const shortcut = String(input?.shortcut ?? '')
      const valid = /^[A-Za-z]+\+(?:[A-Za-z]+\+)*[A-Za-z0-9]+$/.test(shortcut)
      const current = floralNoteShortcut === shortcut
      const conflicts = shortcut === config.toggleShortcut || (globalShortcut.isRegistered(shortcut) && !current)
      result = { available: valid && (!conflicts || current), conflictType: !valid ? 'invalid' : current ? 'current' : conflicts ? 'registered' : 'none', message: '' }
      break
    }
    case 'shared_visibility_shortcut_check': {
      const shortcut = String(input?.shortcut ?? '')
      const valid = /^[A-Za-z]+\+(?:[A-Za-z]+\+)*[A-Za-z0-9]+$/.test(shortcut)
      const current = shortcut === config.toggleShortcut
      const conflicts = shortcut === floralNoteShortcut || (globalShortcut.isRegistered(shortcut) && !current)
      result = { available: valid && (!conflicts || current), conflictType: !valid ? 'invalid' : current ? 'current' : conflicts ? 'registered' : 'none', message: '' }
      break
    }
    case 'shared_visibility_shortcut_update': {
      const shortcut = String(input?.shortcut ?? '')
      const valid = /^[A-Za-z]+\+(?:[A-Za-z]+\+)*[A-Za-z0-9]+$/.test(shortcut)
      const success = valid && (shortcut === config.toggleShortcut || (shortcut !== floralNoteShortcut && updateGlobalShortcut(shortcut)))
      result = { success, shortcut: config.toggleShortcut }
      break
    }
    case 'start_shortcut_recording':
    case 'stop_shortcut_recording':
      result = undefined; break
    case 'start_window_drag_with_offset': {
      const dx = Number(input?.dx)
      const dy = Number(input?.dy)
      if (Number.isFinite(dx) && Number.isFinite(dy)) {
        const targetWindow = BrowserWindow.fromWebContents(event.sender)
        if (targetWindow && !targetWindow.isDestroyed()) {
          const bounds = targetWindow.getBounds()
          targetWindow.setBounds({
            ...bounds,
            x: Math.round(bounds.x + dx),
            y: Math.round(bounds.y + dy),
          })
        }
      }
      result = undefined; break
    }
    case 'take_startup_file': result = null; break
    case 'update_status': result = toFloralUpdateState(currentUpdateStatus, app.getVersion()); break
    case 'update_install_prepare_report': {
      const reports = pendingInstallReports.get(String(input?.requestId ?? ''))
      const report = reports?.get(event.sender.id)
      if (report) {
        reports!.delete(event.sender.id)
        report(input?.status === 'ready')
      }
      result = undefined; break
    }
    case 'open_notepad_window': result = openFloralSurface('notepad', input?.noteId ?? undefined, input?.bounds); break
    case 'open_tile_window': result = openFloralSurface('tile', input?.noteId, input?.bounds); break
    case 'toggle_tile_window': {
      const key = `tile:${input?.noteId}`
      const current = floralSurfaceWindows.get(key)
      if (current && !current.isDestroyed()) { current.close(); result = false }
      else { openFloralSurface('tile', input?.noteId, input?.bounds); result = true }
      break
    }
    case 'open_note_in_editor':
      if (mainWindow) {
        if (resolveAppMode(config.activeMode) !== 'floral') await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'floral', 'index.html'))
        config.activeMode = 'floral'; saveConfig()
        mainWindow.webContents.send('floral:event:open-note', String(input?.noteId ?? ''))
        mainWindow.show(); mainWindow.focus()
      }
      result = undefined; break
    case 'recycle_notepad_window': {
      const window = findFloralSurfaceWindow(floralSurfaceWindows.values(), event.sender)
      window?.hide(); result = undefined; break
    }
    default: throw new Error(`Unsupported Floral command: ${command}`)
  }
  if (changedEvent === 'config-changed') {
    broadcastFloralEvent(floralSurfaceWindows.values(), mainWindow, changedEvent, result)
  } else if (changedEvent) {
    mainWindow?.webContents.send(`floral:event:${changedEvent}`, null)
  }
  return result
})

ipcMain.handle('floral:emit', (event, name: string, payload: unknown) => {
  assertFloralSender(event)
  if (name !== 'config-changed' && name !== 'notes-changed' && name !== 'open-about-panel') throw new Error('Unsupported Floral event')
  if (name === 'config-changed') {
    broadcastFloralEvent(floralSurfaceWindows.values(), mainWindow, name, payload)
  } else {
    mainWindow?.webContents.send(`floral:event:${name}`, payload)
  }
})

ipcMain.handle('floral:dialog', async (event, kind: string, rawOptions?: any) => {
  assertFloralSender(event)
  const options = rawOptions ?? {}
  if (kind === 'open') {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: [ ...(options.multiple ? ['multiSelections' as const] : []), ...(options.directory ? ['openDirectory' as const] : ['openFile' as const]) ],
      defaultPath: options.defaultPath,
      filters: (options.filters ?? []).map((filter: any) => ({ name: filter.name, extensions: filter.extensions })),
    })
    return result.canceled ? null : options.multiple ? result.filePaths : result.filePaths[0] ?? null
  }
  if (kind === 'save') {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: options.defaultPath,
      filters: (options.filters ?? []).map((filter: any) => ({ name: filter.name, extensions: filter.extensions })),
    })
    return result.canceled ? null : result.filePath ?? null
  }
  if (kind === 'message') {
    await dialog.showMessageBox(mainWindow!, { message: String(options.message ?? ''), title: String(options.title ?? '花笺'), type: options.kind === 'error' ? 'error' : 'info', buttons: ['确定'] })
    return
  }
  throw new Error('Unsupported Floral dialog')
})

ipcMain.handle('floral:clipboard', (event, kind: string, text?: string) => {
  assertFloralSender(event)
  if (kind === 'read') return clipboard.readText()
  if (kind === 'write') { clipboard.writeText(String(text ?? '')); return }
  throw new Error('Unsupported Floral clipboard operation')
})

ipcMain.handle('floral:open-url', async (event, url: string) => {
  assertFloralSender(event)
  const parsed = new URL(url)
  if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) throw new Error('Unsupported URL protocol')
  await shell.openExternal(url)
})

ipcMain.handle('floral:asset-url', (event, filePath: string) => {
  assertFloralSender(event)
  const root = path.resolve(getFloralStore().root)
  const resolved = path.resolve(path.isAbsolute(filePath) ? filePath : path.join(root, filePath))
  if (!resolved.startsWith(root + path.sep)) throw new Error('Invalid Floral asset path')
  return pathToFileURL(resolved).href
})

ipcMain.handle('floral:window', (event, method: string, ...args: any[]) => {
  assertFloralSender(event)
  const targetWindow = BrowserWindow.fromWebContents(event.sender)
  if (!targetWindow || targetWindow.isDestroyed()) return undefined
  const bounds = targetWindow.getBounds()
  switch (method) {
    case 'show': targetWindow.show(); return
    case 'hide': targetWindow.hide(); return
    case 'close': targetWindow.close(); return
    case 'minimize': targetWindow.minimize(); return
    case 'toggleMaximize': targetWindow.isMaximized() ? targetWindow.unmaximize() : targetWindow.maximize(); return
    case 'restoreDefaultSize':
      if (targetWindow !== mainWindow) throw new Error('Only the main window can restore its default size')
      restoreMainWindowDefaultSize(); return
    case 'isMaximized': return targetWindow.isMaximized()
    case 'focus': targetWindow.focus(); return
    case 'setAlwaysOnTop': targetWindow.setAlwaysOnTop(Boolean(args[0])); return
    case 'startDragging': return
    case 'outerPosition': return { x: bounds.x, y: bounds.y }
    case 'innerSize': return { width: bounds.width, height: bounds.height }
    case 'setPosition': targetWindow.setPosition(Number(args[0]?.x), Number(args[0]?.y)); return
    case 'setSize': targetWindow.setSize(Number(args[0]?.width), Number(args[0]?.height)); return
    default: throw new Error('Unsupported Floral window operation')
  }
})

ipcMain.handle('db:get-items', (_event, { limit, offset, search, pinnedOnly }: { limit: number; offset: number; search?: string; pinnedOnly?: boolean }) => {
  if (!db) return []
  const q = (search || '').trim()
  // 列表查询：图片 content 置空（大文件落盘后按需读取，避免全量 base64 过 IPC）
  let sql =
    "SELECT id, type, CASE WHEN type = 'image' THEN '' ELSE content END AS content, preview, char_count, storage_size, created_at, is_pinned, pinned_at, alias, tags, is_sensitive, sort_order, vault_sort_order FROM items"
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
  // 未搜索、非金库时按历史拖拽排序（sort_order 越大越靠前）；未搜索、金库时按金库拖拽排序（vault_sort_order 越大越靠前）；搜索仍按时间倒序
  const sortOrder = !q && !pinnedOnly
  const vaultSortOrder = !q && pinnedOnly
  sql += sortOrder
    ? ' ORDER BY sort_order DESC, created_at DESC, id DESC LIMIT :limit OFFSET :offset'
    : vaultSortOrder
      ? ' ORDER BY vault_sort_order DESC, created_at DESC, id DESC LIMIT :limit OFFSET :offset'
      : ' ORDER BY created_at DESC, id DESC LIMIT :limit OFFSET :offset'
  const stmt = db.prepare(sql)
  stmt.bind(binds)
  const items: StoredItem[] = []
  while (stmt.step()) {
    items.push(stmt.getAsObject() as unknown as StoredItem)
  }
  stmt.free()
  return items
})

ipcMain.handle('ocr:get-config', () => getOcrConfig())

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
  if (content.startsWith('texts/')) {
    // 大文本引用：content 是 texts/xxx.txt 相对路径，读取正文返回
    try {
      const root = getStorageLayoutOrThrow().rootDir
      const abs = path.resolve(path.join(root, content))
      if (abs.startsWith(path.resolve(root) + path.sep) && fs.existsSync(abs)) {
        return fs.readFileSync(abs, 'utf-8')
      }
    } catch {}
    return ''
  }
  return content
})

/** 大文本落盘阈值：超过则存为 texts/ 磁盘文件，库内只存引用（防库膨胀） */
const TEXT_OFFLOAD_BYTES = 64 * 1024

function offloadLargeText(type: string, content: string): string {
  if ((type === 'text' || type === 'html') && Buffer.byteLength(content, 'utf8') > TEXT_OFFLOAD_BYTES) {
    try {
      const dir = getStorageLayoutOrThrow().textsDir
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const name = `txt_${Date.now()}_${Math.floor(Math.random() * 1e6)}.txt`
      fs.writeFileSync(path.join(dir, name), content, 'utf-8')
      return `texts/${name}`
    } catch (err) {
      console.error('[Q-Paste] 大文本落盘失败，改为库内存储:', err)
    }
  }
  return content
}

/** 入库（重试 3 次）；仍失败缓存到待写队列，下次启动自动补录，绝不丢失复制内容 */
function insertItemDbWithRetry(item: { type: string; content: string; preview: string; charCount: number; storageSize: number; createdAt: string; isSensitive?: boolean }): { id: number | null; updated: boolean } | null {
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = insertItemDb(item)
      if (r) return r
      lastErr = new Error('database not ready')
    } catch (err) {
      lastErr = err
    }
  }
  try {
    const qPath = path.join(getStorageLayoutOrThrow().databaseDir, 'pending-inserts.json')
    const arr = fs.existsSync(qPath) ? JSON.parse(fs.readFileSync(qPath, 'utf-8')) : []
    arr.push(item)
    fs.writeFileSync(qPath, JSON.stringify(arr), 'utf-8')
    console.error('[Q-Paste] 入库失败，已加入待写队列:', lastErr)
  } catch (qerr) {
    console.error('[Q-Paste] 待写队列写入失败（内容丢弃风险）:', qerr, lastErr)
  }
  return null
}

/** 下一个置顶 sort_order：取当前最大值 +1（越大越靠前），保证新条目排最前 */
function nextSortOrder(): number {
  if (!db) return legacyMaxSortOrder + 1
  const stmt = db.prepare('SELECT MAX(sort_order) AS mx FROM items')
  let mx: number = legacyMaxSortOrder
  if (stmt.step()) {
    const v = Number(stmt.getAsObject().mx)
    if (Number.isFinite(v)) mx = v
  }
  stmt.free()
  return mx + 1
}

/** 下一个置顶 vault_sort_order：取当前金库最大值 +1（越大越靠前），新收藏排最前 */
function nextVaultSortOrder(): number {
  if (!db) return legacyMaxVaultSortOrder + 1
  const stmt = db.prepare('SELECT MAX(vault_sort_order) AS mx FROM items WHERE is_pinned = 1')
  let mx: number = legacyMaxVaultSortOrder
  if (stmt.step()) {
    const v = Number(stmt.getAsObject().mx)
    if (Number.isFinite(v)) mx = v
  }
  stmt.free()
  return mx + 1
}

/** 入库一条记录（去重置顶 + 裁剪），db:insert-item 与手机推送共用；失败重试请用 insertItemDbWithRetry */
function insertItemDb(item: { type: string; content: string; preview: string; charCount: number; storageSize: number; createdAt: string; isSensitive?: boolean }): { id: number | null; updated: boolean } | null {
  if (!db) return null

  // 大文本落盘：库内只存引用（引用串彼此不同，超大同内容不去重，可接受）
  const storedContent = offloadLargeText(item.type, item.content)

  // 富文本归一：一次复制常被系统先后写入「纯文本」与「HTML」两种格式，
  // 若已存在同内容的纯文本记录，则原地升级为富文本，避免 text+html 两条重复
  if (item.type === 'html' && item.content && !item.isSensitive) {
    const plain = htmlToText(item.content).replace(/\s+/g, ' ').trim()
    if (plain.length > 0) {
      const cand = db.prepare("SELECT id, content FROM items WHERE type = 'text' AND is_pinned = 0 ORDER BY id DESC LIMIT 30")
      let upgradeId: number | null = null
      while (cand.step()) {
        const o = cand.getAsObject()
        const c = String(o.content ?? '')
        if (c.startsWith('texts/')) continue
        if (c.replace(/\s+/g, ' ').trim() === plain) {
          upgradeId = Number(o.id)
          break
        }
      }
      cand.free()
      if (upgradeId !== null) {
        db.run(
          `UPDATE items SET type = 'html', content = :content, preview = :preview,
           char_count = :charCount, storage_size = :storageSize, created_at = :createdAt,
           sort_order = :sortOrder
           WHERE id = :id`,
          {
            ':content': item.content,
            ':preview': item.preview,
            ':charCount': item.charCount,
            ':storageSize': item.storageSize,
            ':createdAt': item.createdAt,
            ':sortOrder': nextSortOrder(),
            ':id': upgradeId,
          }
        )
        return { id: upgradeId, updated: true }
      }
    }
  }

  // 内容去重置顶（可配置）：文本/URL 存在相同内容的未收藏记录时，复用该记录并更新到最新（避免重复堆积）
  if (config.dedupeOnCapture !== false && item.type !== 'image' && item.content) {
    const dup = db.prepare('SELECT id FROM items WHERE type = :type AND content = :content AND is_pinned = 0 LIMIT 1')
    dup.bind({ ':type': item.type, ':content': item.content })
    let dupId: number | null = null
    if (dup.step()) dupId = (dup.getAsObject().id as number) ?? null
    dup.free()

    if (dupId !== null) {
      db.run(
        `UPDATE items SET preview = :preview, char_count = :charCount, storage_size = :storageSize, created_at = :createdAt, sort_order = :sortOrder WHERE id = :id`,
        {
          ':id': dupId,
          ':preview': item.preview,
          ':charCount': item.charCount,
          ':storageSize': item.storageSize,
          ':createdAt': item.createdAt,
          ':sortOrder': nextSortOrder(),
        }
      )
      saveDb()
      return { id: dupId, updated: true }
    }
  }

  db.run(
    `INSERT INTO items (type, content, preview, char_count, storage_size, created_at, is_sensitive, sort_order)
     VALUES (:type, :content, :preview, :charCount, :storageSize, :createdAt, :isSensitive, :sortOrder)`,
    {
      ':type': item.type,
      ':content': storedContent,
      ':preview': item.preview,
      ':charCount': item.charCount,
      ':storageSize': item.storageSize,
      ':createdAt': item.createdAt,
      ':isSensitive': item.isSensitive ? 1 : 0,
      ':sortOrder': nextSortOrder(),
    }
  )
  const res = db.exec('SELECT last_insert_rowid()')
  const id = res[0]?.values[0]?.[0] ?? null
  saveDb()
  enforceMaxRecords()
  return { id, updated: false }
}

ipcMain.handle('db:insert-item', (_event, item: { type: string; content: string; preview: string; charCount: number; storageSize: number; createdAt: string; isSensitive?: boolean; source?: 'capture' | 'sync' }) => {
  const inserted = insertItemDbWithRetry(item)
  // 本地捕获推送到云端；云端拉取的记录（source='sync'）不回推，避免设备间回声
  if (inserted && item.source !== 'sync') {
    void pushCaptureToCloud(item)
  }
  return inserted
})

ipcMain.handle('db:delete-item', (_event, id: number) => {
  if (!db) return false
  db.run('DELETE FROM items WHERE id = :id', { ':id': id })
  saveDb()
  cleanupOrphanImages()
  return true
})

ipcMain.handle('db:delete-items', (_event, ids: number[]) => {
  if (!db || !Array.isArray(ids) || ids.length === 0) return false
  const clean = ids.map((n) => Number(n)).filter((n) => Number.isFinite(n))
  if (!clean.length) return false
  db.run('BEGIN')
  try {
    for (const id of clean) {
      db.run('DELETE FROM items WHERE id = :id', { ':id': id })
    }
    db.run('COMMIT')
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
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
    // 收藏时记录收藏时间（金库按此排序）；取消收藏清空
    sets.push('pinned_at = :pinnedAt')
    binds[':pinnedAt'] = params.isPinned ? nowLocal() : null
    // 收藏时置顶金库排序（vault_sort_order 取当前最大值+1）；取消收藏清空
    sets.push('vault_sort_order = :vaultSortOrder')
    binds[':vaultSortOrder'] = params.isPinned ? nextVaultSortOrder() : null
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

/**
 * 拖拽重排：把当前视图内条目的顺序持久化。
 * order 为从顶部到底部的 id 数组（视图内完整顺序），
 * 为该列表中的每条记录重赋 sort_order（值越大越靠前），其余未出现记录保持不变。
 */
ipcMain.handle('db:reorder-items', (_event, order: number[]) => {
  if (!db || !Array.isArray(order) || order.length === 0) return false
  const ids = order.map((id) => Number(id)).filter((id) => Number.isFinite(id))
  if (ids.length === 0) return false
  const n = ids.length
  db.run('BEGIN')
  try {
    // 数组顺序即顶部→底部，index=0 最大（最靠前），其余按 n - index 递减
    for (let i = 0; i < ids.length; i++) {
      db.run('UPDATE items SET sort_order = :so WHERE id = :id', { ':so': n - i, ':id': ids[i] })
    }
    db.run('COMMIT')
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
  saveDb()
  return true
})

/**
 * 金库拖拽重排：把金库（收藏）内条目的顺序持久化。
 * order 为从顶部到底部的收藏 id 数组，为其重赋 vault_sort_order（值越大越靠前），
 * 与历史列表的 sort_order 相互独立、互不干扰。
 */
ipcMain.handle('db:vault-reorder-items', (_event, order: number[]) => {
  if (!db || !Array.isArray(order) || order.length === 0) return false
  const ids = order.map((id) => Number(id)).filter((id) => Number.isFinite(id))
  if (ids.length === 0) return false
  const n = ids.length
  db.run('BEGIN')
  try {
    // 数组顺序即顶部→底部，index=0 最大（最靠前），其余按 n - index 递减
    for (let i = 0; i < ids.length; i++) {
      db.run('UPDATE items SET vault_sort_order = :so WHERE id = :id', { ':so': n - i, ':id': ids[i] })
    }
    db.run('COMMIT')
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
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
    maxCaptureKb: config.maxCaptureKb ?? 1024,
  }
})

ipcMain.handle('settings:set-capture-rules', (_event, settings: { ignorePatterns?: string[]; dedupeOnCapture?: boolean; maxCaptureKb?: number }) => {
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
  if (typeof settings.maxCaptureKb === 'number' && settings.maxCaptureKb >= 0) {
    config.maxCaptureKb = Math.round(settings.maxCaptureKb)
  }
  saveConfig()
  return { success: true }
})

// ── 版本号（与 package.json 保持一致）──
ipcMain.handle('app:get-version', () => app.getVersion())

// ── 自动更新（electron-updater）──

/** 推送更新状态给渲染层 */
let currentUpdateStatus: HostUpdateStatus = { status: 'idle' }
function sendUpdateStatus(status: string, payload?: any): void {
  currentUpdateStatus = { status, ...payload }
  mainWindow?.webContents.send('update-status', currentUpdateStatus)
  const eventName = status === 'checking' ? 'checking'
    : status === 'downloaded' ? 'download-finished'
    : status === 'error' ? 'error'
    : status === 'available' || status === 'not-available' ? 'checked' : null
  if (eventName) mainWindow?.webContents.send(`floral:event:update://${eventName}`, toFloralUpdateState(currentUpdateStatus, app.getVersion()))
}

ipcMain.handle('update:get-status', () => currentUpdateStatus)

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

async function prepareFloralInstall(): Promise<boolean> {
  const windows = [mainWindow, ...[...floralSurfaceWindows.entries()]
    .filter(([key, window]) => key.startsWith('notepad:') && !window.isDestroyed())
    .map(([, window]) => window)].filter((window): window is BrowserWindow => Boolean(window && !window.isDestroyed()))
  if (windows.length === 0) return false
  const requestId = randomUUID()
  const reports = new Map<number, (ready: boolean) => void>()
  const responses = windows.map((window) => new Promise<boolean>((resolve) => reports.set(window.webContents.id, resolve)))
  pendingInstallReports.set(requestId, reports)
  let timer: NodeJS.Timeout | undefined
  try {
    const timeout = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 15000) })
    for (const window of windows) window.webContents.send('floral:event:update://prepare-install', { requestId })
    return await Promise.race([Promise.all(responses).then((values) => values.every(Boolean)), timeout])
  } finally {
    if (timer) clearTimeout(timer)
    pendingInstallReports.delete(requestId)
  }
}

ipcMain.handle('update:install', async () => {
  if (!autoUpdater) return { success: false, error: '自动更新不可用' }
  try {
    if (resolveAppMode(config.activeMode) === 'floral' && !(await prepareFloralInstall())) {
      return { success: false, error: '花笺笔记未能全部保存，安装已取消' }
    }
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
      defaultPath: path.join(getStorageLayoutOrThrow().exportsDir, `q-paste-backup-${new Date().toISOString().slice(0, 10)}.db`),
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

/** 构建与「导出 JSON 备份」完全同格式的载荷（图片转 dataURL 自包含） */
function buildBackupPayload(): Record<string, any> {
  const rows: Record<string, any>[] = []
  const stmt = db!.prepare(
    'SELECT id, type, content, preview, char_count, storage_size, created_at, is_pinned, pinned_at, alias, tags, is_sensitive FROM items ORDER BY id'
  )
  while (stmt.step()) {
    const row = stmt.getAsObject()
    if (row.type === 'image' && typeof row.content === 'string' && row.content && !row.content.startsWith('data:')) {
      row.content = readImageAsDataUrl(row.content) || ''
    }
    rows.push(row)
  }
  stmt.free()
  return {
    app: 'Q-Paste',
    version: app.getVersion(),
    exportedAt: new Date().toISOString(),
    count: rows.length,
    items: rows,
  }
}

ipcMain.handle('data:export-json', async () => {
  try {
    if (!db) throw new Error('数据库未就绪')
    if (!mainWindow) throw new Error('窗口未就绪')
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出 JSON 备份',
      defaultPath: path.join(getStorageLayoutOrThrow().exportsDir, `q-paste-backup-${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }

    const rows: Record<string, any>[] = []
    const stmt = db.prepare(
      'SELECT id, type, content, preview, char_count, storage_size, created_at, is_pinned, pinned_at, alias, tags, is_sensitive FROM items ORDER BY id'
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
    if (rows.length === 0) return { success: true, count: 0, duplicates: 0 }

    let imported = 0
    let duplicates = 0
    db.run('BEGIN TRANSACTION')
    try {
      for (const row of rows) {
        if (!row || typeof row.content !== 'string') continue
        // 防护：大文本引用（texts/）指向源机本地文件，跨机导入无法还原；空内容同样跳过
        if (row.content === '' || row.content.startsWith('texts/')) continue
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
        if (exists) {
          duplicates++
          continue
        }

        const tags = Array.isArray(row.tags) ? row.tags : []
        const createdAt = typeof row.created_at === 'string' ? row.created_at : nowLocal()
        // 收藏时间缺失时按复制时间兜底，保证导入后金库排序稳定
        const pinnedAt = row.is_pinned
          ? (typeof row.pinned_at === 'string' && row.pinned_at ? row.pinned_at : createdAt)
          : null
        db.run(
          `INSERT INTO items (type, content, preview, char_count, storage_size, created_at, is_pinned, pinned_at, alias, tags, is_sensitive, sort_order)
           VALUES (:type, :content, :preview, :charCount, :storageSize, :createdAt, :isPinned, :pinnedAt, :alias, :tags, :isSensitive, :sortOrder)`,
          {
            ':type': type,
            ':content': content,
            ':preview': typeof row.preview === 'string' ? row.preview : content.slice(0, 100),
            ':charCount': Number(row.char_count) || 0,
            ':storageSize': Number(row.storage_size) || Buffer.byteLength(content, 'utf8'),
            ':createdAt': createdAt,
            ':isPinned': row.is_pinned ? 1 : 0,
            ':pinnedAt': pinnedAt,
            ':alias': typeof row.alias === 'string' ? row.alias : '',
            ':tags': JSON.stringify(tags),
            ':isSensitive': row.is_sensitive ? 1 : 0,
            ':sortOrder': typeof row.sort_order === 'number' ? row.sort_order : localDateToMs(createdAt),
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
    return { success: true, count: imported, duplicates }
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

ipcMain.handle('clipboard:read-text', () => clipboard.readText())

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

// ── 云端同步（WebDAV，多设备）：引擎在 src/main/sync，这里负责桥接本地存储 ──

const syncEngine = new SyncEngine()

function cloudSyncConfigFromLocal() {
  return {
    enabled: config.cloudSyncEnabled ?? false,
    webdavUrl: config.cloudSyncUrl ?? '',
    username: config.cloudSyncUsername ?? '',
    password: getStoredWebDavPassword(),
    basePath: config.cloudSyncBasePath || 'qpaste-sync',
    deviceId: config.cloudSyncDeviceId || '',
    intervalSecs: config.cloudSyncIntervalSecs ?? 120,
  }
}

/** epoch ms → 本地 'YYYY-MM-DD HH:mm:ss'（与 nowLocal 同格式） */
function epochToLocal(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function localDateToMs(local: string): number {
  const ms = new Date(local.replace(' ', 'T')).getTime()
  return Number.isFinite(ms) ? ms : Date.now()
}

function dbTypeOfSyncType(t: ClipboardSyncType): string {
  if (t === 'link') return 'url'
  if (t === 'rich_text') return 'html'
  return t
}

function syncTypeOfDbType(t: string): ClipboardSyncType {
  if (t === 'url') return 'link'
  if (t === 'html') return 'rich_text'
  return t as ClipboardSyncType
}

/** WebDAV 密码经 safeStorage（Windows DPAPI）加密落盘；兼容历史明文并自动升级为密文 */
function setStoredWebDavPassword(pw: string): void {
  try {
    config.cloudSyncPassword = pw && safeStorage.isEncryptionAvailable()
      ? 'enc:' + safeStorage.encryptString(pw).toString('base64')
      : pw
  } catch {
    config.cloudSyncPassword = pw
  }
}

function getStoredWebDavPassword(): string {
  const raw = config.cloudSyncPassword ?? ''
  if (!raw.startsWith('enc:')) return raw
  try {
    return safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64'))
  } catch {
    return ''
  }
}

/** 收集本地全部历史为云同步条目（图片转 dataURL；富文本拆 纯文本+HTML；文件类型跳过） */
function collectLocalForSync(): ClipboardSyncItem[] {
  if (!db) return []
  const out: ClipboardSyncItem[] = []
  try {
    const res = db.exec("SELECT type, content, preview, created_at FROM items ORDER BY created_at ASC, id ASC")
    for (const row of res[0]?.values ?? []) {
      const dbType = String(row[0] ?? '')
      let content = String(row[1] ?? '')
      const preview = String(row[2] ?? '')
      const createdAt = localDateToMs(String(row[3] ?? ''))
      if (dbType === 'files') continue
      const st = syncTypeOfDbType(dbType)
      if (st === 'image') {
        content = content.startsWith('data:') ? content : readImageAsDataUrl(content) ?? ''
        if (!content) continue
      }
      if (!content.trim()) continue
      const hash = createHash('sha256').update(st === 'rich_text' ? htmlToText(content) : content, 'utf8').digest('hex')
      out.push({
        id: `${st}:${hash}`,
        type: st,
        content: st === 'rich_text' ? htmlToText(content) : content,
        html: st === 'rich_text' ? content : null,
        hash,
        preview: preview || [...content].slice(0, 100).join(''),
        createdAt,
        updatedAt: createdAt,
        deviceId: config.cloudSyncDeviceId ?? '',
        deletedAt: 0,
      })
    }
  } catch (err) {
    console.error('[Q-Paste] 收集本地历史失败:', err)
  }
  return out
}

/** 云同步一轮：首次运行先拉远端全量、再推本地全量（存量历史上云）；此后仅增量拉取 */
/** 云端快照：与本地「导出 JSON 备份」同格式；数据无变化时自动跳过上传 */
async function uploadCloudSnapshot(): Promise<void> {
  if (!syncEngine.isEnabled()) return
  const payload = JSON.stringify(buildBackupPayload(), null, 2)
  const hash = createHash('sha256').update(payload).digest('hex')
  if (hash === config.cloudSnapshotHash) {
    console.log('[Q-Paste] 云端快照无变化，跳过上传')
    return
  }
  await syncEngine.uploadFile('backup/qpaste-backup.json', Buffer.from(payload, 'utf-8'))
  config.cloudSnapshotHash = hash
  saveConfig()
  console.log('[Q-Paste] 云端快照已更新: backup/qpaste-backup.json')
}

async function runCloudSyncCycle(): Promise<CloudSyncStatus> {
  if (!syncEngine.isEnabled()) throw new Error('cloud sync not enabled')
  if (config.cloudSyncFullPushDone !== true) {
    await syncEngine.pullChanges(0) // 先吸收远端已有数据（按内容去重合并）
    const items = collectLocalForSync()
    const pushed = await syncEngine.pushAll(items)
    config.cloudSyncFullPushDone = true
    saveConfig()
    console.log(`[Q-Paste] 云同步初始全量上传完成: ${pushed} 条`)
  }
  await uploadCloudSnapshot()
  return syncEngine.status
}

/** 应用配置 → 引擎（首次自动生成并持久化 deviceId） */
async function applyCloudSyncConfig(): Promise<CloudSyncStatus> {
  const cfg = cloudSyncConfigFromLocal()
  if (!cfg.deviceId) {
    cfg.deviceId = `qpaste-${randomUUID().replace(/-/g, '').slice(0, 12)}`
    config.cloudSyncDeviceId = cfg.deviceId
    saveConfig()
  }
  const statePath = getStorageLayoutOrThrow().syncStatePath
  await syncEngine.init(cfg, statePath)
  return syncEngine.status
}

/** 本地捕获 → 推送到云端（图片读盘转 dataURL；富文本拆成 纯文本 + HTML） */
async function pushCaptureToCloud(item: { type: string; content: string; preview: string; createdAt: string }): Promise<void> {
  if (!syncEngine.isEnabled()) return
  try {
    const type = syncTypeOfDbType(item.type)
    let content = item.content
    let html: string | null = null
    if (type === 'rich_text') {
      html = item.content
      content = htmlToText(item.content)
    } else if (type === 'image') {
      content = readImageAsDataUrl(item.content) ?? ''
    }
    if (!content) return

    const entry: ClipboardSyncItem = {
      id: '',
      type,
      content,
      html,
      hash: '',
      preview: item.preview || [...content].slice(0, 200).join(''),
      createdAt: localDateToMs(item.createdAt),
      updatedAt: Date.now(),
      deviceId: '',
      deletedAt: 0,
    }
    await syncEngine.pushItem(entry)
  } catch (err) {
    // 推送失败不阻断本地功能；引擎 status.lastError 已记录，供设置页展示
    console.error('[Q-Paste] 云同步推送失败:', err)
  }
}

/** 云端拉取 → 入库并经 cloud-sync:pulled 事件通知渲染层 */
syncEngine.onPulled = (items) => {
  const payload: Array<{ id: number; type: string; content: string; preview: string; charCount: number; storageSize: number; createdAt: string }> = []
  for (const it of items) {
    // 删除墓碑：按内容指纹删除本地行，并通知渲染层移除对应条目
    // 删除墓碑：云同步删除闭环随 content_hash 回滚一并移除
    if (it.deletedAt > 0) continue
    let dbType = dbTypeOfSyncType(it.type)
    let content = it.type === 'rich_text' ? (it.html ?? it.content) : it.content
    let preview = it.preview
    if (it.type === 'image' && content.startsWith('data:')) {
      const rel = saveImageToDisk(content, it.hash)
      if (rel) content = rel // 与本地捕获一致：图片存相对路径，落盘失败保留 dataURL
      preview = preview || '图片'
    }
    if (!content) continue
    if (!preview) preview = content.length > 100 ? content.slice(0, 100) + '...' : content
    const charCount = it.type === 'image' ? 0 : it.type === 'rich_text' ? htmlToText(content).length : content.length
    const inserted = insertItemDb({
      type: dbType,
      content,
      preview,
      charCount,
      storageSize: Buffer.byteLength(content, 'utf8'),
      createdAt: epochToLocal(it.createdAt > 0 ? it.createdAt : it.updatedAt),
    })
    if (!inserted?.id) continue
    payload.push({ id: inserted.id, type: dbType, content, preview, charCount, storageSize: Buffer.byteLength(content, 'utf8'), createdAt: epochToLocal(it.createdAt > 0 ? it.createdAt : it.updatedAt) })
  }
  if (payload.length > 0) mainWindow?.webContents.send('cloud-sync:pulled', payload)
}

ipcMain.handle('cloud-sync:get-config', () => cloudSyncConfigFromLocal())
ipcMain.handle('cloud-sync:get-status', (): CloudSyncStatus => syncEngine.status)

/** 开关唯一入口：开启 = 先 verify 再持久化并启动定时同步；关闭 = 停定时器并持久化 */
const webdavService = new WebDavService(syncEngine)
ipcMain.handle('webdav:toggle', async (_event, cfg: { webdavUrl?: string; username?: string; password?: string; basePath?: string; intervalSecs?: number }, state: boolean): Promise<WebDavToggleResult> => {
  if (!state) {
    config.cloudSyncEnabled = false
    saveConfig()
    await applyCloudSyncConfig().catch(() => {}) // 引擎以 enabled=false 重建，停掉定时拉取
    return { ok: true }
  }

  const candidate = {
    webdavUrl: (cfg.webdavUrl ?? config.cloudSyncUrl ?? '').trim(),
    username: cfg.username ?? config.cloudSyncUsername ?? '',
    password: cfg.password ?? config.cloudSyncPassword ?? '',
    basePath: cfg.basePath || config.cloudSyncBasePath || 'qpaste-sync',
    intervalSecs: cfg.intervalSecs ?? config.cloudSyncIntervalSecs ?? 120,
  }

  // 鉴权失败 / 网络断开 / 服务器异常：不落盘、不启动，把归因交还 UI
  const verdict = await verifyWebDav(candidate)
  if (!verdict.ok) {
    return { ok: false, reason: verdict.reason, message: verdict.message }
  }

  config.cloudSyncEnabled = true
  config.cloudSyncUrl = candidate.webdavUrl
  config.cloudSyncUsername = candidate.username
  setStoredWebDavPassword(candidate.password)
  config.cloudSyncBasePath = candidate.basePath
  config.cloudSyncIntervalSecs = candidate.intervalSecs
  saveConfig()
  try {
    const status = await applyCloudSyncConfig()
    // 首次启用：后台执行「拉远端全量 + 本地存量全量上传」，不阻塞开关反馈
    if (config.cloudSyncFullPushDone !== true) {
      void runCloudSyncCycle()
        .then(() => uploadCloudSnapshot())
        .catch((err: any) => console.error('[Q-Paste] 初始全量同步失败:', err))
    }
    return { ok: true, status }
  } catch (err: any) {
    config.cloudSyncEnabled = false
    saveConfig()
    const message = err?.message ?? String(err)
    return { ok: false, reason: /网络|ENOTFOUND|ECONN|timeout/i.test(message) ? 'network' : 'server', message }
  }
})

ipcMain.handle('cloud-sync:sync-now', async (): Promise<{ ok: boolean; error?: string; status: CloudSyncStatus }> => {
  if (!syncEngine.isEnabled()) {
    return { ok: false, error: 'cloud sync not enabled', status: syncEngine.status }
  }
  try {
    // 未完成存量全量上传时，「立即同步」先补全量再增量拉取
    if (config.cloudSyncFullPushDone !== true) {
      await syncEngine.pullChanges(0)
      const pushed = await syncEngine.pushAll(collectLocalForSync())
      config.cloudSyncFullPushDone = true
      saveConfig()
      console.log(`[Q-Paste] 云同步初始全量上传完成: ${pushed} 条`)
    }
    const status = await webdavService.sync()
    await uploadCloudSnapshot().catch((err) => console.error('[Q-Paste] 快照上传失败:', err))
    return { ok: true, status }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err), status: syncEngine.status }
  }
})

// ── 局域网文件传输（手机 ↔ PC，1:1 移植自 Tiez file_transfer）──

function ftSaveDir(): string {
  return getStorageLayoutOrThrow().transfersDir
}

function ftLogoBase64(): string {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath ?? '', 'icon.png')]
    : [path.join(__dirname, '../build/icon.png'), path.join(__dirname, '../../build/icon.png')]
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`
    } catch {}
  }
  return ''
}

/** 收到的图片复制进应用 images 目录（与本地捕获同构，渲染层才能预览/写回） */
function copyIntoImagesDir(src: string): string | null {
  try {
    const dir = getImagesDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const name = `ft_${Date.now()}_${Math.floor(Math.random() * 1e9)}${path.extname(src).toLowerCase() || '.png'}`
    fs.copyFileSync(src, path.join(dir, name))
    return `images/${name}`
  } catch (err) {
    console.error('[Q-Paste][FT] 图片入库失败:', err)
    return null
  }
}

function notifyRendererItem(type: string, content: string, preview: string, id: number | null, source: 'ft' | 'oversize' = 'ft'): void {
  if (id === null) return
  mainWindow?.webContents.send('clipboard-changed', {
    type,
    content,
    preview,
    charCount: type === 'image' ? 0 : content.length,
    storageSize: Buffer.byteLength(content, 'utf8'),
    createdAt: nowLocal(),
    id,
    fromFt: source === 'ft',
    fromOversize: source === 'oversize',
  })
}

let batchOpenDir = ''
let batchOpenAt = 0
let batchCopyFiles: string[] = []
let batchCopyTimer: ReturnType<typeof setTimeout> | null = null

/** 批量接收聚合：400ms 窗口内收到的文件合并为一次多文件剪贴板写入 */
function queueBatchFileCopy(p: string): void {
  batchCopyFiles.push(p)
  if (batchCopyTimer) clearTimeout(batchCopyTimer)
  batchCopyTimer = setTimeout(() => {
    const list = [...batchCopyFiles]
    batchCopyFiles = []
    batchCopyTimer = null
    if (list.length === 0) return
    try {
      const raw = list.join('\0') + '\0'
      clipboard.writeBuffer('FileNameW', Buffer.from(raw, 'utf16le'))
      lastFileHash = ''
      lastTextContent = clipboard.readText().trim() || ''
      selfWriteUntil = Date.now() + 1000
    } catch (err) {
      console.error('[Q-Paste][FT] 批量复制失败:', err)
    }
  }, 400)
}

const ftServer = new FileTransferServer({
  getTransfersDir: ftSaveDir,
  getTempDir: () => getStorageLayoutOrThrow().tempDir,
  getClipboardText: () => clipboard.readText(),
  getColorMode: () => 'system',
  getLogoBase64: ftLogoBase64,
  onReceiveText: (content) => {
    const autoCopy = config.fileTransferAutoCopy !== false
    const preview = [...content].slice(0, 100).join('') + ([...content].length > 100 ? '...' : '')
    // 开关关闭：仅保存到本地历史，不写系统剪贴板
    const inserted = insertItemDbWithRetry({
      type: 'text', content, preview,
      charCount: content.length,
      storageSize: Buffer.byteLength(content, 'utf8'),
      createdAt: nowLocal(),
    })
    if (inserted) notifyRendererItem('text', content, preview, inserted.id)
    if (!autoCopy) return
    // 开关开启：同步写入系统剪贴板（基线+保护窗口防止自我捕获）
    try {
      clipboard.writeText(content)
      lastTextContent = content
      lastImageHash = ''
      selfWriteUntil = Date.now() + 1000
    } catch (err) {
      console.error('[Q-Paste][FT] 文本自动复制失败:', err)
    }
  },
  onFileReceived: (finalPath, fileName, _contentType, _senderId, _senderName, msgType) => {
    const autoCopy = config.fileTransferAutoCopy !== false
    // 自动打开文件夹：批量接收去重（1.5s 窗口内同目录只开一次），失败落日志
    if (config.fileTransferAutoOpen) {
      const dir = path.dirname(finalPath)
      const now = Date.now()
      if (!(dir === batchOpenDir && now - batchOpenAt < 1500)) {
        batchOpenDir = dir
        batchOpenAt = now
        shell.openPath(dir).then((msg) => {
          if (msg) console.error('[Q-Paste][FT] 自动打开文件夹失败:', msg)
        }).catch((err) => console.error('[Q-Paste][FT] 自动打开文件夹异常:', err))
      }
    }
    let dbType = 'files'
    let dbContent = JSON.stringify([finalPath])
    let preview = `[File] ${fileName}`
    if (msgType === 'image') {
      const rel = copyIntoImagesDir(finalPath)
      if (rel) {
        dbType = 'image'
        dbContent = rel
        preview = '[Image]'
      }
    } else if (msgType === 'video') {
      preview = `[Video] ${fileName}`
    }
    const inserted = insertItemDb({
      type: dbType, content: dbContent, preview,
      charCount: 0,
      storageSize: Buffer.byteLength(dbContent, 'utf8'),
      createdAt: nowLocal(),
    })
    if (inserted) notifyRendererItem(dbType, dbContent, preview, inserted.id)
    // 开关开启才复制；批量接收 400ms 聚合为一次多文件写入（无遗漏、无互相覆盖）
    if (autoCopy) queueBatchFileCopy(finalPath)
  },
  onStatusChange: (status) => mainWindow?.webContents.send('ft:status-changed', status),
  onDevicesChange: (devices) => mainWindow?.webContents.send('ft:devices-updated', devices),
  onMessage: () => mainWindow?.webContents.send('ft:new-message'),
})

ipcMain.handle('ft:toggle', async (_event, enabled: boolean, port?: number): Promise<{ success: boolean; port: number; error?: string }> => {
  if (enabled) {
    try {
      const actualPort = await ftServer.start(port && port > 0 ? port : config.fileTransferPort ?? FILE_TRANSFER_DEFAULT_PORT, config.fileTransferAutoClose ?? false, { host: config.fileTransferBindIp ?? '' })
      config.fileTransferEnabled = true
      config.fileTransferPort = actualPort
      saveConfig()
      return { success: true, port: actualPort }
    } catch (err: any) {
      config.fileTransferEnabled = false
      saveConfig()
      return { success: false, port: 0, error: err?.message ?? String(err) }
    }
  }
  ftServer.stop()
  config.fileTransferEnabled = false
  saveConfig()
  return { success: true, port: 0 }
})

ipcMain.handle('ft:status', (): FtStatus => ftServer.status)
ipcMain.handle('ft:get-available-ips', () => getAvailableIps())
ipcMain.handle('ft:set-display-ip', (_event, ip: string) => ftServer.setDisplayIp(ip))
ipcMain.handle('ft:get-chat-history', () => ftServer.getChatHistory())
ipcMain.handle('ft:get-online-devices', () => ftServer.getOnlineDevices())
ipcMain.handle('ft:send-chat-text', (_event, content: string) => {
  ftServer.sendChatText(content)
  return true
})
ipcMain.handle('ft:send-file', (_event, filePath: string): { success: boolean; error?: string } => {
  if (!filePath || !fs.existsSync(filePath)) return { success: false, error: 'file not found' }
  const msg = ftServer.sendFileToClient(filePath)
  return msg ? { success: true } : { success: false, error: 'server not running or IP not detected' }
})
ipcMain.handle('ft:get-active-path', () => ftSaveDir())
ipcMain.handle('ft:choose-save-path', async () => {
  return { canceled: false, path: ftSaveDir() }
})
ipcMain.handle('ft:set-setting', (_event, key: 'fileTransferAutoOpen' | 'fileTransferAutoClose' | 'fileTransferAutoCopy' | 'fileTransferBindIp', value: boolean | string) => {
  if (key === 'fileTransferBindIp') {
    config.fileTransferBindIp = String(value)
    saveConfig()
    // 换绑网卡：运行中则重启到新接口
    if (config.fileTransferEnabled) {
      ftServer.stop()
      void ftServer.start(config.fileTransferPort ?? FILE_TRANSFER_DEFAULT_PORT, config.fileTransferAutoClose ?? false, { host: config.fileTransferBindIp ?? '' })
    }
    return true
  }
  config[key] = !!value
  saveConfig()
  if (key === 'fileTransferAutoClose') ftServer.setAutoClose(!!value)
  return true
})
ipcMain.handle('ft:get-settings', () => ({
  enabled: config.fileTransferEnabled ?? false,
  port: config.fileTransferPort ?? FILE_TRANSFER_DEFAULT_PORT,
  path: ftSaveDir(),
  autoOpen: config.fileTransferAutoOpen ?? false,
  autoClose: config.fileTransferAutoClose ?? false,
  autoCopy: config.fileTransferAutoCopy ?? true,
  bindIp: config.fileTransferBindIp ?? '',
}))
ipcMain.handle('ft:save-temp-image', (_event, base64Data: string): string => {
  const b64 = base64Data.includes(',') ? base64Data.slice(base64Data.indexOf(',') + 1) : base64Data
  const dir = ftSaveDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `paste_${Date.now()}.png`)
  fs.writeFileSync(file, Buffer.from(b64, 'base64'))
  return file
})
ipcMain.handle('ft:get-app-logo', () => ftLogoBase64())

// 超大文本用户确认后的入库入口（完整保留 / 截断保留）
ipcMain.handle('clipboard:get-pending-oversize', () => pendingOversizeCaptures[0] ?? null)

ipcMain.handle('clipboard:insert-oversize', (_event, { content, truncate }: { content: string; truncate: boolean }) => {
  const maxBytes = (config.maxCaptureKb ?? 1024) * 1024
  let text = content
  if (truncate && maxBytes > 0) {
    text = Buffer.from(content, 'utf8').subarray(0, maxBytes).toString('utf8').replace(/\uFFFD+$/, '')
  }
  const preview = [...text].slice(0, 100).join('') + ([...text].length > 100 ? '...' : '')
  const inserted = insertItemDbWithRetry({
    type: 'text', content: text, preview,
    charCount: text.length,
    storageSize: Buffer.byteLength(text, 'utf8'),
    createdAt: nowLocal(),
  })
  if (inserted && pendingOversizeCaptures[0]?.content === content) pendingOversizeCaptures.shift()
  if (inserted?.id) notifyRendererItem('text', text, preview, inserted.id, 'oversize')
  return inserted
})

// 文本/链接转存为 .txt 文件并写入剪贴板（资源管理器/聊天窗可直接粘贴文件）
ipcMain.handle('clipboard:write-text-as-file', (_event, { text, name }: { text: string; name?: string }) => {
  try {
    const dir = ftSaveDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const safe = ((name || 'snippet').replace(/[\\/:*?"<>|]/g, '_').trim() || 'snippet').slice(0, 60)
    const file = path.join(dir, `Q-Paste_${Date.now()}_${safe}.txt`)
    fs.writeFileSync(file, text, 'utf-8')
    clipboard.writeBuffer('FileNameW', Buffer.from(`${file}\0`, 'utf16le'))
    lastFileHash = ''
    lastTextContent = clipboard.readText().trim() || ''
    selfWriteUntil = Date.now() + 1000
    return { success: true, path: file }
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) }
  }
})
ipcMain.handle('ft:read-file-data-url', (_event, filePath: string): string => {
  try {
    if (!filePath || filePath.startsWith('data:') || filePath.startsWith('/download/')) return ''
    return `data:${guessMime(filePath)};base64,${fs.readFileSync(filePath).toString('base64')}`
  } catch {
    return ''
  }
})
ipcMain.handle('ft:open-path', async (_event, target: string) => {
  if (!target) return false
  const result = await shell.openPath(target)
  return result === ''
})
ipcMain.handle('ft:save-file-copy', (_event, sourcePath: string, targetPath: string): boolean => {
  try {
    fs.copyFileSync(sourcePath, targetPath)
    return true
  } catch {
    return false
  }
})
ipcMain.handle('ft:save-file-as', async (_event, sourcePath: string, defaultName: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: defaultName })
  if (result.canceled || !result.filePath) return { canceled: true }
  try {
    fs.copyFileSync(sourcePath, result.filePath)
    return { canceled: false, path: result.filePath }
  } catch {
    return { canceled: true }
  }
})
ipcMain.handle('ft:pick-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile', 'multiSelections'] })
  return result.canceled ? [] : result.filePaths
})

ipcMain.handle('shell:open-url', (_event, url: string) => {  try {
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
  return mainWindow?.isMaximized() ?? false
})

ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)

ipcMain.on('window:drag-move', (event, input: { dx?: number; dy?: number }) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender)
  if (!targetWindow || targetWindow.isDestroyed()) return
  const isMainWindow = targetWindow === mainWindow
  const isFloralSurface = findFloralSurfaceWindow(floralSurfaceWindows.values(), event.sender) === targetWindow
  if (!isMainWindow && !isFloralSurface) return
  const dx = Number(input?.dx)
  const dy = Number(input?.dy)
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 500 || Math.abs(dy) > 500) return
  const bounds = targetWindow.getBounds()
  targetWindow.setPosition(Math.round(bounds.x + dx), Math.round(bounds.y + dy))
})

ipcMain.handle('window:restore-default-size', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false
  restoreMainWindowDefaultSize()
  return true
})

// 无边框透明窗口的自定义关闭按钮：走 close 事件，保留「关闭即隐藏到托盘」
ipcMain.handle('window:close', () => {
  mainWindow?.close()
  return true
})

// 标题栏右键 → 原生系统菜单（还原/最小化/最大化/关闭）
ipcMain.handle('window:system-menu', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
  if (!win) return false
  const menu = Menu.buildFromTemplate([
    { label: '还原', enabled: win.isMaximized(), click: () => win.unmaximize() },
    { label: '最小化', click: () => win.minimize() },
    { label: '最大化', enabled: !win.isMaximized(), click: () => win.maximize() },
    { type: 'separator' },
    { label: '关闭', click: () => win.close() },
  ])
  menu.popup({ window: win })
  return true
})

// 应用官方图标（dataURL）：渲染层标题栏与设置页复用
ipcMain.handle('app:get-icon', () => ftLogoBase64())

// 数据库修复工具：手动校验（完整性 + 条数 + 体积）
ipcMain.handle('db:check', () => {
  if (!db) return { ok: false, count: 0, integrity: 'no database', size: 0 }
  try {
    const r = db.exec('PRAGMA integrity_check')
    const integrity = String(r[0]?.values[0]?.[0] ?? 'unknown')
    const c = db.exec('SELECT COUNT(*) FROM items')
    return {
      ok: integrity === 'ok',
      integrity,
      count: Number(c[0]?.values[0]?.[0] ?? 0),
      size: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0,
    }
  } catch (err: any) {
    return { ok: false, count: 0, integrity: err?.message ?? 'check failed', size: 0 }
  }
})

ipcMain.handle('app:open-logs', async () => {
  const dir = getStorageLayoutOrThrow().logsDir
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return (await shell.openPath(dir)) === ''
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
  return getStorageLayoutOrThrow().rootDir
})

ipcMain.handle('storage:get-folders', () => {
  const layout = getStorageLayoutOrThrow()
  return { root: layout.rootDir, transfers: layout.transfersDir, exports: layout.exportsDir, logs: layout.logsDir }
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
    const oldLayout = getStorageLayoutOrThrow()
    const newRoot = path.resolve(newPath)
    if (oldLayout.rootDir === newRoot) {
      return { success: true }
    }
    stopClipboardMonitor()
    if (db) saveDb()
    const target = getStorageLayout(newRoot)
    ensureStorageLayout(target)
    if (fs.existsSync(oldLayout.dbPath)) fs.copyFileSync(oldLayout.dbPath, target.dbPath)
    for (const [from, to] of [
      [oldLayout.imagesDir, target.imagesDir], [oldLayout.textsDir, target.textsDir], [oldLayout.transfersDir, target.transfersDir],
      [oldLayout.exportsDir, target.exportsDir], [oldLayout.logsDir, target.logsDir],
      [oldLayout.syncDir, target.syncDir],
    ] as const) {
      if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true, force: false })
    }
    if (fs.existsSync(target.dbPath)) {
      if (fs.statSync(target.dbPath).size === 0 || !sqlModule) throw new Error('数据库文件迁移失败')
      const probe = new sqlModule.Database(fs.readFileSync(target.dbPath))
      try { probe.exec('SELECT COUNT(*) FROM sqlite_master') } finally { probe.close() }
    }
    config.storagePath = target.rootDir
    fs.writeFileSync(target.configPath, JSON.stringify(config, null, 2), 'utf8')
    writeStorageRootPointer(path.join(app.getPath('userData'), 'q-paste-storage-root.json'), target.rootDir)
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

    // 主进程日志落盘（最早初始化，后续所有报错可追溯）
    try {
      log.transports.file.resolvePathFn = () => path.join(getStorageLayoutOrThrow().logsDir, 'main.log')
      log.transports.file.maxSize = 5 * 1024 * 1024
      const origError = console.error.bind(console)
      console.error = (...args: unknown[]) => {
        origError(...args)
        log.error(...args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a))))
      }
      const origInfo = console.log.bind(console)
      console.log = (...args: unknown[]) => {
        origInfo(...args)
        log.info(...args.map((a) => String(a)))
      }
    } catch {}

    // 数据库加载是一切功能的前提：必须先于窗口/监听/任何写操作
    await initDatabase()
    try {
      log.transports.file.resolvePathFn = () => path.join(getStorageLayoutOrThrow().logsDir, 'main.log')
      log.transports.file.maxSize = 5 * 1024 * 1024
      cleanupStaleTempFiles(getStorageLayoutOrThrow().tempDir)
    } catch {}

    // 应用自启设置（Windows 注册表）
    app.setLoginItemSettings({ openAtLogin: config.autoStart ?? true })

    // 首屏关键路径：窗口/托盘/快捷键/剪贴板捕获 立即初始化
    createWindow()
    createTray()
    registerGlobalShortcut()
    void getFloralStore().getConfig().then(applyFloralShortcuts).catch((error) => log.warn('Floral shortcuts unavailable:', error))
    startClipboardMonitor()

    // ft-file:// → 本地文件流（带 Range 支持，供聊天视图图片/视频预览）
    protocol.handle('ft-file', (request) => {
      const u = new URL(request.url)
      const filePath = path.resolve(decodeURIComponent(`${u.host}${u.pathname}`))
      // 白名单：仅允许图片资源目录与文件传输保存目录，防任意本地文件读取
      const allowed = [path.resolve(getImagesDir()), path.resolve(ftSaveDir())]
      const inside = allowed.some((root) => filePath === root || filePath.startsWith(root + path.sep))
      if (!inside) return new Response('Forbidden', { status: 403 })
      return net.fetch(pathToFileURL(filePath).toString())
    })

    // 非关键服务错峰初始化：首窗可交互后再启动，不拖慢冷启动
    setTimeout(() => {
      try {
        startRetentionTimer()
        enforceRetentionRules()
        saveDb()

        // 云端同步（WebDAV）：初始化引擎；未启用时仅加载配置，不发网络请求
        applyCloudSyncConfig().catch((err) => console.error('[Q-Paste] 云同步初始化失败:', err))

        // 局域网文件传输：沿用上次会话的开关状态
        if (config.fileTransferEnabled) {
          ftServer.start(config.fileTransferPort ?? FILE_TRANSFER_DEFAULT_PORT, config.fileTransferAutoClose ?? false, { host: config.fileTransferBindIp ?? '' })
            .then((p) => console.log(`[Q-Paste] 文件传输服务已启动: ${p}`))
            .catch((err) => console.error('[Q-Paste] 文件传输服务启动失败:', err))
        }

        // 自动更新：仅打包后启动检查；开发模式跳过
        if (app.isPackaged) {
          setupAutoUpdater()
          try { autoUpdater?.checkForUpdates() } catch {}
        }

        console.log(`[Q-Paste] 启动耗时: ${Date.now() - BOOT_T0}ms（全部服务就绪）`)
      } catch (err) {
        console.error('[Q-Paste] 延迟初始化失败:', err)
      }
    }, 400)
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
    ftServer.stop()
    globalShortcut.unregisterAll()
    if (db) { saveDb(); db.close() }
  })
}
