import { htmlToText } from '../../src/main/history-write'
import type { FloralNote, FloralNotesStore } from './notes-store'

export interface ParsedImageData {
  bytes: Uint8Array
  ext: string
}

export function parseImageDataUrl(dataUrl: string): ParsedImageData | null {
  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,([\s\S]+)$/)
  if (!match) return null
  const rawExt = match[1].toLowerCase()
  const ext = rawExt === 'jpeg' ? 'jpg' : rawExt === 'svg+xml' ? 'svg' : rawExt
  if (!['png', 'jpg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return null
  const bytes = new Uint8Array(Buffer.from(match[2], 'base64'))
  if (!bytes.byteLength) return null
  return { bytes, ext }
}

function formatShortStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function buildFloralTitleFromClipboard(input: {
  type: string
  alias?: string
  preview?: string
  text?: string
  now?: Date
}): string {
  const alias = (input.alias ?? '').trim()
  if (alias) return alias.slice(0, 48)
  const now = input.now ?? new Date()
  if (input.type === 'image') {
    return `剪贴板图片 ${formatShortStamp(now)}`
  }
  if (input.type === 'files') {
    return `剪贴板文件 ${formatShortStamp(now)}`
  }
  const source = (input.text || input.preview || '').trim()
  const firstLine = source
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean)
  if (firstLine) {
    return firstLine.length > 36 ? `${firstLine.slice(0, 36)}…` : firstLine
  }
  return `剪贴板摘录 ${formatShortStamp(now)}`
}

export function buildFloralMarkdownFromClipboard(input: {
  type: string
  text?: string
  imageRelPath?: string
  files?: string[]
}): string {
  if (input.type === 'image') {
    return input.imageRelPath ? `![](${input.imageRelPath})` : ''
  }
  if (input.type === 'files') {
    const files = (input.files ?? []).filter(Boolean)
    return files.map((file) => `- \`${file}\``).join('\n')
  }
  if (input.type === 'html') {
    return htmlToText(input.text ?? '')
  }
  return (input.text ?? '').trim()
}

export function appendFloralNoteContent(existing: string, addition: string): string {
  const cleanAddition = addition.trim()
  if (!cleanAddition) return existing
  const cleanExisting = existing.replace(/\s+$/, '')
  if (!cleanExisting) return cleanAddition
  return `${cleanExisting}\n\n${cleanAddition}`
}

export interface SaveClipboardToFloralPayload {
  mode: 'new' | 'append'
  type: string
  title?: string
  alias?: string
  preview?: string
  text?: string
  files?: string[]
  image?: ParsedImageData | null
}

export interface SaveClipboardToFloralResult {
  note: FloralNote
  created: boolean
}

export async function saveClipboardToFloralStore(
  store: FloralNotesStore,
  payload: SaveClipboardToFloralPayload,
): Promise<SaveClipboardToFloralResult> {
  if (payload.mode === 'append') {
    const notes = await store.listNotes()
    if (notes.length > 0) {
      const latest = await store.getNote(notes[0].id)
      let imageRelPath: string | undefined
      if (payload.type === 'image' && payload.image) {
        imageRelPath = await store.saveImage(latest.id, payload.image.bytes, payload.image.ext)
      }
      const addition = buildFloralMarkdownFromClipboard({
        type: payload.type,
        text: payload.text,
        imageRelPath,
        files: payload.files,
      })
      if (!addition) throw new Error('无可转存的内容')
      const updated = await store.updateNote(latest.id, {
        title: latest.title,
        content: appendFloralNoteContent(latest.content, addition),
      })
      return { note: updated, created: false }
    }
  }

  const title = (payload.title ?? '').trim() || buildFloralTitleFromClipboard({
    type: payload.type,
    alias: payload.alias,
    preview: payload.preview,
    text: payload.type === 'html' ? htmlToText(payload.text ?? '') : payload.text,
  })

  if (payload.type === 'image') {
    if (!payload.image) throw new Error('无法读取图片数据')
    const created = await store.createNote({ title, content: '', category: '' })
    const imageRelPath = await store.saveImage(created.id, payload.image.bytes, payload.image.ext)
    const content = buildFloralMarkdownFromClipboard({ type: 'image', imageRelPath })
    const updated = await store.updateNote(created.id, { title: created.title, content })
    return { note: updated, created: true }
  }

  const content = buildFloralMarkdownFromClipboard({
    type: payload.type,
    text: payload.text,
    files: payload.files,
  })
  if (!content) throw new Error('无可转存的内容')
  const created = await store.createNote({ title, content, category: '' })
  return { note: created, created: true }
}
