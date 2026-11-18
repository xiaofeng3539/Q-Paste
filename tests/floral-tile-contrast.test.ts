import { describe, expect, it } from 'vitest'
import { getTileTextColor } from '../vendor/floral-notepaper/src/features/settings/tileColor'

function luminance(hex: string): number {
  const rgb = hex.slice(1).match(/../g)!.map((v) => parseInt(v, 16) / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
}

describe('磁贴文字可读性', () => {
  it.each(['#421bac', '#191919', '#f6f3ec', '#f7e7a8', '#808080', '#ffffff', '#000000'])(
    '%s 背景上正文、标题与空提示使用至少 4.5:1 的实色文字', (background) => {
      const a = luminance(background), b = luminance(getTileTextColor(background))
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5)
    },
  )
})
