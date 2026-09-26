export function selectRangeIds(
  visibleIds: number[],
  anchorId: number | null,
  targetId: number,
  selectedIds: ReadonlySet<number>,
  additive: boolean,
): Set<number> {
  const targetIndex = visibleIds.indexOf(targetId)
  const anchorIndex = anchorId === null ? -1 : visibleIds.indexOf(anchorId)
  const result = additive ? new Set(selectedIds) : new Set<number>()
  if (targetIndex < 0) return result
  const start = anchorIndex < 0 ? targetIndex : Math.min(anchorIndex, targetIndex)
  const end = anchorIndex < 0 ? targetIndex : Math.max(anchorIndex, targetIndex)
  for (let index = start; index <= end; index += 1) result.add(visibleIds[index])
  return result
}
