import { ClipboardItem } from '../types'
import { cn, formatRelativeTime, formatGroupLabel } from '../lib/utils'
import { FileText, Link, Image, Search, X, Clock, Star, Pin, FileCode2, FolderOpen } from 'lucide-react'
import { tr } from '../i18n'

type ActiveTab = 'history' | 'vault'

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
}: SidebarProps) {
  const groups = activeTab === 'vault' ? groupedByTag(items) : groupedItems(items)
  const itemPy = density === 'compact' ? 'py-1' : 'py-2'
  const isVault = activeTab === 'vault'

  return (
    <div className="h-full flex flex-col bg-white dark:bg-zinc-950 select-none">
      {/* Tab bar */}
      <div className="flex-shrink-0 px-3 pt-6 pb-1">
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
            className="w-full h-7 pl-7 pr-6 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md text-xs text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 dark:placeholder-zinc-600 outline-none focus:border-zinc-400 dark:focus:border-zinc-700 transition-colors"
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

      {/* Items list */}
      <div className="flex-1 overflow-y-auto px-2">
        {isVault ? (
          /* ── 金库视图：按标签分组 ── */
          groups.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-zinc-400 dark:text-zinc-600">
              {searchQuery || selectedTag ? tr('sidebar.noResults') : tr('sidebar.noVaultRecords')}
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.label}>
                <div className="px-3 py-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                  🏷️ {group.label}
                </div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onSelect(item.id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 text-left transition-all rounded-lg',
                      itemPy,
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
                        {item.alias || item.preview || (item.type === 'image' ? tr('detail.image') : tr('detail.emptyContent'))}
                      </span>
                      {item.alias && (
                        <span className="block truncate text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">
                          {item.preview}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            ))
          )
        ) : (
          /* ── 历史视图：按时间分组 ── */
          groups.map((group) => (
            <div key={group.label}>
              <div className="px-3 py-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                {group.label}
              </div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 text-left transition-all rounded-lg border border-transparent',
                    itemPy,
                    selectedId === item.id
                      ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50',
                    item.is_pinned && 'border-l-2 border-l-amber-400 rounded-l-none',
                  )}
                >
                  <span className="flex-shrink-0 mt-0.5">
                    {item.is_pinned ? (
                      <Pin className="w-4 h-4 text-amber-500" />
                    ) : (
                      typeIcon(item.type)
                    )}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-[13px] leading-tight">
                    {item.preview || (item.type === 'image' ? tr('detail.image') : tr('detail.emptyContent'))}
                  </span>
                  <span className="flex-shrink-0 text-[11px] text-zinc-400 dark:text-zinc-600">
                    {formatRelativeTime(item.created_at)}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
        {!isVault && items.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-zinc-400 dark:text-zinc-600">
            {searchQuery || selectedTag ? tr('sidebar.noResults') : tr('sidebar.noRecords')}
          </div>
        )}
      </div>
    </div>
  )
}
