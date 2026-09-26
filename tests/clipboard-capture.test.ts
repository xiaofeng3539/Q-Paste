import { describe, expect, it } from 'vitest'
import { persistClipboardCapture } from '../src/main/clipboard-capture'

describe('剪贴板后台捕获', () => {
  it('没有 Q-Paste 页面监听时仍先入库，再通知页面', () => {
    const stored: string[] = []
    const announced: number[] = []
    const result = persistClipboardCapture(
      { type: 'text', content: 'hello', preview: 'hello', charCount: 5, storageSize: 5, createdAt: '2026-09-25 12:00:00' },
      (item) => { stored.push(item.content); return { id: 7, updated: false } },
      (item) => announced.push(item.id),
    )
    expect(stored).toEqual(['hello'])
    expect(announced).toEqual([7])
    expect(result?.id).toBe(7)
  })

  it('HTML 捕获仍标记敏感内容', () => {
    let sensitive = false
    persistClipboardCapture(
      { type: 'html', content: '<p>api_key=abcdefghijklmnop</p>', preview: 'key', charCount: 24, storageSize: 32, createdAt: '2026-09-25 12:00:00' },
      (item) => { sensitive = item.isSensitive; return { id: 8, updated: false } },
      () => {},
    )
    expect(sensitive).toBe(true)
  })

  it('入库失败时不发送不存在的记录', () => {
    let announced = false
    const result = persistClipboardCapture(
      { type: 'text', content: 'hello', preview: 'hello', charCount: 5, storageSize: 5, createdAt: '2026-09-25 12:00:00' },
      () => null,
      () => { announced = true },
    )
    expect(result).toBeNull()
    expect(announced).toBe(false)
  })
})
