import type { ClipboardItem } from '../types'

/**
 * 为刚收藏的条目分配金库顶部的排序值。
 * 排序值越大越靠前；传入的 id 顺序就是金库中从上到下的期望顺序。
 */
export function assignVaultSortOrders(items: ClipboardItem[], pinnedIds: number[]): ClipboardItem[] {
  if (pinnedIds.length === 0) return items

  const ids = new Set(pinnedIds)
  const currentMax = items.reduce((max, item) => Math.max(max, item.vault_sort_order ?? 0), 0)
  const orderById = new Map(pinnedIds.map((id, index) => [id, currentMax + pinnedIds.length - index]))

  return items.map((item) =>
    ids.has(item.id) ? { ...item, vault_sort_order: orderById.get(item.id) } : item,
  )
}
