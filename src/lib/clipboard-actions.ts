import type { ItemType } from '../types'
import { parseFilePaths } from './utils'

/**
 * 将剪贴板条目转为干净的纯文本（去除富文本 HTML 标签与样式，保留合理换行）。
 */
export function toPlainText(type: ItemType, content: string): string {
  if (!content) return ''
  if (type === 'files') {
    return parseFilePaths(content).join('\n')
  }
  if (type !== 'html') {
    return content
  }
  return content
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 识别数字键快速粘贴快捷键：支持 Ctrl/Cmd + 1..9 与 Alt + 1..9（含配合 Shift 去格式粘贴）。
 * 返回 0..8 的列表索引；未命中返回 null。
 */
export function getQuickPasteIndex(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'key' | 'code'>,
): number | null {
  const hasPrimary = event.ctrlKey || event.metaKey
  const hasAlt = event.altKey
  // 只允许单一修饰族（Ctrl/Cmd 或 Alt），避免与 Ctrl+Alt 冲突
  if (hasPrimary === hasAlt) return null

  const digitFromKey = /^[1-9]$/.test(event.key) ? Number(event.key) : 0
  if (digitFromKey >= 1 && digitFromKey <= 9) return digitFromKey - 1

  const codeMatch = /^Digit([1-9])$/.exec(event.code || '')
  if (codeMatch) return Number(codeMatch[1]) - 1

  return null
}

export type MergeSeparatorPreset = 'newline' | 'blankLine' | 'comma' | 'dunhao' | 'space' | 'custom'

export const MERGE_SEPARATOR_PRESETS: Array<{ id: Exclude<MergeSeparatorPreset, 'custom'>; labelKey: string; value: string }> = [
  { id: 'newline', labelKey: 'batch.sepNewline', value: '\n' },
  { id: 'blankLine', labelKey: 'batch.sepBlankLine', value: '\n\n' },
  { id: 'comma', labelKey: 'batch.sepComma', value: ', ' },
  { id: 'dunhao', labelKey: 'batch.sepDunhao', value: '、' },
  { id: 'space', labelKey: 'batch.sepSpace', value: ' ' },
]

export function resolveMergeSeparator(preset: MergeSeparatorPreset, customValue = ''): string {
  if (preset === 'custom') {
    return customValue.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
  }
  return MERGE_SEPARATOR_PRESETS.find((item) => item.id === preset)?.value ?? '\n'
}

/**
 * 将多条剪贴板内容合并为一段纯文本，自动过滤图片与空白条目。
 */
export function mergeClipboardTexts(
  entries: Array<{ type: ItemType; content: string }>,
  separator: string,
): { merged: string; count: number } {
  const parts: string[] = []
  for (const entry of entries) {
    if (entry.type === 'image') continue
    const text = toPlainText(entry.type, entry.content).trim()
    if (text) parts.push(text)
  }
  return {
    merged: parts.join(separator),
    count: parts.length,
  }
}
