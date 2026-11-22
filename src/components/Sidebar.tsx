import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import Sortable from 'sortablejs'
import { ClipboardItem, ItemType } from '../types'
import { cn, formatGroupLabel, formatRelativeTime } from '../lib/utils'
import { highlightSegments } from '../lib/search'
import { getAutoScrollDelta } from '../lib/drag-auto-scroll'
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
  onRangeSelect?: (id: number, additive: boolean) => void
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

interface SidebarItemProps {
  item: ClipboardItem
  itemPy: string
  isVault: boolean
  isCurrent: boolean
  isSelected: boolean
  hasMultiSelection: boolean
  searchQuery: string
  fallback: string
  relativeTime: string
  onPointerDown: (id: number, event: ReactPointerEvent<HTMLButtonElement>) => void
  onClick: (id: number, event: ReactMouseEvent<HTMLButtonElement>) => void
  onKeyDown: () => void
}

const SidebarItem = memo(function SidebarItem({
  item, itemPy, isVault, isCurrent, isSelected, hasMultiSelection, searchQuery, fallback,
  relativeTime, onPointerDown, onClick, onKeyDown,
}: SidebarItemProps) {
  const renderHighlighted = (value: string) => {
    if (!searchQuery) return value
    return highlightSegments(value, searchQuery).map((segment, index) => segment.hit
      ? <mark key={index} className="bg-amber-200/70 dark:bg-amber-400/40 text-inherit rounded-[2px] px-px">{segment.text}</mark>
      : <span key={index}>{segment.text}</span>)
  }

  return (
    <div
      data-id={item.id}
      className={cn(
        'js-item mb-1 w-full flex items-center gap-2 rounded-lg border border-transparent',
        itemPy,
        isVault && 'border-l-2 border-l-transparent',
        isVault && !isCurrent && !isSelected && 'rounded-l-none hover:rounded-l-lg',
        !isVault && item.is_pinned && !isCurrent && 'border-l-2 border-l-amber-400 rounded-l-none',
        isCurrent && !hasMultiSelection
          ? isVault
            ? 'bg-amber-500/10 dark:bg-amber-400/15 text-zinc-900 dark:text-zinc-100'
            : 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] dark:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-zinc-900 dark:text-zinc-100'
          : isSelected
            ? isVault ? 'qp-vault-item-multi-selected' : 'qp-item-multi-selected'
            : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50',
      )}
    >
      <button
        onPointerDown={(event) => onPointerDown(item.id, event)}
        onKeyDown={onKeyDown}
        onClick={(event) => onClick(item.id, event)}
        className={`qp-item-content flex-1 min-w-0 flex items-center gap-2.5 text-left outline-none ${item.alias && item.preview ? 'qp-item-content-two-lines' : ''}`}
      >
        <span className="flex-shrink-0 mt-0.5">
          {isVault || item.is_pinned ? <Pin className="w-4 h-4 text-amber-500" /> : typeIcon(item.type)}
        </span>
        <span className="flex-1 min-w-0 overflow-hidden text-left">
          <span className="block truncate text-[13px] leading-tight">
            {renderHighlighted(item.alias || item.preview || fallback)}
          </span>
          {item.alias && item.preview && (
            <span className="block truncate text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">
              {renderHighlighted(item.preview)}
            </span>
          )}
        </span>
        <span aria-hidden={isVault || undefined} className={cn('flex-shrink-0 text-[11px] text-zinc-400 dark:text-zinc-600', isVault && 'invisible')}>
          {relativeTime}
        </span>
      </button>
    </div>
  )
})

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
  onRangeSelect,
  onSelectAll,
  onClearSelection,
  onBatchCopy,
  onBatchPin,
  onBatchDelete,
  onBatchAddTag,
}: SidebarProps) {
  const groupLanguage = tr('sidebar.earlier')
  const currentMinute = Math.floor(Date.now() / 60_000)
  // 分组拍平为 [表头, 条目...] 交错序列（普通 DOM 渲染，替代虚拟滚动以支持整表拖拽）
  const flatRows = useMemo(
    () =>
      (activeTab === 'vault' ? groupedByTag(items) : groupedItems(items)).flatMap((group) => [
        { kind: 'header' as const, id: `h_${group.label}`, label: group.label },
        ...group.items.map((item) => ({
          kind: 'item' as const,
          id: `i_${item.id}`,
          item,
          relativeTime: formatRelativeTime(item.created_at),
        })),
      ]),
    [items, activeTab, groupLanguage, currentMinute],
  )
  const itemPy = `py-1.5 ${density === 'compact' ? 'py-0.5' : 'py-3'}`
  const isVault = activeTab === 'vault'
  const [batchTagDraft, setBatchTagDraft] = useState('')
  // 历史和金库支持按类型筛选后拖拽。搜索与标签筛选时停用拖拽。
  const draggable = !searchQuery.trim() && selectedTag === null
  const hasRows = flatRows.length > 0

  // ── SortableJS：历史列表整表拖拽排序 ──
  const listRef = useRef<HTMLDivElement | null>(null)
  const handledSelectionPointerRef = useRef<number | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const selectionActions = useRef({ onRangeSelect, onToggleSelect, onClearSelection, onSelect, selectedIds })
  selectionActions.current = { onRangeSelect, onToggleSelect, onClearSelection, onSelect, selectedIds }

  const handleItemPointerDown = useCallback((id: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    const { onRangeSelect, onToggleSelect } = selectionActions.current
    handledSelectionPointerRef.current = null
    if (event.button !== 0 || !(event.shiftKey || event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    event.stopPropagation()
    handledSelectionPointerRef.current = id
    if (event.shiftKey) onRangeSelect?.(id, event.ctrlKey || event.metaKey)
    else onToggleSelect?.(id)
  }, [])

  const handleItemClick = useCallback((id: number, event: ReactMouseEvent<HTMLButtonElement>) => {
    const { onRangeSelect, onToggleSelect, onClearSelection, onSelect, selectedIds } = selectionActions.current
    if (handledSelectionPointerRef.current === id) {
      handledSelectionPointerRef.current = null
      return
    }
    handledSelectionPointerRef.current = null
    if (event.shiftKey) onRangeSelect?.(id, event.ctrlKey || event.metaKey)
    else if (event.ctrlKey || event.metaKey) onToggleSelect?.(id)
    else {
      if (selectedIds && selectedIds.size > 0) onClearSelection?.()
      onSelect(id)
    }
  }, [])

  const clearPointerSelection = useCallback(() => { handledSelectionPointerRef.current = null }, [])

  useEffect(() => {
    if (!draggable || !hasRows || !listRef.current) return
    let isDragging = false
    let scrollDelta = 0
    let scrollFrame: number | null = null
    let dragOverFrame: number | null = null
    let sortable: Sortable | null = null

    const updateDropTarget = () => {
      if (dragOverFrame !== null) return
      dragOverFrame = requestAnimationFrame(() => {
        dragOverFrame = null
        if (!isDragging || !sortable) return
        // SortableJS fallback 默认每 50ms 才命中一次；改为随鼠标帧更新，拖放判定更跟手。
        ;(sortable as Sortable & { _emulateDragOver?: () => void })._emulateDragOver?.()
      })
    }

    const stopAutoScroll = () => {
      isDragging = false
      scrollDelta = 0
      document.removeEventListener('pointermove', onDocumentDragMove, true)
      document.removeEventListener('mousemove', onDocumentDragMove, true)
      document.removeEventListener('wheel', onDragWheel, true)
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
      scrollFrame = null
      if (dragOverFrame !== null) cancelAnimationFrame(dragOverFrame)
      dragOverFrame = null
    }

    const scrollWhileDragging = () => {
      const container = listRef.current
      if (!isDragging || !container || scrollDelta === 0) {
        scrollFrame = null
        return
      }
      container.scrollTop += scrollDelta
      scrollFrame = requestAnimationFrame(scrollWhileDragging)
    }

    const onDocumentDragMove = (event: MouseEvent) => {
      const container = listRef.current
      if (!isDragging || !container) return
      const rect = container.getBoundingClientRect()
      scrollDelta = getAutoScrollDelta(event.clientY, rect.top, rect.bottom)
      updateDropTarget()
      if (scrollDelta !== 0 && scrollFrame === null) {
        scrollFrame = requestAnimationFrame(scrollWhileDragging)
      }
    }

    const onDragWheel = (event: WheelEvent) => {
      const container = listRef.current
      if (!isDragging || !container || event.deltaY === 0) return
      // 手动滚轮接管期间暂停边缘自动滚动，指针再次移动时恢复。
      scrollDelta = 0
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
      scrollFrame = null
      event.preventDefault()
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? container.clientHeight : 1
      container.scrollTop += event.deltaY * unit
      updateDropTarget()
    }

    sortable = new Sortable(listRef.current, {
      draggable: '.js-item',
      forceFallback: true,
      fallbackOnBody: true,
      supportPointer: false,
      scroll: false,
      filter: (event) => {
        const pointer = event as MouseEvent
        return pointer.shiftKey || pointer.ctrlKey || pointer.metaKey
      },
      preventOnFilter: false,
      animation: 0,
      ghostClass: 'qp-drag-ghost',
      chosenClass: 'qp-drag-chosen',
      dragClass: 'qp-drag-original',
      fallbackClass: 'qp-drag-floating',
      direction: 'vertical',
      onStart: () => {
        isDragging = true
        // 移除 SortableJS 内置的 50ms 轮询，改由鼠标移动和滚轮事件触发命中检测。
        const sortableInternals = sortable as Sortable & { _loopId?: number }
        if (sortableInternals._loopId !== undefined) clearInterval(sortableInternals._loopId)
        // 跟随模式通过指针移动更新列表外的自动滚动速度。
        document.addEventListener('pointermove', onDocumentDragMove, true)
        document.addEventListener('mousemove', onDocumentDragMove, true)
        document.addEventListener('wheel', onDragWheel, { capture: true, passive: false })
      },
      onEnd: () => {
        stopAutoScroll()
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
    } as Sortable.Options & { supportPointer: boolean })
    return () => {
      stopAutoScroll()
      sortable?.destroy()
    }
  }, [draggable, hasRows, onReorder, onVaultReorder, isVault])

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

  const imageFallback = tr('detail.image')
  const emptyFallback = tr('detail.emptyContent')
  const query = searchQuery.trim()
  const listRows = useMemo(() => flatRows.map((row, index) => row.kind === 'header'
    ? <div key={`${row.id}_${index}`} className="px-3 py-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
        {isVault ? `\u{1F3F7}\uFE0F ${row.label}` : row.label}
      </div>
    : <SidebarItem
        key={row.id}
        item={row.item}
        itemPy={itemPy}
        isVault={isVault}
        isCurrent={selectedId === row.item.id}
        isSelected={selectedIds?.has(row.item.id) ?? false}
        hasMultiSelection={selectedId === row.item.id && Boolean(selectedIds)}
        searchQuery={query}
        fallback={row.item.type === 'image' ? imageFallback : emptyFallback}
        relativeTime={row.relativeTime}
        onPointerDown={handleItemPointerDown}
        onClick={handleItemClick}
        onKeyDown={clearPointerSelection}
      />
  ), [flatRows, isVault, itemPy, selectedId, selectedIds, query, imageFallback, emptyFallback, handleItemPointerDown, handleItemClick, clearPointerSelection])

  const emptyKey = isVault
    ? (query || selectedTag ? 'sidebar.noResults' : 'sidebar.noVaultRecords')
    : (query || selectedTag ? 'sidebar.noResults' : 'sidebar.noRecords')

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

      {hasRows ? (
        <div
          ref={listRef}
          className="qp-list-scroll flex-1 min-h-0 min-w-0 max-w-full overflow-y-auto overflow-x-hidden"
          style={{ padding: '0 8px' }}
        >
          {listRows}
        </div>
      ) : (
        <div className="px-3 py-8 text-center text-xs text-zinc-400 dark:text-zinc-600">
          {tr(emptyKey)}
        </div>
      )}
    </div>
  )
}
