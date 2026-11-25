import type { ClipboardItem } from '../types'

const CONTEXT_MENU_SCRIPT =
  '<script nonce="qpaste-context">document.addEventListener("contextmenu",function(e){e.preventDefault();parent.postMessage({type:"qpaste-html-context-menu",x:e.clientX,y:e.clientY,selection:getSelection()?.toString()||""},"*")})</script>'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 从 Windows CF_HTML / 完整 HTML 文档或片段中提取适合内嵌预览的正文片段，
 * 避免嵌套 <html>/<head>/<body>、CF_HTML 头部或脚本/元标签干扰渲染。
 */
export function extractHtmlPreviewBody(raw: string): string {
  if (!raw) return ''
  let html = raw

  const startFrag = html.match(/<!--\s*StartFragment\s*-->/i)
  const endFrag = html.match(/<!--\s*EndFragment\s*-->/i)
  if (startFrag && startFrag.index !== undefined && endFrag && endFrag.index !== undefined && endFrag.index > startFrag.index) {
    const inner = html.slice(startFrag.index + startFrag[0].length, endFrag.index).trim()
    if (inner) html = inner
  } else {
    const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)
    if (bodyMatch) {
      html = bodyMatch[1]
    }
  }

  return html
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<\/?(?:html|body|meta|base|link|title)\b[^>]*>/gi, '')
    .trim()
}

function hasVisibleHtmlPreview(html: string): boolean {
  if (!html) return false
  if (/<(?:img|svg|canvas|video|audio|hr|table)\b/i.test(html)) return true
  const text = html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 0
}

export interface HtmlPreviewDocOptions {
  dark: boolean
  accent?: string
  fallbackText?: string
}

/**
 * 富文本预览文档：注入主题化基础样式，覆盖源内容自带的颜色/背景（不改原始数据）。
 */
export function buildHtmlPreviewDoc(content: string, options: HtmlPreviewDocOptions): string {
  const accent = options.accent?.trim() || '#4f7dff'
  const t = options.dark
    ? { text: '#e4e9f2', page: '#1a1e26', sub: '#242a35', border: '#343c4c', sel: 'rgba(79,125,255,0.35)' }
    : { text: '#1f2937', page: '#ffffff', sub: '#f3f4f6', border: '#e5e7eb', sel: 'rgba(79,125,255,0.25)' }

  const css = [
    'html,body{margin:0;padding:12px 14px;background:' + t.page + ' !important;color:' + t.text + ' !important;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.65;word-break:break-word;overflow-wrap:anywhere;box-sizing:border-box;}',
    '*,*::before,*::after{background-color:transparent !important;background-image:none !important;color:' + t.text + ' !important;border-color:' + t.border + ' !important;box-sizing:border-box;}',
    'a,a *{color:' + accent + ' !important;text-decoration-color:' + accent + ' !important;}',
    'pre,code,kbd,samp,blockquote{background:' + t.sub + ' !important;color:' + t.text + ' !important;border-color:' + t.border + ' !important;}',
    'pre{padding:10px 12px;border-radius:6px;overflow-x:auto;white-space:pre-wrap;}',
    'code{padding:1px 4px;border-radius:4px;}',
    'pre code{padding:0;}',
    'p,ul,ol,pre,blockquote,table,h1,h2,h3,h4,h5,h6{margin-top:0;margin-bottom:0.65em;}',
    'p:last-child,ul:last-child,ol:last-child,pre:last-child,blockquote:last-child,table:last-child{margin-bottom:0;}',
    'table{border-collapse:collapse;max-width:100%;}',
    'table,th,td{border-color:' + t.border + ' !important;}',
    'th,td{padding:4px 8px;}',
    'hr{border:none;border-top:1px solid ' + t.border + ' !important;background:none !important;height:1px;}',
    'img,svg,video,canvas{background:none !important;max-width:100%;height:auto;}',
    '::selection{background:' + t.sel + ' !important;color:' + t.text + ' !important;}',
  ].join('\n')

  const extracted = extractHtmlPreviewBody(content)
  const bodyHtml = hasVisibleHtmlPreview(extracted)
    ? extracted
    : (options.fallbackText?.trim()
      ? '<div style="white-space:pre-wrap;">' + escapeHtml(options.fallbackText.trim()) + '</div>'
      : '')

  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data: file:; script-src \'nonce-qpaste-context\'">' +
    '<style>' + css + '</style></head><body>' +
    bodyHtml +
    CONTEXT_MENU_SCRIPT +
    '</body></html>'
  )
}

/**
 * 列表摘要阶段（content_loaded === false）先不挂载 sandbox iframe，
 * 避免在初始空 srcDoc 导航尚未提交时立刻改写 srcDoc 触发 Chromium/Electron 45 的 0×0 空白布局竞态。
 */
export function isHtmlPreviewReady(item: Pick<ClipboardItem, 'content_loaded'>): boolean {
  return item.content_loaded !== false
}

function hashFnv1a(value: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * 为每次富文本预览文档生成唯一 iframe key，强制重新挂载全新 <iframe>，
 * 彻底规避 Electron/Chromium 复用同一 sandbox iframe 改写 srcDoc 导致的空白渲染问题。
 */
export function getHtmlPreviewFrameKey(itemId: number, dark: boolean, srcDoc: string): string {
  return `html-${itemId}-${dark ? 'd' : 'l'}-${srcDoc.length}-${hashFnv1a(srcDoc)}`
}
