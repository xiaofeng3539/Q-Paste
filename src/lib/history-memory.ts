import type { ClipboardItem, ElectronAPI } from '../types'

/** 列表只持有摘要，正文缓存仅保留当前详情的一条记录。 */
export function historySummary(item: ClipboardItem): ClipboardItem {
  return { ...item, content: '', content_loaded: false }
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
