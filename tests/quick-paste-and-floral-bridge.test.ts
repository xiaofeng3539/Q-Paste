import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Sidebar from '../src/components/Sidebar'
import type { ClipboardItem } from '../src/types'
import { getQuickPasteIndex, toPlainText } from '../src/lib/clipboard-actions'
import {
  buildKeyboardInputBuffer,
  buildPasteEvents,
  INPUT_KEYBOARD,
  KEYEVENTF_KEYUP,
  VK_CONTROL,
  VK_MENU,
  VK_SHIFT,
  VK_V,
} from '../electron/direct-paste'
import { FloralNotesStore } from '../electron/floral/notes-store'
import {
  appendFloralNoteContent,
  buildFloralMarkdownFromClipboard,
  buildFloralTitleFromClipboard,
  parseImageDataUrl,
  saveClipboardToFloralStore,
} from '../electron/floral/clipboard-bridge'

function makeItem(id: number, overrides: Partial<ClipboardItem> = {}): ClipboardItem {
  return {
    id,
    type: 'text',
    content: `item-${id}`,
    preview: `预览-${id}`,
    char_count: 6,
    storage_size: 6,
    created_at: '2026-11-24 10:00:00',
    is_pinned: false,
    alias: '',
    tags: [],
    is_sensitive: false,
    ...overrides,
  }
}

describe('direct-paste Win32 SendInput helpers', () => {
  it('builds 40-byte 64-bit INPUT structs and releases held modifiers before Ctrl+V', () => {
    const events = buildPasteEvents([VK_MENU, VK_SHIFT])
    expect(events).toEqual([
      { vk: VK_MENU, keyUp: true },
      { vk: VK_SHIFT, keyUp: true },
      { vk: VK_CONTROL, keyUp: false },
      { vk: VK_V, keyUp: false },
      { vk: VK_V, keyUp: true },
      { vk: VK_CONTROL, keyUp: true },
    ])

    const { buffer, structSize } = buildKeyboardInputBuffer(events, true)
    expect(structSize).toBe(40)
    expect(buffer.length).toBe(40 * 6)
    // Event 0: Alt key up
    expect(buffer.readUInt32LE(0)).toBe(INPUT_KEYBOARD)
    expect(buffer.readUInt16LE(8)).toBe(VK_MENU)
    expect(buffer.readUInt32LE(12)).toBe(KEYEVENTF_KEYUP)
    // Event 2: Ctrl key down
    expect(buffer.readUInt32LE(80)).toBe(INPUT_KEYBOARD)
    expect(buffer.readUInt16LE(88)).toBe(VK_CONTROL)
    expect(buffer.readUInt32LE(92)).toBe(0)
    // Event 3: V key down
    expect(buffer.readUInt16LE(128)).toBe(VK_V)
    expect(buffer.readUInt32LE(132)).toBe(0)
    // Event 4: V key up
    expect(buffer.readUInt16LE(168)).toBe(VK_V)
    expect(buffer.readUInt32LE(172)).toBe(KEYEVENTF_KEYUP)
  })

  it('builds 28-byte 32-bit INPUT structs cleanly', () => {
    const events = buildPasteEvents()
    const { buffer, structSize } = buildKeyboardInputBuffer(events, false)
    expect(structSize).toBe(28)
    expect(buffer.length).toBe(28 * 4)
    expect(buffer.readUInt16LE(4)).toBe(VK_CONTROL)
    expect(buffer.readUInt32LE(8)).toBe(0)
  })
})

