import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import Sidebar from '../src/components/Sidebar'
import DetailView from '../src/components/DetailView'
import type { ClipboardItem } from '../src/types'
import { mergeClipboardTexts, resolveMergeSeparator } from '../src/lib/clipboard-actions'
import { detectColor, detectJson, detectTimestamp, inspectClipboardText } from '../src/lib/smart-inspect'
import { formatSourceAppName } from '../electron/direct-paste'
import { NativeDatabase } from '../src/main/native-database'
import { ensureStorageLayout, getStorageLayout } from '../src/main/storage-layout'
import { runDatabaseTask } from '../src/main/database-tasks'
import { insertHistoryItem } from '../src/main/history-write'

const tempRoots: string[] = []
afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function makeItem(id: number, overrides: Partial<ClipboardItem> = {}): ClipboardItem {
  return {
    id,
    type: 'text',
    content: `content-${id}`,
    preview: `preview-${id}`,
    char_count: 9,
    storage_size: 9,
    created_at: '2026-11-24 12:00:00',
    is_pinned: false,
    alias: '',
    tags: [],
    is_sensitive: false,
    ocr_text: '',
    source_app: '',
    ...overrides,
  }
}

function createFullDb() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'q-paste-f8-11-'))
  tempRoots.push(root)
  const layout = getStorageLayout(root)
  ensureStorageLayout(layout)
  const db = new NativeDatabase(layout.dbPath)
  db.run(`CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    preview TEXT NOT NULL DEFAULT '',
    char_count INTEGER NOT NULL DEFAULT 0,
    storage_size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    pinned_at TEXT,
    alias TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    is_sensitive INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    vault_sort_order INTEGER NOT NULL DEFAULT 0,
    ocr_text TEXT NOT NULL DEFAULT '',
    source_app TEXT NOT NULL DEFAULT ''
  )`)
  return { layout, db }
}

describe('Feature 8: OCR text indexing & search', () => {
  it('searches image items by indexed ocr_text via substring and pinyin, and preserves ocr_text + source_app in backup/import', () => {
    const { layout, db } = createFullDb()
    try {
      fs.writeFileSync(path.join(layout.imagesDir, 'receipt.jpg'), Buffer.from([0xff, 0xd8, 0xff]))
      db.run(
        `INSERT INTO items (id, type, content, preview, char_count, storage_size, created_at, ocr_text, source_app)
         VALUES (1, 'image', 'images/receipt.jpg', '图片 800×600', 0, 3, '2026-11-24 12:00:00', '报销单金额 1280 元', '微信')`,
      )
      db.run(
        `INSERT INTO items (id, type, content, preview, char_count, storage_size, created_at, ocr_text, source_app)
         VALUES (2, 'text', 'hello world', 'hello world', 11, 11, '2026-11-24 12:01:00', '', 'VS Code')`,
      )

      // Direct substring match on image OCR text
      expect(runDatabaseTask({ kind: 'search', layout, ids: [1, 2], query: '报销单' })).toEqual([1])
      expect(runDatabaseTask({ kind: 'search', layout, ids: [1, 2], query: '1280' })).toEqual([1])
      // Pinyin match on image OCR text
      expect(runDatabaseTask({ kind: 'search', layout, ids: [1, 2], query: 'baoxiaodan' })).toEqual([1])
      // Source app match
      expect(runDatabaseTask({ kind: 'search', layout, ids: [1, 2], query: 'VS Code' })).toEqual([2])

      // Backup & restore preserve ocr_text and source_app
      const backupFile = path.join(layout.exportsDir, 'backup.json')
      runDatabaseTask({ kind: 'backup-json', layout, version: '1.4.0', target: backupFile })
      const exported = JSON.parse(fs.readFileSync(backupFile, 'utf8'))
      expect(exported.items[0]).toMatchObject({ ocr_text: '报销单金额 1280 元', source_app: '微信' })
      expect(exported.items[1]).toMatchObject({ source_app: 'VS Code' })

      db.run('DELETE FROM items')
      const imported = runDatabaseTask({ kind: 'import-json', layout, file: backupFile })
      expect(imported).toEqual({ count: 2, duplicates: 0, skipped: 0 })
      const rows = db.exec("SELECT type, ocr_text, source_app FROM items ORDER BY type")
      expect(rows[0].values).toEqual([
        ['image', '报销单金额 1280 元', '微信'],
        ['text', '', 'VS Code'],
      ])
    } finally {
      db.close()
    }
  })

  it('renders indexed OCR banner in DetailView and OCR snippet in Sidebar for image items', () => {
    const imgItem = makeItem(1, {
      type: 'image',
      content: 'data:image/png;base64,iVBORw0KGgo=',
      preview: '图片 400×300',
      ocr_text: '发票抬头：示例科技有限公司',
    })

    const detailHtml = renderToStaticMarkup(createElement(DetailView, {
      item: imgItem,
      density: 'comfortable',
      onCopy: () => {},
      onDelete: () => {},
      onUpdate: () => {},
    }))
    expect(detailHtml).toContain('data-testid="indexed-ocr-banner"')
    expect(detailHtml).toContain('发票抬头：示例科技有限公司')

    const sidebarHtml = renderToStaticMarkup(createElement(Sidebar, {
      items: [imgItem],
      selectedId: 1,
      searchQuery: '发票',
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
    }))
    expect(sidebarHtml).toContain('发票')
    expect(sidebarHtml).toContain('示例科技有限公司')
  })
})

