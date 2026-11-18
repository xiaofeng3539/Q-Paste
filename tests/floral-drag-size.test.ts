import { describe, expect, it, vi } from 'vitest'
import { installFloralNativeDrag } from '../electron/floral/surface-window'

function harness() {
  const hooks = new Map<number, (w: Buffer, l: Buffer) => void>()
  let move!: () => void
  const edit = vi.fn()
  installFloralNativeDrag({ hookWindowMessage: (id, callback) => hooks.set(id, callback), on: (_, callback) => { move = callback } }, edit)
  function message(id: number, code: number, x = 80, y = 80) {
    const w = Buffer.alloc(8), l = Buffer.alloc(8)
    w.writeUInt32LE(code); l.writeInt16LE(x, 0); l.writeInt16LE(y, 2)
    hooks.get(id)!(w, l)
  }
  return { message, edit, move: () => move() }
}

describe('磁贴原生双击', () => {
  it('兼容原生标题区双击消息', () => {
    const h = harness(); h.message(0x00a3, 2)
    expect(h.edit).toHaveBeenCalledTimes(1)
  })
  it('真实 Chromium 子窗口连续点击可以进入编辑', () => {
    const h = harness()
    h.message(0x0210, 0x0201); h.message(0x0210, 0x0201)
    expect(h.edit).toHaveBeenCalledWith({ x: 80, y: 80 })
    expect(h.edit).toHaveBeenCalledTimes(1)
  })
  it('忽略右键、边框消息与相距过远的点击', () => {
    const h = harness()
    h.message(0x0210, 0x0204); h.message(0x0210, 0x0204)
    h.message(0x00a3, 10)
    h.message(0x0210, 0x0201, 20, 20); h.message(0x0210, 0x0201, 80, 80)
    expect(h.edit).not.toHaveBeenCalled()
  })
  it('拖动以后取消双击候选，避免两次拖动误触编辑', () => {
    const h = harness()
    h.message(0x0210, 0x0201); h.move(); h.message(0x0210, 0x0201)
    expect(h.edit).not.toHaveBeenCalled()
  })
  it('两次点击超过时间间隔不触发', () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      h.message(0x0210, 0x0201); vi.advanceTimersByTime(600); h.message(0x0210, 0x0201)
      expect(h.edit).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
})
