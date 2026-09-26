import { describe, expect, it } from 'vitest'
import { getAutoScrollDelta } from '../src/lib/drag-auto-scroll'

describe('拖拽自动滚动', () => {
  it('指针在列表上方的感应区外仍向上滚动', () => {
    expect(getAutoScrollDelta(60, 100, 500)).toBeLessThan(0)
  })

  it('上下自动滚动仅在边缘 40px 内启动', () => {
    expect(getAutoScrollDelta(139, 100, 800)).toBeLessThan(0)
    expect(getAutoScrollDelta(140, 100, 800)).toBe(0)
    expect(getAutoScrollDelta(760, 100, 800)).toBe(0)
    expect(getAutoScrollDelta(761, 100, 800)).toBeGreaterThan(0)
  })

  it('向上持续拖动时每帧最多滚动 8px，靠近边界时更慢', () => {
    expect(getAutoScrollDelta(40, 100, 800)).toBe(-8)
    expect(getAutoScrollDelta(139, 100, 800)).toBe(-3)
  })

  it('指针在列表下方的感应区外仍向下滚动', () => {
    expect(getAutoScrollDelta(540, 100, 500)).toBeGreaterThan(0)
  })

  it('指针在列表中间时停止自动滚动', () => {
    expect(getAutoScrollDelta(500, 100, 800)).toBe(0)
  })
})
