import { describe, expect, it } from 'vitest'
import { fitFloralTileBounds } from '../electron/floral/surface-window'
import { preferredTileWidth } from '../vendor/floral-notepaper/src/features/windows/tileAutoSize'

describe('磁贴自适应尺寸', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  it('短内容紧凑，长链接适度加宽，宽度不无限增长', () => {
    expect(preferredTileWidth(50, 1920)).toBe(240)
    expect(preferredTileWidth(380, 1920)).toBeGreaterThan(400)
    expect(preferredTileWidth(10000, 1920)).toBe(560)
  })
  it('高度按正文变化，而不是统一正方形', () => {
    const current = { x: 100, y: 100, width: 220, height: 220 }
    expect(fitFloralTileBounds(current, { width: 240, height: 75 }, area).height).toBe(96)
    expect(fitFloralTileBounds(current, { width: 400, height: 650 }, area).height).toBe(650)
  })
  it('超长正文限制在屏幕内并为滚动预留空间', () => {
    const result = fitFloralTileBounds({ x: 1800, y: 950, width: 220, height: 220 }, { width: 560, height: 10000 }, area)
    expect(result.width).toBe(560)
    expect(result.height).toBeLessThanOrEqual(area.height - 32)
    expect(result.x + result.width).toBeLessThanOrEqual(area.width - 16)
    expect(result.y + result.height).toBeLessThanOrEqual(area.height - 16)
  })
  it('支持负坐标副屏和狭小工作区', () => {
    const small = { x: -300, y: -200, width: 200, height: 160 }
    const result = fitFloralTileBounds({ x: -120, y: -50, width: 220, height: 220 }, { width: 560, height: 900 }, small)
    expect(result.x).toBeGreaterThanOrEqual(small.x)
    expect(result.y).toBeGreaterThanOrEqual(small.y)
    expect(result.x + result.width).toBeLessThanOrEqual(small.x + small.width)
    expect(result.y + result.height).toBeLessThanOrEqual(small.y + small.height)
    expect(preferredTileWidth(10000, small.width)).toBeLessThanOrEqual(small.width - 32)
  })
})
