import { useEffect, useMemo, useRef, useState } from 'react'
import Sortable from 'sortablejs'
import { ClipboardItem, ItemType } from '../types'
import { cn, formatGroupLabel, formatRelativeTime } from '../lib/utils'
import { highlightSegments } from '../lib/search'
import { FileText, Link, Image, Search, X, Clock, Star, Pin, FileCode2, FolderOpen, CheckSquare } from 'lucide-react'
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
      filter: '.no-drag',
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
      <div className="flex-shrink-0 px-3 pb-2 flex items-center gap-1 overflow-x-auto">
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

      {/* 批量操作工具栏（有多选时显示） */}
      {selectedIds && selectedIds.size > 0 && (
        <div className="flex-shrink-0 px-3 pb-2 flex flex-wrap items-center gap-1.5">
          <span className="flex-shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">
            {tr('sidebar.selectedCount', { n: selectedIds.size })}
          </span>
          <button
            onClick={onSelectAll}
            className="flex-shrink-0 px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[11px] text-zinc-600 dark:text-zinc-300 transition-colors"
          >
            {tr('sidebar.selectAll')}
          </button>
          <button
            onClick={onBatchCopy}
            className="flex-shrink-0 px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[11px] text-zinc-600 dark:text-zinc-300 transition-colors"
          >
            {tr('sidebar.batchCopy')}
          </button>
          <button
            onClick={onBatchPin}
            className="flex-shrink-0 px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[11px] text-zinc-600 dark:text-zinc-300 transition-colors"
          >
            {tr('sidebar.batchPin')}
          </button>
          <button
            onClick={onBatchDelete}
            className="flex-shrink-0 px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-red-100 dark:hover:bg-red-900/50 hover:text-red-600 dark:hover:text-red-400 text-[11px] text-zinc-600 dark:text-zinc-300 transition-colors"
          >
            {tr('sidebar.batchDelete')}
          </button>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={batchTagDraft}
              onChange={(e) => setBatchTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const t = batchTagDraft.trim()
                  if (t) {
                    onBatchAddTag?.(t)
                    setBatchTagDraft('')
                  }
                }
              }}
              placeholder={tr('sidebar.batchAddTag')}
              className="w-16 h-6 px-1.5 text-[11px] bg-zinc-100 dark:bg-zinc-900 border border-transparent rounded-md text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 dark:placeholder-zinc-600 outline-none focus:border-zinc-300 dark:focus:border-zinc-700 transition-colors"
            />
          </div>
          <button
            onClick={onClearSelection}
            className="flex-shrink-0 px-1.5 py-0.5 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            title={tr('sidebar.clearSelection')}
          >
            <X className="w-3 h-3" />
          </button>
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

        const renderCheckbox = (item: ClipboardItem) => {
          if (!onToggleSelect) return null
          const checked = selectedIds?.has(item.id) ?? false
          return (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggleSelect(item.id)
              }}
              className={cn(
                'no-drag flex-shrink-0 flex items-center justify-center w-4 h-4 rounded border transition-colors',
                checked
                  ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                  : 'border-zinc-300 dark:border-zinc-600 text-transparent hover:border-zinc-400 dark:hover:border-zinc-500',
              )}
              title={tr('sidebar.toggleSelect')}
            >
              <CheckSquare className="w-3 h-3" />
            </button>
          )
        }

        const renderVaultItem = (item: ClipboardItem) => (
          <div
            key={item.id}
            data-id={item.id}
            className={cn(
              'js-item w-full flex items-center gap-2 px-3 rounded-lg transition-all',
              itemPy,
              selectedIds?.has(item.id)
                ? 'bg-amber-100 dark:bg-amber-900/40 ring-1 ring-amber-300 dark:ring-amber-700/40'
                : '',
            )}
          >
            {renderCheckbox(item)}
            <button
              onClick={() => onSelect(item.id)}
              className={cn(
                'flex-1 min-w-0 flex items-center gap-2.5 text-left transition-all rounded-lg',
                selectedId === item.id
                  ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 border border-transparent',
              )}
            >
              <span className="flex-shrink-0 mt-0.5 text-amber-500">
                <Pin className="w-3.5 h-3.5" />
              </span>
              <span className="flex-1 min-w-0 text-left">
                <span className="block truncate text-[13px] leading-tight">
                  {renderHighlighted(item.alias || item.preview || (item.type === 'image' ? tr('detail.image') : tr('detail.emptyContent')))}
                </span>
                {item.alias && item.preview && (
                  <span className="block truncate text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">
                    {renderHighlighted(item.preview)}
                  </span>
                )}
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
              selectedIds?.has(item.id)
                ? 'bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] dark:bg-zinc-800/80'
                : selectedId === item.id
                  ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50',
            )}
          >
            {renderCheckbox(item)}
            <button
              onClick={() => onSelect(item.id)}
              className="flex-1 min-w-0 flex items-center gap-2.5 text-left"
            >
              <span className="flex-shrink-0 mt-0.5">
                {item.is_pinned ? (
                  <Pin className="w-4 h-4 text-amber-500" />
                ) : (
                  typeIcon(item.type)
                )}
              </span>
              <span className="flex-1 min-w-0 text-left">
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
            className="flex-1 min-h-0 overflow-y-auto"
            style={{ padding: '0 8px' }}
          >
            {flatRows.map((row) => (row.kind === 'header' ? renderHeader(row.label) : isVault ? renderVaultItem(row.item) : renderHistoryItem(row.item)))}
          </div>
        )
      })()}
    </div>
  )
}
