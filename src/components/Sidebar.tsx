import { useEffect, useMemo, useRef, useState } from 'react'
import Sortable from 'sortablejs'
import { ClipboardItem, ItemType } from '../types'
import { cn, formatGroupLabel, formatRelativeTime } from '../lib/utils'
import { highlightSegments } from '../lib/search'
import { FileText, Link, Image, Search, X, Clock, Star, Pin, FileCode2, FolderOpen } from 'lucide-react'
import { tr } from '../i18n'

type ActiveTab = 'history' | 'vault'

export const TYPE_FILTERS: { value: ItemType | 'all'; label: string }[] = [
  { value: 'all', label: 'detail.typeAll' },
  { value: 'text', label: 'detail.typeText' },
  { value: 'url', label: 'detail.typeUrl' },
  { value: 'image', label: 'detail.typeImage' },
  { value: 'html', label: 'detail.typeHtml' },
  { value: 'files', label: 'detail.typeFiles' },
]

interface SidebarProps {
  items: ClipboardItem[]
  selectedId: number | null
  searchQuery: string
  onSearchChange: (query: string) => void
  onSelect: (id: number) => void
  density: 'comfortable' | 'compact'
  activeTab: ActiveTab
  onTabChange: (tab: ActiveTab) => void
  allTags: string[]
  selectedTag: string | null
  onTagChange: (tag: string | null) => void
  onReorder: (ordered: ClipboardItem[]) => void
  onVaultReorder: (ordered: ClipboardItem[]) => void
  typeFilter: ItemType | 'all'
  onTypeFilterChange: (t: ItemType | 'all') => void
  selectedIds?: ReadonlySet<number>
  onToggleSelect?: (id: number) => void
  onSelectAll?: () => void
  onClearSelection?: () => void
  onBatchCopy?: () => void
  onBatchPin?: () => void
  onBatchDelete?: () => void
  onBatchAddTag?: (tag: string) => void
}

function typeIcon(type: string) {
  const cls = 'w-4 h-4 flex-shrink-0'
  switch (type) {
    case 'url':
      return <Link className={cn(cls, 'text-blue-500 dark:text-blue-400')} />
    case 'image':
      return <Image className={cn(cls, 'text-green-500 dark:text-green-400')} />
    case 'html':
      return <FileCode2 className={cn(cls, 'text-purple-500 dark:text-purple-400')} />
    case 'files':
      return <FolderOpen className={cn(cls, 'text-amber-500 dark:text-amber-400')} />
    default:
      return <FileText className={cn(cls, 'text-zinc-400')} />
  }
}

function groupedItems(items: ClipboardItem[]) {
  const groups: { label: string; items: ClipboardItem[] }[] = []
  let currentLabel = ''

  for (const item of items) {
    const label = formatGroupLabel(item.created_at)
    if (label !== currentLabel) {
      currentLabel = label
      groups.push({ label, items: [item] })
    } else {
      groups[groups.length - 1].items.push(item)
    }
  }
  return groups
}

/** 金库视图：按标签分组排序 */
function groupedByTag(items: ClipboardItem[]) {
  const groups: { label: string; items: ClipboardItem[] }[] = []
  const tagOrder = new Map<string, number>()

  for (const item of items) {
    const tag = item.tags.length > 0 ? item.tags[0] : tr('sidebar.earlier')
    if (!tagOrder.has(tag)) {
      tagOrder.set(tag, groups.length)
      groups.push({ label: tag, items: [item] })
    } else {
      groups[tagOrder.get(tag)!].items.push(item)
    }
  }
  return groups
}

