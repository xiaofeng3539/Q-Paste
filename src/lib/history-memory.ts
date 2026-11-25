import type { ClipboardChangedData, ClipboardItem, ElectronAPI } from '../types'

/** 列表只持有摘要，正文缓存仅保留当前详情的一条记录。 */
export function historySummary(item: ClipboardItem): ClipboardItem {
  return { ...item, content: '', content_loaded: false }
}

export function appendHistorySummaries(current: ClipboardItem[], snapshot: ClipboardItem[]): ClipboardItem[] {
  const known = new Set(current.map((item) => item.id))
  const added = snapshot.filter((item) => {
    if (known.has(item.id)) return false
    known.add(item.id)
    return true
  })
  return added.length ? [...current, ...added] : current
}

/** 替换可见记录所在的位置，保留筛选隐藏的记录及拖拽期间新加入的记录。 */
export function mergeVisibleOrder(current: ClipboardItem[], orderedIds: number[]): ClipboardItem[] {
  const byId = new Map(current.map((item) => [item.id, item]))
  const visibleIds = new Set<number>()
  const ordered: ClipboardItem[] = []
  for (const id of orderedIds) {
    const item = byId.get(id)
    if (!item || visibleIds.has(id)) continue
    visibleIds.add(id)
    ordered.push(item)
  }
  let index = 0
  return current.map((item) => visibleIds.has(item.id) ? ordered[index++] : item)
}

export function applyClipboardChanges(current: ClipboardItem[], changes: ClipboardChangedData[]): ClipboardItem[] {
  const byId = new Map(current.map((item) => [item.id, item]))
  const updated = new Map<number, ClipboardItem>()
  for (const data of changes) {
    if (data.id === undefined) continue
    const existing = updated.get(data.id) ?? byId.get(data.id)
    const item: ClipboardItem = {
      ...existing,
      id: data.id,
      type: data.type,
      content: '',
      content_loaded: false,
      preview: data.preview,
      char_count: data.charCount ?? 0,
      storage_size: data.storageSize ?? 0,
      created_at: data.createdAt,
      is_pinned: existing?.is_pinned ?? false,
      alias: existing?.alias ?? '',
      tags: existing?.tags ?? [],
      is_sensitive: data.isSensitive ?? existing?.is_sensitive ?? false,
      ocr_text: existing?.ocr_text ?? '',
      source_app: data.sourceApp || existing?.source_app || '',
    }
    updated.delete(data.id)
    updated.set(data.id, item)
  }
  return updated.size ? [...Array.from(updated.values()).reverse(), ...current.filter((item) => !updated.has(item.id))] : current
}

export async function loadHistorySummaries(getItems: ElectronAPI['getItems'], getIds: ElectronAPI['getHistoryIds']): Promise<ClipboardItem[]> {
  const ids = await getIds()
  const rows: ClipboardItem[] = []
  for (let offset = 0; offset < ids.length; offset += 100) {
    const pageIds = ids.slice(offset, offset + 100)
    const page = await getItems({ limit: 100, offset: 0, summaryOnly: true, ids: pageIds })
    const byId = new Map(page.map((item) => [item.id, item]))
    for (const id of pageIds) {
      const item = byId.get(id)
      if (item) rows.push(historySummary(item))
    }
  }
  return rows
}

export function readHistoryContent(item: ClipboardItem, read: (id: number) => Promise<string>): Promise<string> {
  return item.content_loaded === false || (item.type === 'image' && !item.content)
    ? read(item.id)
    : Promise.resolve(item.content)
}
