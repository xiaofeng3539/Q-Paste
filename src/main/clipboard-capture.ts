import { detectSensitive, stripHtml } from '../lib/utils'

export interface ClipboardCapture {
  type: string
  content: string
  preview: string
  charCount: number
  storageSize: number
  createdAt: string
}

export interface StoredClipboardCapture extends ClipboardCapture {
  id: number
  updated: boolean
  isSensitive: boolean
  fromCapture: true
}

export function persistClipboardCapture(
  capture: ClipboardCapture,
  save: (item: ClipboardCapture & { isSensitive: boolean }) => { id: number | null; updated: boolean } | null,
  notify: (item: StoredClipboardCapture) => void,
): { id: number; updated: boolean } | null {
  const contentForCheck = capture.type === 'html' ? stripHtml(capture.content) : capture.content
  const isSensitive = ['text', 'url', 'html'].includes(capture.type) && detectSensitive(contentForCheck)
  const result = save({ ...capture, isSensitive })
  if (!result || result.id === null) return null
  notify({ ...capture, ...result, id: result.id, isSensitive, fromCapture: true })
  return { id: result.id, updated: result.updated }
}
