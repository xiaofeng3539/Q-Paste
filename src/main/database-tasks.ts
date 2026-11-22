import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { NativeDatabase, openHistoryDatabase, writeDatabaseSnapshot } from './native-database'
import { type StorageLayout } from './storage-layout'
import { searchIncludes } from '../lib/search'
import { insertHistoryItem, type HistoryItemInput, type HistoryInsertResult } from './history-write'

type SyncImportItem = HistoryItemInput & { receipt: string }
type SyncImportResult = HistoryItemInput & { id: number }
type SyncExportRow = { type: string; content: string; preview: string; createdAt: string }

export type DatabaseTask =
  | { kind: 'flush' }
  | { kind: 'open'; layout: StorageLayout }
  | { kind: 'snapshot'; source: string; target: string }
  | { kind: 'backup-db'; layout: StorageLayout; target: string }
  | { kind: 'backup-json'; layout: StorageLayout; version: string; target?: string; previousHash?: string }
  | { kind: 'import-json'; layout: StorageLayout; file: string }
  | { kind: 'sync-import'; layout: StorageLayout; items: SyncImportItem[]; maxRecords?: number }
  | { kind: 'sync-export'; layout: StorageLayout }
  | { kind: 'insert'; layout: StorageLayout; item: HistoryItemInput; options: { dedupe: boolean; maxRecords?: number } }
  | { kind: 'content'; layout: StorageLayout; id: number }
  | { kind: 'search'; layout: StorageLayout; ids: number[]; query: string }
  | { kind: 'query'; file: string; sql: string; bindings?: Record<string, string | number | null> }

export type DatabaseTaskResult<T extends DatabaseTask> =
  T extends { kind: 'open' } ? ReturnType<typeof openHistoryDatabase>
    : T extends { kind: 'snapshot' | 'flush' } ? void
      : T extends { kind: 'backup-db' } ? boolean
      : T extends { kind: 'insert' } ? HistoryInsertResult
        : T extends { kind: 'backup-json' } ? { hash: string; payload: string | null }
        : T extends { kind: 'import-json' } ? { count: number; duplicates: number; skipped: number }
        : T extends { kind: 'sync-import' } ? SyncImportResult[]
        : T extends { kind: 'sync-export' } ? SyncExportRow[]
        : T extends { kind: 'content' } ? string
        : T extends { kind: 'search' } ? number[]
          : ReturnType<ReturnType<NativeDatabase['prepare']>['getAsObject']>[]

export function isStoredTextReference(content: string): boolean {
  return /^texts\/txt_\d+_[\da-f-]+\.txt$/i.test(content)
}

function readStoredContent(type: string, content: string, layout: StorageLayout): string {
  if (type === 'image' && content && !content.startsWith('data:')) {
    const file = path.resolve(layout.imagesDir, content.replace(/^images[\\/]/, ''))
    if (!file.startsWith(path.resolve(layout.imagesDir) + path.sep)) return ''
    try {
      const bytes = fs.readFileSync(file)
      const extension = path.extname(file).slice(1).toLowerCase()
      const format = extension === 'jpg' || extension === 'jpeg' ? 'jpeg' : 'png'
      return `data:image/${format};base64,${bytes.toString('base64')}`
    } catch { return '' }
  }
  if (isStoredTextReference(content)) {
    const file = path.join(layout.textsDir, path.basename(content))
    try { return fs.readFileSync(file, 'utf8') } catch { return '' }
  }
  return content
}