describe('plain-text stripping and 1-9 quick paste shortcuts', () => {
  it('strips HTML tags, styles, and decodes entities while keeping paragraphs', () => {
    const html = '<style>p{color:red}</style><p>Hello &amp; <b>World</b></p><p>Line&nbsp;2<br/>Line 3</p>'
    expect(toPlainText('html', html)).toBe('Hello & World\nLine 2\nLine 3')
  })

  it('formats files JSON into newline-separated paths', () => {
    expect(toPlainText('files', JSON.stringify(['C:\\a.txt', 'D:\\b.png']))).toBe('C:\\a.txt\nD:\\b.png')
  })

  it('maps Alt+1..9 and Ctrl/Cmd+1..9 (including Digit code) and rejects conflicts', () => {
    expect(getQuickPasteIndex({ ctrlKey: true, metaKey: false, altKey: false, key: '1', code: 'Digit1' })).toBe(0)
    expect(getQuickPasteIndex({ ctrlKey: false, metaKey: true, altKey: false, key: '9', code: 'Digit9' })).toBe(8)
    expect(getQuickPasteIndex({ ctrlKey: false, metaKey: false, altKey: true, key: '3', code: 'Digit3' })).toBe(2)
    expect(getQuickPasteIndex({ ctrlKey: false, metaKey: false, altKey: true, key: '!', code: 'Digit1' })).toBe(0)
    expect(getQuickPasteIndex({ ctrlKey: false, metaKey: false, altKey: false, key: '1', code: 'Digit1' })).toBeNull()
    expect(getQuickPasteIndex({ ctrlKey: true, metaKey: false, altKey: true, key: '1', code: 'Digit1' })).toBeNull()
  })
})

describe('Sidebar badges and image thumbnails', () => {
  it('renders 1..9 quick badges only on the first 9 rows and renders image thumbnail when dataURL available', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
    const items = Array.from({ length: 11 }, (_, idx) =>
      makeItem(idx + 1, idx === 1 ? { type: 'image', content: dataUrl, preview: '图片 800×600' } : {}),
    )

    const markup = renderToStaticMarkup(createElement(Sidebar, {
      items,
      selectedId: 1,
      searchQuery: '',
      onSearchChange: () => {},
      onSelect: () => {},
      onDoubleClick: () => {},
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

    const badges = Array.from(markup.matchAll(/data-quick-index="(\d+)"/g), (m) => m[1])
    expect(badges).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
    expect(markup).toContain(`src="${dataUrl}"`)
  })
})

describe('Clipboard -> Floral Notepaper bridge', () => {
  it('creates new text & image notes and appends to latest note in FloralNotesStore', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qpaste-floral-bridge-'))
    try {
      const store = new FloralNotesStore(tmpDir)

      // 1. New text note
      const first = await saveClipboardToFloralStore(store, {
        mode: 'new',
        type: 'text',
        text: '# 周报要点\n完成了六项新功能',
        preview: '周报要点',
      })
      expect(first.created).toBe(true)
      expect(first.note.title).toBe('周报要点')
      expect(first.note.content).toContain('完成了六项新功能')

      // 2. Append HTML stripped text to latest note
      const appended = await saveClipboardToFloralStore(store, {
        mode: 'append',
        type: 'html',
        text: '<p>补充一条 <strong>重要结论</strong></p>',
      })
      expect(appended.created).toBe(false)
      expect(appended.note.id).toBe(first.note.id)
      expect(appended.note.content).toContain('完成了六项新功能\n\n补充一条 重要结论')

      // 3. New image note persists image into Floral images/<noteId>/
      const pngBytes = parseImageDataUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
      expect(pngBytes).not.toBeNull()
      const imgNote = await saveClipboardToFloralStore(store, {
        mode: 'new',
        type: 'image',
        alias: '报错截图',
        image: pngBytes,
      })
      expect(imgNote.created).toBe(true)
      expect(imgNote.note.title).toBe('报错截图')
      const match = imgNote.note.content.match(/^!\[\]\((images\/[^)]+\.png)\)$/)
      expect(match).not.toBeNull()
      const savedPath = path.join(tmpDir, match![1])
      const stat = await fs.stat(savedPath)
      expect(stat.size).toBeGreaterThan(0)

      // Pure helpers
      expect(appendFloralNoteContent('', 'hello')).toBe('hello')
      expect(buildFloralMarkdownFromClipboard({ type: 'files', files: ['C:\\a.md'] })).toBe('- `C:\\a.md`')
      expect(buildFloralTitleFromClipboard({ type: 'image', now: new Date(2026, 10, 24, 9, 5) })).toBe('剪贴板图片 2026-11-24 09:05')
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})
