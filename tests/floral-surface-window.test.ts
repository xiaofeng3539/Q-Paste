import { describe, expect, it } from 'vitest'
import { findFloralSurfaceWindow } from '../electron/floral/surface-window'

describe('Floral 子窗口查找', () => {
  it('按 IPC 发送者找到对应窗口，而不是依赖窗口标签', () => {
    const sender = {}
    const unrelatedSender = {}
    const expected = { webContents: sender, isDestroyed: () => false }
    const unrelated = { webContents: unrelatedSender, isDestroyed: () => false }

    expect(findFloralSurfaceWindow(new Map([['notepad:new', expected], ['tile:1', unrelated]]).values(), sender)).toBe(expected)
  })
})
