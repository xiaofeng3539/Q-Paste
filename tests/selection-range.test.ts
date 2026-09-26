import { describe, expect, test } from 'vitest'
import { selectRangeIds } from '../src/lib/selection-range'

describe('Q-Paste 范围选择', () => {
  const visibleIds = [11, 22, 33, 44]

  test('从第一条 Shift 单击第三条时包含中间条目', () => {
    expect([...selectRangeIds(visibleIds, 11, 33, new Set(), false)]).toEqual([11, 22, 33])
  })

  test('从第三条向上 Shift 单击第一条时包含中间条目', () => {
    expect([...selectRangeIds(visibleIds, 33, 11, new Set(), false)]).toEqual([11, 22, 33])
  })

  test('只按当前筛选后的可见顺序连选', () => {
    expect([...selectRangeIds([11, 33, 44], 11, 44, new Set(), false)]).toEqual([11, 33, 44])
  })

  test('Ctrl+Shift 将连续范围加入已有选择', () => {
    expect([...selectRangeIds(visibleIds, 11, 33, new Set([44]), true)]).toEqual([44, 11, 22, 33])
  })
})