function backupJson(db: NativeDatabase, task: Extract<DatabaseTask, { kind: 'backup-json' }>) {
  const statement = db.prepare(`SELECT id, type, content, preview, char_count, storage_size, created_at,
    is_pinned, pinned_at, alias, tags, is_sensitive, sort_order, vault_sort_order FROM items
    ${task.target ? '' : 'WHERE is_sensitive = 0'} ORDER BY id`)
  const items: ReturnType<typeof statement.getAsObject>[] = []
  while (statement.step()) {
    const row = statement.getAsObject()
    const stored = String(row.content ?? '')
    if ((row.type === 'image' && stored && !stored.startsWith('data:')) || isStoredTextReference(stored)) {
      row.content = readStoredContent(String(row.type), stored, task.layout)
      if (!row.content) throw new Error(`无法读取备份记录 ${row.id} 的正文或图片`)
    }
    items.push(row)
  }
  const data = { app: 'Q-Paste', version: task.version, count: items.length, items }
  const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex')
  if (!task.target && hash === task.previousHash) return { hash, payload: null }
  const payload = JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2)
  if (!task.target) return { hash, payload }
  const temp = `${task.target}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temp, payload, { encoding: 'utf8', flush: true })
    fs.renameSync(temp, task.target)
  } finally {
    try { fs.rmSync(temp, { force: true }) } catch { /* Best-effort staging cleanup. */ }
  }
  return { hash, payload: null }
}

function backupDatabase(layout: StorageLayout, target: string): boolean {
  const originalPath = path.resolve(layout.dbPath)
  const outputPath = path.resolve(target)
  if (originalPath === outputPath || (process.platform === 'win32' && originalPath.toLowerCase() === outputPath.toLowerCase())) {
    throw new Error('备份路径不能覆盖正在使用的数据库')
  }
  const stage = fs.mkdtempSync(path.join(path.dirname(target), '.qpaste-backup-'))
  const snapshot = path.join(stage, 'backup.db')
  const published: string[] = []
  const prior: Array<[original: string, retained: string]> = []
  let committed = false
  try {
    writeDatabaseSnapshot(layout.dbPath, snapshot)
    const db = new NativeDatabase(snapshot, true)
    let imagesCopied = false
    try {
      const rows = db.prepare('SELECT id, type, content FROM items')
      while (rows.step()) {
        const row = rows.getAsObject()
        const content = String(row.content ?? '')
        const kind = row.type === 'image' && content && !content.startsWith('data:')
          ? 'images' : isStoredTextReference(content) ? 'texts' : undefined
        if (!kind) continue
        const name = content.replace(new RegExp(`^${kind}[/\\\\]`), '')
        if (name !== path.basename(name) || name === '.' || name === '..' || !name) throw new Error(`备份记录 ${row.id} 的文件路径无效`)
        const directory = path.join(stage, kind)
        fs.mkdirSync(directory, { recursive: true })
        fs.copyFileSync(path.join(kind === 'images' ? layout.imagesDir : layout.textsDir, name), path.join(directory, name))
        if (kind === 'images') imagesCopied = true
      }
    } finally { db.close() }

    for (const kind of ['images', 'texts']) {
      const sidecar = `${target}.${kind}`
      if (fs.existsSync(sidecar)) {
        const retained = path.join(stage, `previous-${kind}`)
        fs.renameSync(sidecar, retained)
        prior.push([sidecar, retained])
      }
      const next = path.join(stage, kind)
      if (fs.existsSync(next)) {
        fs.renameSync(next, sidecar)
        published.push(sidecar)
      }
    }
    fs.renameSync(snapshot, target)
    committed = true
    return imagesCopied
  } finally {
    if (!committed) {
      for (const output of published) fs.renameSync(output, path.join(stage, path.extname(output).slice(1)))
      for (const [output, retained] of prior) fs.renameSync(retained, output)
    }
    try { fs.rmSync(stage, { recursive: true, force: true }) } catch { /* Best-effort staging cleanup. */ }
  }
}

function importSyncItems(db: NativeDatabase, task: Extract<DatabaseTask, { kind: 'sync-import' }>): SyncImportResult[] {
  return db.transaction(() => {
    db.run('CREATE TABLE IF NOT EXISTS sync_receipts (id TEXT PRIMARY KEY) WITHOUT ROWID')
    const getReceipt = db.prepare('SELECT id FROM sync_receipts WHERE id = :id')
    const inserted: SyncImportResult[] = []
    for (const { receipt, ...item } of task.items) {
      getReceipt.bind({ ':id': receipt })
      if (getReceipt.step()) continue
      if (item.type === 'image') item.content = storePortableImage(task.layout, item.content)
      const result = insertHistoryItem(db, task.layout, item, { dedupe: true, maxRecords: task.maxRecords })
      if (!result.id) throw new Error('远端记录未成功写入本地数据库')
      db.run('INSERT INTO sync_receipts (id) VALUES (:id)', { ':id': receipt })
      inserted.push({ ...item, id: result.id })
    }
    return inserted
  })
}

function exportSyncItems(db: NativeDatabase, layout: StorageLayout): SyncExportRow[] {
  const rows = db.prepare(`SELECT id, type, content, preview, created_at FROM items
    WHERE is_sensitive = 0 AND type != 'files' ORDER BY created_at ASC, id ASC`)
  const result: SyncExportRow[] = []
  while (rows.step()) {
    const row = rows.getAsObject()
    const type = String(row.type)
    const reference = String(row.content ?? '')
    const content = readStoredContent(type, reference, layout)
    if (reference && !content) throw new Error(`无法读取同步记录 ${row.id} 的正文或图片`)
    if (content.trim()) result.push({ type, content, preview: String(row.preview ?? ''), createdAt: String(row.created_at ?? '') })
  }
  return result
}

function storePortableImage(layout: StorageLayout, data: string): string {
  const image = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(data)
  if (!image) throw new Error('无法读取备份或同步中的图片')
  const extension = image[1].toLowerCase() === 'png' ? 'png' : 'jpg'
  const bytes = Buffer.from(image[2], 'base64')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const name = `img_content_${hash}.${extension}`
  const target = path.join(layout.imagesDir, name)
  fs.mkdirSync(layout.imagesDir, { recursive: true })
  if (!fs.existsSync(target)) {
    const temp = `${target}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(temp, bytes, { flush: true })
      fs.renameSync(temp, target)
    } finally {
      try { fs.rmSync(temp, { force: true }) } catch { /* Best-effort staging cleanup. */ }
    }
  }
  return `images/${name}`
}