export default function Sidebar({
  items,
  selectedId,
  searchQuery,
  onSearchChange,
  onSelect,
  density,
  activeTab,
  onTabChange,
  allTags,
  selectedTag,
  onTagChange,
  onReorder,
  onVaultReorder,
  typeFilter,
  onTypeFilterChange,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onBatchCopy,
  onBatchPin,
  onBatchDelete,
  onBatchAddTag,
}: SidebarProps) {
  const groups = activeTab === 'vault' ? groupedByTag(items) : groupedItems(items)
  // 分组拍平为 [表头, 条目...] 交错序列（普通 DOM 渲染，替代虚拟滚动以支持整表拖拽）
  const flatRows = useMemo(
    () =>
      groups.flatMap((group) => [
        { kind: 'header' as const, id: `h_${group.label}`, label: group.label },
        ...group.items.map((item) => ({ kind: 'item' as const, id: `i_${item.id}`, item })),
      ]),
    [groups],
  )
  const itemPy = `py-1.5 transition-all ${density === 'compact' ? 'py-0.5' : 'py-3'}`
  const isVault = activeTab === 'vault'
  const [batchTagDraft, setBatchTagDraft] = useState('')
  // 拖拽仅在未搜索、未标签过滤时启用（此时 items 即完整列表，可安全重排），历史/金库 tab 均可拖
  const draggable = !searchQuery.trim() && selectedTag === null

  // ── SortableJS：历史列表整表拖拽排序 ──
  const listRef = useRef<HTMLDivElement | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    if (!draggable || !listRef.current) return
    const sortable = new Sortable(listRef.current, {
      draggable: '.js-item',
      animation: 150,
      ghostClass: 'qp-drag-ghost',
      chosenClass: 'qp-drag-chosen',
      dragClass: 'qp-drag-original',
      onEnd: () => {
        const container = listRef.current
        if (!container) return
        // 依据 DOM 中条目按钮的实际顺序重组数组（顶部→底部）
        const nodes = container.querySelectorAll<HTMLElement>('.js-item[data-id]')
        const byId = new Map(itemsRef.current.map((it) => [it.id, it]))
        const ordered: ClipboardItem[] = []
        for (const node of nodes) {
          const it = byId.get(Number(node.dataset.id))
          if (it) ordered.push(it)
        }
        if (ordered.length > 0) (isVault ? onVaultReorder : onReorder)(ordered)
      },
    })
    return () => sortable.destroy()
  }, [draggable, onReorder, onVaultReorder, isVault])

  // ── 键盘导航跟随滚动 ──
  // W/S 切换选中项时，若目标条目已滑出列表可视区域，就把列表滚到刚好能完整显示它的位置。
  // 已在视野内的条目不做任何滚动，避免连续按 W/S 时列表来回抖动。
  useEffect(() => {
    if (selectedId === null) return
    const container = listRef.current
    if (!container || container.clientHeight === 0) return
    const node = container.querySelector<HTMLElement>(`.js-item[data-id="${selectedId}"]`)
    if (!node) return

    // 用相对滚动容器的几何位置计算，不依赖 offsetParent（容器本身不是定位元素）
    const cRect = container.getBoundingClientRect()
    const nRect = node.getBoundingClientRect()
    const viewTop = container.scrollTop
    const viewBottom = viewTop + container.clientHeight
    const itemTop = nRect.top - cRect.top + viewTop
    const itemBottom = itemTop + nRect.height
    const margin = 8 // 上下各留 8px 呼吸空间，避免选中项紧贴列表边缘

    // 完整落在视野内 → 保持不动
    if (itemTop >= viewTop + margin && itemBottom <= viewBottom - margin) return

    container.scrollTop =
      itemTop < viewTop + margin
        ? Math.max(0, itemTop - margin)
        : itemBottom - container.clientHeight + margin
  }, [selectedId, activeTab])

  return (
    <div className="h-full flex flex-col bg-[#FAFBFC] dark:bg-zinc-900 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/50 shadow-sm overflow-hidden select-none">
      {/* Tab bar */}
      <div className="flex-shrink-0 px-3 pt-5 pb-1">
        <div className="flex rounded-md bg-zinc-100 dark:bg-zinc-900 p-0.5">
          <button
            onClick={() => onTabChange('history')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 h-7 rounded text-xs transition-colors',
              activeTab === 'history'
                ? 'bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 shadow-sm'
                : 'text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300',
            )}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{tr('sidebar.tabHistory')}</span>
          </button>
          <button
            onClick={() => onTabChange('vault')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 h-7 rounded text-xs transition-colors',
              activeTab === 'vault'
                ? 'bg-white dark:bg-zinc-800 text-amber-600 dark:text-amber-400 shadow-sm'
                : 'text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300',
            )}
          >
            <Star className="w-3.5 h-3.5" />
            <span>{tr('sidebar.tabVault')}</span>
          </button>
        </div>
      </div>

      {/* Search bar — 历史与金库视图均显示 */}
      <div className="flex-shrink-0 px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
          <input
            type="text"
            placeholder={tr('sidebar.search')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full h-7 pl-7 pr-6 bg-zinc-100 dark:bg-zinc-900 border border-transparent rounded-md text-xs text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 dark:placeholder-zinc-600 outline-none focus:border-zinc-300 dark:focus:border-zinc-700 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-400"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Type filter chips */}
      <div className="qp-type-filter-scroll flex-shrink-0 px-3 pb-2 flex items-center gap-1 overflow-x-auto">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => onTypeFilterChange(typeFilter === f.value ? 'all' : f.value)}
            className={cn(
              'flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] border transition-colors',
              typeFilter === f.value
                ? 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/40'
                : 'bg-zinc-100 dark:bg-zinc-800/60 text-zinc-400 dark:text-zinc-500 border-transparent hover:text-zinc-600 dark:hover:text-zinc-300'
            )}
          >
            {tr(f.label)}
          </button>
        ))}
      </div>

      {/* Tag filter chips */}
      {allTags.length > 0 && (
        <div className="flex-shrink-0 px-3 pb-2 flex items-center gap-1 overflow-x-auto">
          <button
            onClick={() => onTagChange(null)}
            className={cn(
              'flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] border transition-colors',
              selectedTag === null
                ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border-zinc-300 dark:border-zinc-600'
                : 'bg-zinc-100 dark:bg-zinc-800/60 text-zinc-400 dark:text-zinc-500 border-transparent hover:text-zinc-600 dark:hover:text-zinc-300'
            )}
          >
            {tr('sidebar.filterAll')}
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => onTagChange(selectedTag === tag ? null : tag)}
              className={cn(
                'flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] border transition-colors',
                selectedTag === tag
                  ? 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/40'
                  : 'bg-zinc-100 dark:bg-zinc-800/60 text-zinc-400 dark:text-zinc-500 border-transparent hover:text-zinc-600 dark:hover:text-zinc-300'
              )}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* Items list — 普通滚动列表；历史 tab 支持整表拖拽排序 */}
      {(() => {
        if (flatRows.length === 0) {
          const emptyKey = isVault
            ? (searchQuery || selectedTag ? 'sidebar.noResults' : 'sidebar.noVaultRecords')
            : (searchQuery || selectedTag ? 'sidebar.noResults' : 'sidebar.noRecords')
          return (
            <div className="px-3 py-8 text-center text-xs text-zinc-400 dark:text-zinc-600">
              {tr(emptyKey)}
            </div>
          )
        }

        const renderHeader = (label: string) => (
          <div className="px-3 py-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
            {isVault ? `\u{1F3F7}\uFE0F ${label}` : label}
          </div>
        )

        const renderHighlighted = (text: string) => {
          if (!searchQuery.trim()) return text
          return highlightSegments(text, searchQuery).map((seg, i) =>
            seg.hit ? (
              <mark key={i} className="bg-amber-200/70 dark:bg-amber-400/40 text-inherit rounded-[2px] px-px">
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )
        }

        // 金库条目：DOM 结构与 class 序列与 renderHistoryItem 完全对齐，仅配色保留金库的琥珀色标识。
        const renderVaultItem = (item: ClipboardItem) => (
          <div
            key={item.id}
            data-id={item.id}
            className={cn(
              // 与历史视图同构：外层不再有 px-3（历史条目靠列表容器的 padding: 0 8px 定位），
              // 并渲染 2px 的完全透明左边框作为黄色时间线的等宽占位，
              // 使 Pin 图标距左边缘的像素值与历史视图分毫不差。
              'js-item w-full flex items-center gap-2 rounded-lg transition-all border border-transparent',
              itemPy,
              'border-l-2 border-l-transparent rounded-l-none',
              // 选中态配色（金库＝琥珀）：多选用低透明度色块，当前项用约双倍浓度强调。
              // 浅色下不再是刺眼的 amber-100 实色块；深色下用 amber-400 透明叠加，替代发闷的 amber-900/40。
              // 当前项判定优先于多选态，这样全选时仍能看出右侧详情对应的是哪一条。
              // 底色浓度整体压暗一档：浅色 20%/10% → 10%/5%，深色 20%/10% → 15%/8%。
              selectedId === item.id
                ? 'bg-amber-500/10 dark:bg-amber-400/15 text-zinc-900 dark:text-zinc-100'
                : selectedIds?.has(item.id)
                  ? 'bg-amber-500/5 dark:bg-amber-400/8'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50',
            )}
          >
            <button
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) onToggleSelect?.(item.id)
                else {
                  if (selectedIds && selectedIds.size > 0) onClearSelection?.()
                  onSelect(item.id)
                }
              }}
              className="flex-1 min-w-0 flex items-center gap-2.5 text-left"
            >
              <span className="flex-shrink-0 mt-0.5 text-amber-500">
                <Pin className="w-4 h-4" />
              </span>
              {/* 中间文本：flex:1 + min-width:0 + overflow:hidden，配合内部 truncate 触发省略号 */}
              <span className="flex-1 min-w-0 overflow-hidden text-left">
                <span className="block truncate text-[13px] leading-tight">
                  {renderHighlighted(item.alias || item.preview || (item.type === 'image' ? tr('detail.image') : tr('detail.emptyContent')))}
                </span>
                {item.alias && item.preview && (
                  <span className="block truncate text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">
                    {renderHighlighted(item.preview)}
                  </span>
                )}
              </span>
              {/*
                右侧时间标签隐形占位：复用历史视图的时间标签（同样的 class 与同样的字符串），
                仅用 visibility: hidden 隐藏。这样占位宽度与该条目在历史视图中的真实标签宽度逐像素相同，
                中间文本的截断点才能与历史视图完全一致——固定 w-[50px] 会因“刚刚/5分钟前/11个月前”宽度不一而错位。
              */}
              <span
                aria-hidden="true"
                className="invisible flex-shrink-0 text-[11px] text-zinc-400 dark:text-zinc-600"
              >
                {formatRelativeTime(item.created_at)}
              </span>
            </button>
          </div>
        )

        const renderHistoryItem = (item: ClipboardItem) => (
          <div
            key={item.id}
            data-id={item.id}
            className={cn(
              'js-item w-full flex items-center gap-2 rounded-lg transition-all border border-transparent',
              itemPy,
              item.is_pinned && selectedId !== item.id && 'border-l-2 border-l-amber-400 rounded-l-none',
              // 选中态配色（历史＝跟随主题强调色）：多选降到 5%/10%，浅色下不再刺眼；
              // 深色下用强调色透明叠加替代一片死灰的 zinc-800；当前项约双倍浓度强调且优先于多选态。
              // 底色浓度整体压暗一档：浅色 16%/8% → 10%/5%，深色 32%/15% → 20%/10%。
              selectedId === item.id
                ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] dark:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-zinc-900 dark:text-zinc-100'
                : selectedIds?.has(item.id)
                  ? 'bg-[color-mix(in_srgb,var(--accent)_5%,transparent)] dark:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50',
            )}
          >
            <button
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) onToggleSelect?.(item.id)
                else {
                  if (selectedIds && selectedIds.size > 0) onClearSelection?.()
                  onSelect(item.id)
                }
              }}
              className="flex-1 min-w-0 flex items-center gap-2.5 text-left"
            >
              <span className="flex-shrink-0 mt-0.5">
                {item.is_pinned ? (
                  <Pin className="w-4 h-4 text-amber-500" />
                ) : (
                  typeIcon(item.type)
                )}
              </span>
              <span className="flex-1 min-w-0 overflow-hidden text-left">
                <span className="block truncate text-[13px] leading-tight">
                  {renderHighlighted(item.alias || item.preview || (item.type === 'image' ? tr('detail.image') : tr('detail.emptyContent')))}
                </span>
                {item.alias && item.preview && (
                  <span className="block truncate text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">
                    {renderHighlighted(item.preview)}
                  </span>
                )}
              </span>
              <span className="flex-shrink-0 text-[11px] text-zinc-400 dark:text-zinc-600">
                {formatRelativeTime(item.created_at)}
              </span>
            </button>
          </div>
        )

        return (
<div
              ref={listRef}
              className="qp-list-scroll flex-1 min-h-0 min-w-0 max-w-full overflow-y-auto overflow-x-hidden"
              style={{ padding: '0 8px' }}
            >
            {flatRows.map((row) => (row.kind === 'header' ? renderHeader(row.label) : isVault ? renderVaultItem(row.item) : renderHistoryItem(row.item)))}
          </div>
        )
      })()}
    </div>
  )
}
