import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { NativeDatabase } from './native-database'
import type { StorageLayout } from './storage-layout'
import type { ClipboardCapture } from './clipboard-capture'

export type HistoryItemInput = ClipboardCapture & { isSensitive?: boolean }
export type HistoryInsertResult = { id: number | null; updated: boolean }

export function htmlToText(html: string): string {
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

export function trimHistory(db: NativeDatabase, max?: number): void {
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

const TEXT_OFFLOAD_BYTES = 64 * 1024

function offloadLargeText(layout: StorageLayout, type: string, content: string): string {
  if ((type === 'text' || type === 'html') && Buffer.byteLength(content, 'utf8') > TEXT_OFFLOAD_BYTES) {
    try {
      const dir = layout.textsDir
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const name = `txt_${Date.now()}_${randomUUID()}.txt`
      fs.writeFileSync(path.join(dir, name), content, 'utf-8')
      return `texts/${name}`
    } catch (err) {
      console.error('[Q-Paste] 大文本落盘失败，改为库内存储:', err)
    }
  }
  return content
}

function nextSortOrder(db: NativeDatabase): number {
  const stmt = db.prepare('SELECT MAX(sort_order) AS mx FROM items')
  let mx = 0
  if (stmt.step()) {
    const v = Number(stmt.getAsObject().mx)
    if (Number.isFinite(v)) mx = v
  }
  stmt.free()
  return mx + 1
}

function hasSourceAppColumn(db: NativeDatabase): boolean {
  try {
    const rows = db.exec('PRAGMA table_info(items)')[0]?.values ?? []
    return rows.some((row) => String(row[1]) === 'source_app')
  } catch {
    return false
  }
}

export function insertHistoryItem(db: NativeDatabase, layout: StorageLayout, item: HistoryItemInput, options: { dedupe: boolean; maxRecords?: number }): HistoryInsertResult {
  const sourceApp = (item.sourceApp || '').trim()
  const withSourceApp = hasSourceAppColumn(db)

  // 大文本落盘：库内只存引用（引用串彼此不同，超大同内容不去重，可接受）
  const storedContent = offloadLargeText(layout, item.type, item.content)

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
        if (withSourceApp && sourceApp) {
          db.run(
            `UPDATE items SET type = 'html', content = :content, preview = :preview,
             char_count = :charCount, storage_size = :storageSize, created_at = :createdAt,
             sort_order = :sortOrder, source_app = :sourceApp
             WHERE id = :id`,
            {
              ':content': item.content,
              ':preview': item.preview,
              ':charCount': item.charCount,
              ':storageSize': item.storageSize,
              ':createdAt': item.createdAt,
              ':sortOrder': nextSortOrder(db),
              ':sourceApp': sourceApp,
              ':id': upgradeId,
            }
          )
        } else {
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
              ':sortOrder': nextSortOrder(db),
              ':id': upgradeId,
            }
          )
        }
        return { id: upgradeId, updated: true }
      }
    }
  }

  // 内容去重置顶（可配置）：文本/URL 存在相同内容的未收藏记录时，复用该记录并更新到最新（避免重复堆积）
  if (options.dedupe && item.type !== 'image' && item.content) {
    const dup = db.prepare('SELECT id FROM items WHERE type = :type AND content = :content AND is_pinned = 0 LIMIT 1')
    dup.bind({ ':type': item.type, ':content': item.content })
    let dupId: number | null = null
    if (dup.step()) dupId = (dup.getAsObject().id as number) ?? null
    dup.free()

    if (dupId !== null) {
      if (withSourceApp && sourceApp) {
        db.run(
          `UPDATE items SET preview = :preview, char_count = :charCount, storage_size = :storageSize, created_at = :createdAt, sort_order = :sortOrder, source_app = :sourceApp WHERE id = :id`,
          {
            ':id': dupId,
            ':preview': item.preview,
            ':charCount': item.charCount,
            ':storageSize': item.storageSize,
            ':createdAt': item.createdAt,
            ':sortOrder': nextSortOrder(db),
            ':sourceApp': sourceApp,
          }
        )
      } else {
        db.run(
          `UPDATE items SET preview = :preview, char_count = :charCount, storage_size = :storageSize, created_at = :createdAt, sort_order = :sortOrder WHERE id = :id`,
          {
            ':id': dupId,
            ':preview': item.preview,
            ':charCount': item.charCount,
            ':storageSize': item.storageSize,
            ':createdAt': item.createdAt,
            ':sortOrder': nextSortOrder(db),
          }
        )
      }
      return { id: dupId, updated: true }
    }
  }

  if (withSourceApp) {
    db.run(
      `INSERT INTO items (type, content, preview, char_count, storage_size, created_at, is_sensitive, sort_order, source_app)
       VALUES (:type, :content, :preview, :charCount, :storageSize, :createdAt, :isSensitive, :sortOrder, :sourceApp)`,
      {
        ':type': item.type,
        ':content': storedContent,
        ':preview': item.preview,
        ':charCount': item.charCount,
        ':storageSize': item.storageSize,
        ':createdAt': item.createdAt,
        ':isSensitive': item.isSensitive ? 1 : 0,
        ':sortOrder': nextSortOrder(db),
        ':sourceApp': sourceApp,
      }
    )
  } else {
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
        ':sortOrder': nextSortOrder(db),
      }
    )
  }
  const res = db.exec('SELECT last_insert_rowid()')
  const id = Number(res[0]?.values[0]?.[0]) || null
  trimHistory(db, options.maxRecords)
  return { id, updated: false }
}