function importBackupJson(db: NativeDatabase, task: Extract<DatabaseTask, { kind: 'import-json' }>) {
  const data = JSON.parse(fs.readFileSync(task.file, 'utf8'))
  const items = Array.isArray(data) ? data : data?.items
  if (!Array.isArray(items)) throw new Error('无效的 Q-Paste JSON 备份')
  return db.transaction(() => {
    const result = { count: 0, duplicates: 0, skipped: 0 }
    const same = db.prepare('SELECT id FROM items WHERE type = :type AND content = :content LIMIT 1')
    for (const row of items) {
      if (!row || typeof row.content !== 'string' || !row.content || isStoredTextReference(row.content)) {
        result.skipped++
        continue
      }
      const type = ['text', 'url', 'image', 'html', 'files'].includes(row.type) ? row.type : 'text'
      if (type === 'image' && !row.content.startsWith('data:')) { result.skipped++; continue }
      const content = type === 'image' ? storePortableImage(task.layout, row.content) : row.content
      same.bind({ ':type': type, ':content': content })
      if (same.step()) { result.duplicates++; continue }
      let tags = row.tags
      if (typeof tags === 'string') {
        try { tags = JSON.parse(tags) } catch { tags = [] }
      }
      const createdAt = typeof row.created_at === 'string' ? row.created_at : new Date().toISOString().slice(0, 19).replace('T', ' ')
      db.run(`INSERT INTO items (type, content, preview, char_count, storage_size, created_at, is_pinned,
        pinned_at, alias, tags, is_sensitive, sort_order, vault_sort_order)
        VALUES (:type, :content, :preview, :chars, :bytes, :created, :pinned, :pinnedAt,
        :alias, :tags, :sensitive, :sort, :vaultSort)`, {
        ':type': type, ':content': content, ':preview': typeof row.preview === 'string' ? row.preview : content.slice(0, 100),
        ':chars': Number(row.char_count) || 0, ':bytes': Number(row.storage_size) || Buffer.byteLength(content),
        ':created': createdAt, ':pinned': row.is_pinned ? 1 : 0,
        ':pinnedAt': row.is_pinned ? (typeof row.pinned_at === 'string' && row.pinned_at || createdAt) : null,
        ':alias': typeof row.alias === 'string' ? row.alias : '',
        ':tags': JSON.stringify(Array.isArray(tags) ? tags.filter(tag => typeof tag === 'string') : []),
        ':sensitive': row.is_sensitive ? 1 : 0,
        ':sort': typeof row.sort_order === 'number' ? row.sort_order : Date.parse(createdAt) || 0,
        ':vaultSort': typeof row.vault_sort_order === 'number' ? row.vault_sort_order : null,
      })
      result.count++
    }
    return result
  })
}

export function runDatabaseTask(task: DatabaseTask): unknown {
  if (task.kind === 'flush') return
  if (task.kind === 'open') return openHistoryDatabase(task.layout)
  if (task.kind === 'snapshot') return writeDatabaseSnapshot(task.source, task.target)
  if (task.kind === 'backup-db') return backupDatabase(task.layout, task.target)

  const db = new NativeDatabase(task.kind === 'query' ? task.file : task.layout.dbPath,
    task.kind !== 'insert' && task.kind !== 'sync-import' && task.kind !== 'import-json')
  try {
    if (task.kind === 'insert') return db.transaction(() => insertHistoryItem(db, task.layout, task.item, task.options))
    if (task.kind === 'sync-import') return importSyncItems(db, task)
    if (task.kind === 'sync-export') return exportSyncItems(db, task.layout)
    if (task.kind === 'import-json') return importBackupJson(db, task)
    if (task.kind === 'backup-json') return backupJson(db, task)
    if (task.kind === 'query') {
      const statement = db.prepare(task.sql)
      if (task.bindings) statement.bind(task.bindings)
      const rows: ReturnType<typeof statement.getAsObject>[] = []
      while (statement.step()) rows.push(statement.getAsObject())
      return rows
    }

    if (task.kind === 'content') {
      const statement = db.prepare('SELECT type, content FROM items WHERE id = :id')
      statement.bind({ ':id': task.id })
      const row = statement.step() ? statement.getAsObject() : undefined
      return row ? readStoredContent(String(row.type), String(row.content ?? ''), task.layout) : ''
    }
    const found = new Set<number>()
    for (let offset = 0; offset < task.ids.length; offset += 500) {
      const ids = task.ids.slice(offset, offset + 500)
      const keys = ids.map((_, index) => `:id${index}`)
      const statement = db.prepare(`SELECT id, type, preview, content FROM items WHERE id IN (${keys.join(',')})`)
      statement.bind(Object.fromEntries(keys.map((key, index) => [key, ids[index]])))
      while (statement.step()) {
        const row = statement.getAsObject()
        const preview = String(row.preview ?? '')
        const type = String(row.type)
        if (searchIncludes(preview, task.query)) {
          found.add(Number(row.id))
          continue
        }
        if (type === 'image') continue
        const content = readStoredContent(type, String(row.content ?? ''), task.layout)
        if (searchIncludes(preview + '\n' + content, task.query)) found.add(Number(row.id))
      }
    }
    return task.ids.filter((id) => found.has(id))
  } finally {
    db.close()
  }
}