describe('Feature 9: Multi-select batch merge copy', () => {
  it('resolves separator presets including custom escape sequences', () => {
    expect(resolveMergeSeparator('newline')).toBe('\n')
    expect(resolveMergeSeparator('blankLine')).toBe('\n\n')
    expect(resolveMergeSeparator('comma')).toBe(', ')
    expect(resolveMergeSeparator('dunhao')).toBe('、')
    expect(resolveMergeSeparator('space')).toBe(' ')
    expect(resolveMergeSeparator('custom', '\\n---\\n')).toBe('\n---\n')
    expect(resolveMergeSeparator('custom', '\\t')).toBe('\t')
  })

  it('merges plain text, strips HTML, joins file paths, and skips images & blank entries', () => {
    const result = mergeClipboardTexts([
      { type: 'text', content: '  第一行  ' },
      { type: 'image', content: 'data:image/png;base64,abc' },
      { type: 'html', content: '<p>第二行 <b>加粗</b></p>' },
      { type: 'text', content: '   ' },
      { type: 'files', content: JSON.stringify(['C:\\a.txt', 'C:\\b.txt']) },
    ], ', ')
    expect(result).toEqual({
      merged: '第一行, 第二行 加粗, C:\\a.txt\nC:\\b.txt',
      count: 3,
    })
  })

  it('renders batch toolbar with separator presets only when selectedIds is non-empty', () => {
    const items = [makeItem(1), makeItem(2)]
    const baseProps = {
      items,
      selectedId: 1,
      searchQuery: '',
      onSearchChange: () => {},
      onSelect: () => {},
      density: 'comfortable' as const,
      activeTab: 'history' as const,
      onTabChange: () => {},
      allTags: [],
      selectedTag: null,
      onTagChange: () => {},
      onReorder: () => {},
      onVaultReorder: () => {},
      typeFilter: 'all' as const,
      onTypeFilterChange: () => {},
      onBatchCopy: () => {},
      onBatchPin: () => {},
      onBatchDelete: () => {},
      onBatchAddTag: () => {},
    }

    const withoutSelection = renderToStaticMarkup(createElement(Sidebar, baseProps))
    expect(withoutSelection).not.toContain('data-testid="sidebar-batch-bar"')

    const withSelection = renderToStaticMarkup(createElement(Sidebar, {
      ...baseProps,
      selectedIds: new Set([1, 2]),
    }))
    expect(withSelection).toContain('data-testid="sidebar-batch-bar"')
    expect(withSelection).toContain('data-testid="batch-merge-copy"')
    expect(withSelection).toContain('data-sep-preset="newline"')
    expect(withSelection).toContain('data-sep-preset="comma"')
    expect(withSelection).toContain('data-sep-preset="custom"')
  })
})

