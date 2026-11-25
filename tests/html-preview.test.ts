import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DetailView from '../src/components/DetailView'
import {
  buildHtmlPreviewDoc,
  extractHtmlPreviewBody,
  getHtmlPreviewFrameKey,
  isHtmlPreviewReady,
} from '../src/lib/html-preview'
import type { ClipboardItem } from '../src/types'

const baseShortcuts = {
  copy: 'Ctrl+C',
  paste: 'Enter',
  pin: 'Ctrl+P',
  delete: 'Del',
  search: 'Ctrl+F',
  toggle: 'Alt+V',
} as any

function makeHtmlItem(overrides: Partial<ClipboardItem> = {}): ClipboardItem {
  return {
    id: 4978,
    type: 'html',
    content: '<b>日常写代码</b><span>：首选 Gemini</span>',
    content_loaded: true,
    preview: '日常写代码：首选 Gemini',
    char_count: 14,
    storage_size: 80,
    created_at: '2026-11-24 21:55:00',
    is_pinned: false,
    alias: '',
    tags: [],
    is_sensitive: false,
    ocr_text: '',
    source_app: 'ego',
    ...overrides,
  }
}

describe('html preview helpers and DetailView regression', () => {
  it('gates iframe mount until content_loaded is not false', () => {
    expect(isHtmlPreviewReady({ content_loaded: false })).toBe(false)
    expect(isHtmlPreviewReady({ content_loaded: true })).toBe(true)
    expect(isHtmlPreviewReady({ content_loaded: undefined })).toBe(true)
  })

  it('produces distinct remount keys across item, theme, and content changes', () => {
    const docA = buildHtmlPreviewDoc('<b>A</b>', { dark: true })
    const docB = buildHtmlPreviewDoc('<b>B</b>', { dark: true })
    const docLight = buildHtmlPreviewDoc('<b>A</b>', { dark: false })

    const k1 = getHtmlPreviewFrameKey(1, true, docA)
    const k2 = getHtmlPreviewFrameKey(2, true, docA)
    const k3 = getHtmlPreviewFrameKey(1, true, docB)
    const k4 = getHtmlPreviewFrameKey(1, false, docLight)

    expect(new Set([k1, k2, k3, k4]).size).toBe(4)
  })

  it('extracts Windows CF_HTML fragments and strips outer document & script tags', () => {
    const cfHtml = [
      'Version:0.9',
      'StartHTML:00000097',
      'EndHTML:00000210',
      '<html><head><meta charset="utf-8"><script>alert(1)</script></head><body>',
      '<!--StartFragment--><b>Hello</b><span> World</span><!--EndFragment-->',
      '</body></html>',
    ].join('\n')
    expect(extractHtmlPreviewBody(cfHtml)).toBe('<b>Hello</b><span> World</span>')

    const fullDoc = '<!DOCTYPE html><html><head><title>Doc</title></head><body><h1>标题</h1><script>evil()</script><p>正文</p></body></html>'
    expect(extractHtmlPreviewBody(fullDoc)).toBe('<h1>标题</h1><p>正文</p>')
  })

  it('builds themed preview doc with CSP, context menu hook, and safe fallback text', () => {
    const darkDoc = buildHtmlPreviewDoc('<b>测试</b>', { dark: true, accent: '#3b82f6' })
    expect(darkDoc).toContain('#1a1e26')
    expect(darkDoc).toContain('#3b82f6')
    expect(darkDoc).toContain('Content-Security-Policy')
    expect(darkDoc).toContain('qpaste-html-context-menu')
    expect(darkDoc).toContain('<b>测试</b>')

    const lightDoc = buildHtmlPreviewDoc('', { dark: false, fallbackText: '<fallback & text>' })
    expect(lightDoc).toContain('#ffffff')
    expect(lightDoc).toContain('&lt;fallback &amp; text&gt;')
  })

  it('does not mount sandbox iframe while HTML content is still loading, and mounts once loaded', () => {
    const noop = () => {}
    const baseProps = {
      onCopy: noop,
      onDelete: noop,
      onUpdate: noop,
      onTogglePin: noop,
      onUpdateAlias: noop,
      onUpdateTags: noop,
      onToggleSensitive: noop,
      onOpenUrl: noop,
      onOpenFile: noop,
      confirmingDelete: false,
      shortcuts: baseShortcuts,
      monospace: false,
    }

    const loadingHtml = renderToStaticMarkup(
      createElement(DetailView, {
        ...baseProps,
        item: makeHtmlItem({ content: '', content_loaded: false }),
      }),
    )
    expect(loadingHtml).toContain('data-testid="html-preview-loading"')
    expect(loadingHtml).not.toContain('title="rich-text-preview"')

    const loadedHtml = renderToStaticMarkup(
      createElement(DetailView, {
        ...baseProps,
        item: makeHtmlItem({ content: '<b>日常写代码</b>', content_loaded: true }),
      }),
    )
    expect(loadedHtml).toContain('title="rich-text-preview"')
    expect(loadedHtml).toContain('sandbox="allow-scripts"')
    expect(loadedHtml).toContain('日常写代码')
  })
})
