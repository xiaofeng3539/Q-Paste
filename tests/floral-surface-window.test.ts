import { describe, expect, it } from 'vitest'
import { findFloralSurfaceWindow, registerFloralSurfaceMode } from '../electron/floral/surface-window'

describe('Floral 子窗口查找', () => {
  it('按 IPC 发送者找到对应窗口，而不是依赖窗口标签', () => {
    const sender = {}
    const unrelatedSender = {}
    const expected = { webContents: sender, isDestroyed: () => false }
    const unrelated = { webContents: unrelatedSender, isDestroyed: () => false }

    expect(findFloralSurfaceWindow(new Map([['notepad:new', expected], ['tile:1', unrelated]]).values(), sender)).toBe(expected)
  })

  it('固定新便笺后释放新建槽位，下一次 Alt+N 不得复用并清空磁贴', () => {
    const sender = {}
    const window = { webContents: sender, isDestroyed: () => false }
    const windows = new Map([['notepad:new', window]])
    registerFloralSurfaceMode(windows, sender, 'tile', 'note-1')
    expect(windows.has('notepad:new')).toBe(false)
    expect(windows.get('tile:note-1')).toBe(window)
    registerFloralSurfaceMode(windows, sender, 'pad', 'note-1')
    expect(windows.get('notepad:note-1')).toBe(window)
    expect(windows.has('tile:note-1')).toBe(false)
  })

  it('未保存的磁贴拒绝注册，不丢失原窗口', () => {
    const sender = {}
    const window = { webContents: sender, isDestroyed: () => false }
    const windows = new Map([['notepad:new', window]])
    expect(() => registerFloralSurfaceMode(windows, sender, 'tile', '')).toThrow()
    expect(windows.get('notepad:new')).toBe(window)
  })
})