describe('Feature 10: Smart color / timestamp / JSON inspector', () => {
  it('detects hex, rgb/rgba, and hsl/hsla color values and rejects non-colors', () => {
    const hex6 = detectColor('#3b82f6')
    expect(hex6).toMatchObject({ hex: '#3b82f6', rgb: 'rgb(59, 130, 246)' })

    const hex3 = detectColor('#f0a')
    expect(hex3).toMatchObject({ hex: '#ff00aa', rgb: 'rgb(255, 0, 170)' })

    const rgba = detectColor('rgba(32, 34, 38, 0.5)')
    expect(rgba).toMatchObject({ hex: '#20222680', rgb: 'rgba(32, 34, 38, 0.5)' })

    const hsl = detectColor('hsl(0, 100%, 50%)')
    expect(hsl).toMatchObject({ hex: '#ff0000', rgb: 'rgb(255, 0, 0)' })

    expect(detectColor('not a color')).toBeNull()
    expect(detectColor('#12345')).toBeNull()
  })

  it('detects 10-digit and 13-digit Unix timestamps and rejects phone numbers', () => {
    const sec = detectTimestamp('1700000000')
    expect(sec).toMatchObject({ unit: 's', ms: 1700000000000, isoUtc: '2023-11-14T22:13:20.000Z' })

    const ms = detectTimestamp('1700000000123')
    expect(ms).toMatchObject({ unit: 'ms', ms: 1700000000123, isoUtc: '2023-11-14T22:13:20.123Z' })

    expect(detectTimestamp('13800138000')).toBeNull() // 11-digit phone number
    expect(detectTimestamp('12345')).toBeNull()
  })

  it('detects JSON objects and arrays and ignores primitives or invalid JSON', () => {
    const obj = detectJson('{"name":"Q-Paste","tags":["clip","ocr"]}')
    expect(obj).toMatchObject({ kind: 'object', entryCount: 2 })
    expect(obj?.minified).toBe('{"name":"Q-Paste","tags":["clip","ocr"]}')
    expect(obj?.formatted).toContain('\n  "name": "Q-Paste"')

    const arr = detectJson('[1, 2, 3]')
    expect(arr).toMatchObject({ kind: 'array', entryCount: 3 })

    expect(detectJson('"just a string"')).toBeNull()
    expect(detectJson('{invalid')).toBeNull()
  })

  it('renders smart cards in DetailView for color, timestamp, and JSON items', () => {
    const colorHtml = renderToStaticMarkup(createElement(DetailView, {
      item: makeItem(1, { content: '#3b82f6', preview: '#3b82f6' }),
      density: 'comfortable',
      onCopy: () => {},
      onDelete: () => {},
      onUpdate: () => {},
    }))
    expect(colorHtml).toContain('data-testid="smart-color-card"')
    expect(colorHtml).toContain('#3b82f6')

    const tsHtml = renderToStaticMarkup(createElement(DetailView, {
      item: makeItem(2, { content: '1700000000', preview: '1700000000' }),
      density: 'comfortable',
      onCopy: () => {},
      onDelete: () => {},
      onUpdate: () => {},
    }))
    expect(tsHtml).toContain('data-testid="smart-timestamp-card"')
    expect(tsHtml).toContain('2023-11-14T22:13:20.000Z')

    const jsonHtml = renderToStaticMarkup(createElement(DetailView, {
      item: makeItem(3, { content: '{"ok":true,"count":42}', preview: '{"ok":true,"count":42}' }),
      density: 'comfortable',
      onCopy: () => {},
      onDelete: () => {},
      onUpdate: () => {},
    }))
    expect(jsonHtml).toContain('data-testid="smart-json-bar"')
    expect(jsonHtml).toContain('data-testid="json-tree-view"')
    expect(inspectClipboardText('{"ok":true}').json?.kind).toBe('object')
  })
})

describe('Feature 11: Real source app detection, persistence & filtering', () => {
  it('maps Windows process paths and UWP host titles to friendly app names', () => {
    expect(formatSourceAppName('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')).toBe('Chrome')
    expect(formatSourceAppName('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')).toBe('Edge')
    expect(formatSourceAppName('C:\\Users\\dev\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe')).toBe('VS Code')
    expect(formatSourceAppName('D:\\Tencent\\WeChat\\WeChat.exe')).toBe('微信')
    expect(formatSourceAppName('C:\\Windows\\System32\\ApplicationFrameHost.exe', '主页 - 微软商店')).toBe('微软商店')
    expect(formatSourceAppName('C:\\Tools\\MyCustomApp.exe')).toBe('MyCustomApp')
  })

  it('persists source_app in insertHistoryItem', () => {
    const { layout, db } = createFullDb()
    try {
      const inserted = insertHistoryItem(
        db,
        layout,
        {
          type: 'text',
          content: 'from chrome',
          preview: 'from chrome',
          charCount: 11,
          storageSize: 11,
          createdAt: '2026-11-24 12:30:00',
          sourceApp: 'Chrome',
          isSensitive: false,
        },
        { dedupe: true, maxRecords: 500 },
      )
      expect(inserted.id).toBeGreaterThan(0)
      const rows = db.exec(`SELECT source_app FROM items WHERE id = ${inserted.id}`)
      expect(rows[0].values).toEqual([['Chrome']])
    } finally {
      db.close()
    }
  })

  it('renders clickable source app badge in DetailView and source filter chips in Sidebar', () => {
    const item = makeItem(1, { source_app: 'Chrome' })
    const detailHtml = renderToStaticMarkup(createElement(DetailView, {
      item,
      density: 'comfortable',
      onCopy: () => {},
      onDelete: () => {},
      onUpdate: () => {},
      onFilterBySource: () => {},
    }))
    expect(detailHtml).toContain('data-testid="detail-source-app"')
    expect(detailHtml).toContain('Chrome')

    const sidebarHtml = renderToStaticMarkup(createElement(Sidebar, {
      items: [item],
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
      allSources: ['Chrome', 'VS Code'],
      selectedSource: 'Chrome',
      onSourceChange: () => {},
      onReorder: () => {},
      onVaultReorder: () => {},
      typeFilter: 'all',
      onTypeFilterChange: () => {},
    }))
    expect(sidebarHtml).toContain('data-testid="source-filter-bar"')
    expect(sidebarHtml).toContain('Chrome')
    expect(sidebarHtml).toContain('VS Code')
  })
})
