/**
 * 若当前选中的标签或来源筛选已不再存在于现有条目中（例如删除了该标签/来源下的全部条目或移除了标签），
 * 自动回退为 null（全部），避免筛选栏消失后界面永久卡在“无匹配结果”。
 */
export function reconcileActiveFilter(selected: string | null, available: readonly string[]): string | null {
  if (!selected) return null
  return available.includes(selected) ? selected : null
}
