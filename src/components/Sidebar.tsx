import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import Sortable from 'sortablejs'
import { ClipboardItem, ItemType } from '../types'
import { cn, formatGroupLabel, formatRelativeTime } from '../lib/utils'
import { highlightSegments } from '../lib/search'
import { getAutoScrollDelta } from '../lib/drag-auto-scroll'
import { FileText, Link, Image, Search, X, Clock, Star, Pin, FileCode2, FolderOpen, Monitor, Copy, Trash2, Tag, CheckSquare } from 'lucide-react'
import { tr } from '../i18n'
import { MERGE_SEPARATOR_PRESETS, resolveMergeSeparator, type MergeSeparatorPreset } from '../lib/clipboard-actions'

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
  onDoubleClick?: (item: ClipboardItem) => void
  density: 'comfortable' | 'compact'
  activeTab: ActiveTab
  onTabChange: (tab: ActiveTab) => void
  allTags: string[]
  selectedTag: string | null
  onTagChange: (tag: string | null) => void
  allSources?: string[]
  selectedSource?: string | null
  onSourceChange?: (source: string | null) => void
  onResetFilters?: () => void
  onReorder: (ordered: ClipboardItem[]) => void
  onVaultReorder: (ordered: ClipboardItem[]) => void
  typeFilter: ItemType | 'all'
  onTypeFilterChange: (t: ItemType | 'all') => void
  selectedIds?: ReadonlySet<number>
  onToggleSelect?: (id: number) => void
  onRangeSelect?: (id: number, additive: boolean) => void
  onSelectAll?: () => void
  onClearSelection?: () => void
  onBatchCopy?: (separator: string) => void
  onBatchPin?: () => void
  onBatchDelete?: () => void
  onBatchAddTag?: (tag: string) => void
}

const THUMB_CACHE_LIMIT = 240
const itemThumbCache = new Map<number, string>()
const itemThumbInflight = new Map<number, Promise<string>>()

function requestItemThumbnail(id: number): Promise<string> {
  const cached = itemThumbCache.get(id)
  if (cached) return Promise.resolve(cached)
  const inflight = itemThumbInflight.get(id)
  if (inflight) return inflight
  const getter = typeof window !== 'undefined' ? window.electronAPI?.getItemThumbnail : undefined
  if (!getter) return Promise.resolve('')
  const pending = getter(id)
    .then((url) => {
      if (url) {
        itemThumbCache.set(id, url)
        if (itemThumbCache.size > THUMB_CACHE_LIMIT) {
          const oldest = itemThumbCache.keys().next().value
          if (oldest !== undefined) itemThumbCache.delete(oldest)
        }
      }
      return url || ''
    })
    .catch(() => '')
    .finally(() => { itemThumbInflight.delete(id) })
  itemThumbInflight.set(id, pending)
  return pending
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
  quickIndex?: number
  searchQuery: string
  fallback: string
  relativeTime: string
  onPointerDown: (id: number, event: ReactPointerEvent<HTMLButtonElement>) => void
  onClick: (id: number, event: ReactMouseEvent<HTMLButtonElement>) => void
  onDoubleClick: (item: ClipboardItem) => void
  onKeyDown: () => void
}

