const TOP_SENSING_RANGE_PX = 40
const BOTTOM_SENSING_RANGE_PX = 40
const MIN_SCROLL_STEP_PX = 2
const MAX_SCROLL_STEP_PX = 8

/**
 * 返回每帧应滚动的像素数。列表内的上下感应区及其外侧都可触发，
 * 指针离可视区越远，滚动越快。
 */
export function getAutoScrollDelta(pointerY: number, listTop: number, listBottom: number): number {
  const topDistance = listTop + TOP_SENSING_RANGE_PX - pointerY
  if (topDistance > 0) {
    const ratio = Math.min(1, topDistance / TOP_SENSING_RANGE_PX)
    return -Math.ceil(MIN_SCROLL_STEP_PX + (MAX_SCROLL_STEP_PX - MIN_SCROLL_STEP_PX) * ratio)
  }

  const bottomDistance = pointerY - (listBottom - BOTTOM_SENSING_RANGE_PX)
  if (bottomDistance > 0) {
    const ratio = Math.min(1, bottomDistance / BOTTOM_SENSING_RANGE_PX)
    return Math.ceil(MIN_SCROLL_STEP_PX + (MAX_SCROLL_STEP_PX - MIN_SCROLL_STEP_PX) * ratio)
  }

  return 0
}
