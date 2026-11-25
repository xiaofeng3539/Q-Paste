import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import Sidebar from '../src/components/Sidebar'
import type { ClipboardItem } from '../src/types'

const sampleItem: ClipboardItem = {
  id: 1,
  type: 'text',
  content: 'hello',
  preview: 'hello',
  source_app: 'test',
  char_count: 5,
  storage_size: 5,
  is_pinned: false,
  alias: '',
  tags: [],
  is_sensitive: false,
  created_at: Date.now(),
  updated_at: Date.now(),
}

describe('侧栏列表条目点击热区与拖拽容差', () => {
  test('垂直内边距落在 button 上，整个条目卡片均可点击', () => {
    const markup = renderToStaticMarkup(
      createElement(Sidebar, {
        items: [sampleItem],
        selectedId: 1,
        searchQuery: '',
        onSearchChange: () => {},
        onSelect: () => {},
        density: 'comfortable',
        activeTab: 'history',
        onTabChange: () => {},
        allTags: [],
        selectedTag: null,
        onTagChange: () => {},
        onReorder: () => {},
        onVaultReorder: () => {},
        typeFilter: 'all',
        onTypeFilterChange: () => {},
      }),
    )

    const rowMatch = markup.match(/<div data-id="1" class="([^"]+)">/)
    expect(rowMatch).not.toBeNull()
    expect(rowMatch![1]).not.toMatch(/\bpy-\d/)

    const buttonMatch = markup.match(/<div data-id="1"[^>]*><button[^>]*class="([^"]+)"/)
    expect(buttonMatch).not.toBeNull()
    expect(buttonMatch![1]).toContain('w-full')
    expect(buttonMatch![1]).toContain('py-3')
    expect(buttonMatch![1]).toContain('px-2.5')
  })

  test('Sortable 配置拖拽容差避免快速点击误触发拖拽', () => {
    const source = readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8')
    const tolerance = source.match(/fallbackTolerance:\s*(\d+)/)
    expect(tolerance).not.toBeNull()
    expect(Number(tolerance![1])).toBeGreaterThanOrEqual(6)
  })
})