const SidebarItem = memo(function SidebarItem({
  item, itemPy, isVault, isCurrent, isSelected, hasMultiSelection, quickIndex, searchQuery, fallback,
  relativeTime, onPointerDown, onClick, onDoubleClick, onKeyDown,
}: SidebarItemProps) {
  const [thumbUrl, setThumbUrl] = useState<string>(() => {
    if (item.type !== 'image') return ''
    return itemThumbCache.get(item.id) || (item.content?.startsWith('data:') ? item.content : '')
  })

  useEffect(() => {
    if (item.type !== 'image') {
      setThumbUrl('')
      return
    }
    const existing = itemThumbCache.get(item.id) || (item.content?.startsWith('data:') ? item.content : '')
    if (existing) {
      setThumbUrl(existing)
      return
    }
    let cancelled = false
    void requestItemThumbnail(item.id).then((url) => {
      if (!cancelled && url) setThumbUrl(url)
    })
    return () => { cancelled = true }
  }, [item.id, item.type, item.content])

  const renderHighlighted = (value: string) => {
    if (!searchQuery) return value
    return highlightSegments(value, searchQuery).map((segment, index) => segment.hit
      ? <mark key={index} className="bg-amber-200/70 dark:bg-amber-400/40 text-inherit rounded-[2px] px-px">{segment.text}</mark>
      : <span key={index}>{segment.text}</span>)
  }

  const secondaryText = item.alias && item.preview
    ? item.preview
    : item.type === 'image' && item.ocr_text
      ? item.ocr_text.replace(/\s+/g, ' ').trim()
      : ''

  return (
    <div
      data-id={item.id}
      className={cn(
        'js-item mb-1 w-full flex items-center rounded-lg border border-transparent',
        isVault && 'border-l-2 border-l-transparent',
        isVault && !isCurrent && !isSelected && 'rounded-l-none hover:rounded-l-lg',
        !isVault && item.is_pinned && !isCurrent && 'border-l-2 border-l-amber-400 rounded-l-none',
        isCurrent && !hasMultiSelection
          ? isVault
            ? 'bg-amber-500/10 dark:bg-amber-400/15 text-zinc-900 dark:text-zinc-50 font-medium shadow-[inset_0_0_0_1px_rgba(245,158,11,0.35)] dark:shadow-[inset_0_0_0_1px_rgba(251,191,36,0.45)]'
            : 'bg-[color-mix(in_srgb,var(--accent)_11%,white)] dark:bg-[color-mix(in_srgb,var(--accent)_22%,#1e222b)] text-zinc-900 dark:text-zinc-50 font-medium shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_32%,transparent)] dark:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_52%,transparent)]'
          : isSelected
            ? isVault ? 'qp-vault-item-multi-selected' : 'qp-item-multi-selected'
            : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/75',
      )}
    >
      <button
        type="button"
        onPointerDown={(event) => onPointerDown(item.id, event)}
        onKeyDown={onKeyDown}
        onClick={(event) => onClick(item.id, event)}
        onDoubleClick={() => onDoubleClick(item)}
        className={cn(
          'qp-item-content w-full flex-1 min-w-0 flex items-center gap-2.5 px-2.5 text-left outline-none cursor-pointer rounded-lg',
          itemPy,
          secondaryText && 'qp-item-content-two-lines',
        )}
      >
        {item.type === 'image' && thumbUrl ? (
          <span className="relative flex-shrink-0">
            <img
              src={thumbUrl}
              alt=""
              loading="lazy"
              className="w-9 h-7 rounded-[5px] object-cover border border-zinc-200 dark:border-zinc-700/80 bg-zinc-100 dark:bg-zinc-900"
            />
            {(isVault || item.is_pinned) && (
              <span className="absolute -top-1 -left-1 w-3.5 h-3.5 rounded-full bg-white dark:bg-zinc-900 flex items-center justify-center shadow-sm ring-1 ring-amber-400/50">
                <Pin className="w-2.5 h-2.5 text-amber-500" />
              </span>
            )}
          </span>
        ) : (
          <span className="flex-shrink-0">
            {isVault || item.is_pinned ? <Pin className="w-4 h-4 text-amber-500" /> : typeIcon(item.type)}
          </span>
        )}
        <span className="flex-1 min-w-0 overflow-hidden text-left">
          <span className="block truncate text-[13px] leading-tight">
            {renderHighlighted(item.alias || item.preview || fallback)}
          </span>
          {secondaryText && (
            <span className="block truncate text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
              {renderHighlighted(secondaryText)}
            </span>
          )}
        </span>
        <span className="flex-shrink-0 flex items-center gap-1.5">
          {quickIndex !== undefined && (
            <span
              data-quick-index={quickIndex}
              title={`Alt+${quickIndex} / Ctrl+${quickIndex}`}
              className="w-4 h-4 rounded text-[10px] font-mono tabular-nums flex items-center justify-center bg-zinc-100 dark:bg-zinc-800/90 text-zinc-500 dark:text-zinc-400 border border-zinc-200/80 dark:border-zinc-700/70"
            >
              {quickIndex}
            </span>
          )}
          <span aria-hidden={isVault || undefined} className={cn('text-[11px] text-zinc-400 dark:text-zinc-500', isVault && 'invisible')}>
            {relativeTime}
          </span>
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
  onDoubleClick,
  density,
  activeTab,
  onTabChange,
  allTags,
  selectedTag,
  onTagChange,
  allSources,
  selectedSource,
  onSourceChange,
  onResetFilters,
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
  const flatRows = useMemo(() => {
    let itemIndex = 0
    return (activeTab === 'vault' ? groupedByTag(items) : groupedItems(items)).flatMap((group) => [
      { kind: 'header' as const, id: `h_${group.label}`, label: group.label },
      ...group.items.map((item) => {
        const quickIndex = itemIndex < 9 ? itemIndex + 1 : undefined
        itemIndex += 1
        return {
          kind: 'item' as const,
          id: `i_${item.id}`,
          item,
          quickIndex,
          relativeTime: formatRelativeTime(item.created_at),
        }
      }),
    ])
  }, [items, activeTab, groupLanguage, currentMinute])
  const itemPy = density === 'compact' ? 'py-1.5' : 'py-3'
  const isVault = activeTab === 'vault'
  const [batchTagDraft, setBatchTagDraft] = useState('')
  const [showBatchTagInput, setShowBatchTagInput] = useState(false)
  const [sepPreset, setSepPreset] = useState<MergeSeparatorPreset>(() => {
    try {
      const saved = localStorage.getItem('q-paste-batch-sep-preset')
      if (saved === 'newline' || saved === 'blankLine' || saved === 'comma' || saved === 'dunhao' || saved === 'space' || saved === 'custom') {
        return saved
      }
    } catch {}
    return 'newline'
  })
  const [customSep, setCustomSep] = useState(() => {
    try { return localStorage.getItem('q-paste-batch-sep-custom') ?? '' } catch { return '' }
  })
  useEffect(() => {
    try { localStorage.setItem('q-paste-batch-sep-preset', sepPreset) } catch {}
  }, [sepPreset])
  useEffect(() => {
    try { localStorage.setItem('q-paste-batch-sep-custom', customSep) } catch {}
  }, [customSep])
  useEffect(() => {
    if (!selectedIds || selectedIds.size === 0) {
      setShowBatchTagInput(false)
      setBatchTagDraft('')
    }
  }, [selectedIds])
  // 历史和金库支持按类型筛选后拖拽。搜索、标签或来源筛选时停用拖拽。
  const draggable = !searchQuery.trim() && selectedTag === null && !selectedSource
  const hasRows = flatRows.length > 0

  // ── SortableJS：历史列表整表拖拽排序 ──
  const listRef = useRef<HTMLDivElement | null>(null)
  const handledSelectionPointerRef = useRef<number | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const selectionActions = useRef({ onRangeSelect, onToggleSelect, onClearSelection, onSelect, onDoubleClick, selectedIds })
  selectionActions.current = { onRangeSelect, onToggleSelect, onClearSelection, onSelect, onDoubleClick, selectedIds }

  const handleItemPointerDown = useCallback((id: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    const { onRangeSelect, onToggleSelect, onClearSelection, onSelect, selectedIds } = selectionActions.current
    handledSelectionPointerRef.current = null
    if (event.button !== 0) return
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      event.preventDefault()
      event.stopPropagation()
      handledSelectionPointerRef.current = id
      if (event.shiftKey) onRangeSelect?.(id, event.ctrlKey || event.metaKey)
      else onToggleSelect?.(id)
      return
    }
    // 普通左键按下即切换选中，不阻断冒泡以保留 Sortable 拖拽排序。
    handledSelectionPointerRef.current = id
    if (selectedIds && selectedIds.size > 0) onClearSelection?.()
    onSelect(id)
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

  const handleItemDoubleClick = useCallback((item: ClipboardItem) => {
    selectionActions.current.onDoubleClick?.(item)
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
      fallbackTolerance: 8,
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
    ? <div key={`${row.id}_${index}`} className="px-3 pt-3 pb-1.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
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
        quickIndex={row.quickIndex}
        searchQuery={query}
        fallback={row.item.type === 'image' ? imageFallback : emptyFallback}
        relativeTime={row.relativeTime}
        onPointerDown={handleItemPointerDown}
        onClick={handleItemClick}
        onDoubleClick={handleItemDoubleClick}
        onKeyDown={clearPointerSelection}
      />
  ), [flatRows, isVault, itemPy, selectedId, selectedIds, query, imageFallback, emptyFallback, handleItemPointerDown, handleItemClick, handleItemDoubleClick, clearPointerSelection])

  const hasFilter = Boolean(query || selectedTag || selectedSource || typeFilter !== 'all')
  const emptyKey = isVault
    ? (hasFilter ? 'sidebar.noResults' : 'sidebar.noVaultRecords')
    : (hasFilter ? 'sidebar.noResults' : 'sidebar.noRecords')

  return (
    <div className="h-full flex flex-col qp-panel rounded-2xl overflow-hidden select-none">
      {/* Tab bar */}
      <div className="flex-shrink-0 px-3 pt-5 pb-1">
        <div className="flex rounded-lg bg-zinc-100 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-950/75 dark:ring-zinc-700/60 p-0.5">
          <button
            onClick={() => onTabChange('history')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 h-7 rounded-md text-xs transition-colors',
              activeTab === 'history'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium shadow-[0_1px_2px_rgba(15,23,42,0.10)] ring-1 ring-zinc-200 dark:ring-zinc-700/80 dark:shadow-sm'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200',
            )}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{tr('sidebar.tabHistory')}</span>
          </button>
          <button
            onClick={() => onTabChange('vault')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 h-7 rounded-md text-xs transition-colors',
              activeTab === 'vault'
                ? 'bg-white dark:bg-zinc-800 text-amber-600 dark:text-amber-400 font-medium shadow-[0_1px_2px_rgba(15,23,42,0.10)] ring-1 ring-zinc-200 dark:ring-zinc-700/80 dark:shadow-sm'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200',
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
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 dark:text-zinc-400" />
          <input
            type="text"
            placeholder={tr('sidebar.search')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full h-7 pl-7 pr-6 bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-700/70 rounded-md text-xs text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:bg-white focus:border-[var(--accent)] dark:focus:bg-zinc-950/90 dark:focus:border-[var(--accent)] transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-200"
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
                ? 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/50 font-medium dark:bg-[var(--accent)]/20 dark:border-[var(--accent)]/60'
                : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700/70 hover:text-zinc-900 hover:border-zinc-300 dark:hover:text-zinc-100 dark:hover:border-zinc-600'
            )}
          >
            {tr(f.label)}
          </button>
        ))}
      </div>

      {/* Source app filter chips */}
      {(() => {
        const visibleSources = allSources ? [...allSources] : []
        if (selectedSource && !visibleSources.includes(selectedSource)) visibleSources.unshift(selectedSource)
        if (!visibleSources.length || !onSourceChange) return null
        return (
        <div data-testid="source-filter-bar" className="qp-type-filter-scroll flex-shrink-0 px-3 pb-2 flex items-center gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => onSourceChange(null)}
            className={cn(
              'flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] border transition-colors',
              !selectedSource
                ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-100 border-zinc-300 dark:border-zinc-600 font-medium'
                : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700/70 hover:text-zinc-900 hover:border-zinc-300 dark:hover:text-zinc-100 dark:hover:border-zinc-600'
            )}
          >
            {tr('sidebar.sourceAll')}
          </button>
          {visibleSources.map((source) => (
            <button
              key={source}
              type="button"
              onClick={() => onSourceChange(selectedSource === source ? null : source)}
              className={cn(
                'flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] border transition-colors inline-flex items-center gap-1',
                selectedSource === source
                  ? 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/50 font-medium dark:bg-[var(--accent)]/20 dark:border-[var(--accent)]/60'
                  : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700/70 hover:text-zinc-900 hover:border-zinc-300 dark:hover:text-zinc-100 dark:hover:border-zinc-600'
              )}
            >
              <Monitor className="w-2.5 h-2.5 opacity-75" />
              <span>{source}</span>
            </button>
          ))}
        </div>
        )
      })()}

      {/* Tag filter chips */}
      {(() => {
        const visibleTags = [...allTags]
        if (selectedTag && !visibleTags.includes(selectedTag)) visibleTags.unshift(selectedTag)
        if (!visibleTags.length) return null
        return (
        <div data-testid="tag-filter-bar" className="qp-type-filter-scroll flex-shrink-0 px-3 pb-2 flex items-center gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => onTagChange(null)}
            className={cn(
              'flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] border transition-colors',
              selectedTag === null
                ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-100 border-zinc-300 dark:border-zinc-600 font-medium'
                : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700/70 hover:text-zinc-900 hover:border-zinc-300 dark:hover:text-zinc-100 dark:hover:border-zinc-600'
            )}
          >
            {tr('sidebar.filterAll')}
          </button>
          {visibleTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onTagChange(selectedTag === tag ? null : tag)}
              className={cn(
                'flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] border transition-colors',
                selectedTag === tag
                  ? 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/50 font-medium dark:bg-[var(--accent)]/20 dark:border-[var(--accent)]/60'
                  : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700/70 hover:text-zinc-900 hover:border-zinc-300 dark:hover:text-zinc-100 dark:hover:border-zinc-600'
              )}
            >
              {tag}
            </button>
          ))}
        </div>
        )
      })()}

      {hasRows ? (
        <div
          ref={listRef}
          className="qp-list-scroll flex-1 min-h-0 min-w-0 max-w-full overflow-y-auto overflow-x-hidden"
          style={{ padding: '0 8px' }}
        >
          {listRows}
        </div>
      ) : (
        <div className="flex-1 px-3 py-8 text-center text-xs text-zinc-400 dark:text-zinc-500 flex flex-col items-center gap-2.5">
          <span>{tr(emptyKey)}</span>
          {hasFilter && (
            <button
              type="button"
              data-testid="sidebar-reset-filters"
              onClick={() => {
                if (onResetFilters) {
                  onResetFilters()
                } else {
                  onSearchChange('')
                  onTypeFilterChange('all')
                  onTagChange(null)
                  onSourceChange?.(null)
                }
              }}
              className="px-2.5 py-1 rounded-full text-[11px] font-medium border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
            >
              {tr('sidebar.resetFilters')}
            </button>
          )}
        </div>
      )}

      {/* Multi-select batch action bar (merge copy + pin + tag + delete) */}
      {selectedIds && selectedIds.size > 0 && (
        <div
          data-testid="sidebar-batch-bar"
          className="flex-shrink-0 border-t border-zinc-200 dark:border-zinc-700/70 bg-zinc-50/95 dark:bg-zinc-900/95 px-2.5 py-2 space-y-1.5"
        >
          <div className="flex items-center justify-between gap-1 text-[11px]">
            <span className="font-medium text-zinc-700 dark:text-zinc-200 tabular-nums">
              {tr('sidebar.selectedCount', { n: selectedIds.size })}
            </span>
            <div className="flex items-center gap-1">
              {onSelectAll && (
                <button
                  type="button"
                  onClick={onSelectAll}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 transition-colors"
                >
                  <CheckSquare className="w-3 h-3" />
                  <span>{tr('sidebar.selectAll')}</span>
                </button>
              )}
              {onClearSelection && (
                <button
                  type="button"
                  onClick={onClearSelection}
                  title={tr('sidebar.clearSelection')}
                  className="p-0.5 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            {MERGE_SEPARATOR_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                data-sep-preset={preset.id}
                onClick={() => setSepPreset(preset.id)}
                className={cn(
                  'px-1.5 py-0.5 rounded text-[10px] border transition-colors',
                  sepPreset === preset.id
                    ? 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/50 font-medium'
                    : 'bg-white dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700/70 hover:text-zinc-900 dark:hover:text-zinc-100',
                )}
              >
                {tr(preset.labelKey)}
              </button>
            ))}
            <button
              type="button"
              data-sep-preset="custom"
              onClick={() => setSepPreset('custom')}
              className={cn(
                'px-1.5 py-0.5 rounded text-[10px] border transition-colors',
                sepPreset === 'custom'
                  ? 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/50 font-medium'
                  : 'bg-white dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700/70 hover:text-zinc-900 dark:hover:text-zinc-100',
              )}
            >
              {tr('batch.sepCustom')}
            </button>
          </div>

          {sepPreset === 'custom' && (
            <input
              type="text"
              value={customSep}
              onChange={(e) => setCustomSep(e.target.value)}
              placeholder={tr('batch.sepCustomPlaceholder')}
              className="w-full h-6 px-2 rounded text-[11px] bg-white dark:bg-zinc-950/70 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 outline-none focus:border-[var(--accent)]"
            />
          )}

          {showBatchTagInput && onBatchAddTag && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const tag = batchTagDraft.trim()
                if (tag) {
                  onBatchAddTag(tag)
                  setBatchTagDraft('')
                  setShowBatchTagInput(false)
                }
              }}
              className="flex items-center gap-1"
            >
              <input
                type="text"
                value={batchTagDraft}
                onChange={(e) => setBatchTagDraft(e.target.value)}
                placeholder={tr('detail.tagPlaceholder')}
                autoFocus
                className="flex-1 min-w-0 h-6 px-2 rounded text-[11px] bg-white dark:bg-zinc-950/70 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 outline-none focus:border-[var(--accent)]"
              />
              <button
                type="submit"
                className="h-6 px-2 rounded text-[11px] font-medium text-white"
                style={{ background: 'var(--accent)' }}
              >
                {tr('dialog.ok')}
              </button>
            </form>
          )}

          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="batch-merge-copy"
              onClick={() => onBatchCopy?.(resolveMergeSeparator(sepPreset, customSep))}
              className="flex-1 h-7 px-2 rounded-md text-[11px] font-medium text-white inline-flex items-center justify-center gap-1 shadow-sm hover:opacity-95 transition-opacity"
              style={{ background: 'var(--accent)' }}
            >
              <Copy className="w-3 h-3" />
              <span>{tr('sidebar.batchCopy')}</span>
            </button>
            {onBatchPin && (
              <button
                type="button"
                onClick={onBatchPin}
                title={tr('sidebar.batchPin')}
                className="h-7 px-2 rounded-md text-[11px] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
              >
                <Pin className="w-3.5 h-3.5" />
              </button>
            )}
            {onBatchAddTag && (
              <button
                type="button"
                onClick={() => setShowBatchTagInput((v) => !v)}
                title={tr('sidebar.batchAddTag')}
                className={cn(
                  'h-7 px-2 rounded-md text-[11px] border transition-colors',
                  showBatchTagInput
                    ? 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/50'
                    : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100',
                )}
              >
                <Tag className="w-3.5 h-3.5" />
              </button>
            )}
            {onBatchDelete && (
              <button
                type="button"
                onClick={onBatchDelete}
                title={tr('sidebar.batchDelete')}
                className="h-7 px-2 rounded-md text-[11px] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
