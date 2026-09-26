import { describe, expect, it } from 'vitest'
import type { ClipboardItem } from '../src/types'
import { assignVaultSortOrders } from '../src/lib/vault-order'

function item(id: number, vaultSortOrder?: number): ClipboardItem {
  return {
    id,
    type: 'text',
    content: String(id),
    preview: String(id),
    char_count: 1,
    storage_size: 1,
    created_at: '2026-09-22 10:00:00',
    is_pinned: id !== 1,
    pinned_at: id !== 1 ? '2026-09-22 10:00:00' : null,
    alias: '',
    tags: [],
    is_sensitive: false,
    vault_sort_order: vaultSortOrder,
  }
}

describe('金库收藏排序', () => {
  it('收藏旧历史记录时为其分配最高排序值', () => {
    const updated = assignVaultSortOrders([
      item(1),
      item(2, 42),
      item(3, 12),
    ], [1])

    expect(updated.find((entry) => entry.id === 1)?.vault_sort_order).toBe(43)
  })
})
