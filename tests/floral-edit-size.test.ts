import { describe, expect, it } from 'vitest'
import { getSurfaceTargetBounds } from '../vendor/floral-notepaper/src/features/windows/surfaceMode'

describe('磁贴双击进入编辑的尺寸', () => {
  it('保留已经自适应展开的大磁贴宽高与位置', () => {
    const current = { x: 20, y: 16, width: 560, height: 900 }
    expect(getSurfaceTargetBounds('pad', current)).toEqual(current)
  })
  it('仅扩展太小的维度，不缩小另一维度', () => {
    expect(getSurfaceTargetBounds('pad', { x: 20, y: 16, width: 560, height: 96 }))
      .toEqual({ x: 20, y: 16, width: 560, height: 440 })
    expect(getSurfaceTargetBounds('pad', { x: 20, y: 16, width: 240, height: 900 }))
      .toEqual({ x: 20, y: 16, width: 360, height: 900 })
  })
  it('转为磁贴时仍将自适应大小交给正文测量', () => {
    const current = { x: 20, y: 16, width: 500, height: 600 }
    expect(getSurfaceTargetBounds('tile', current)).toEqual(current)
  })
})
