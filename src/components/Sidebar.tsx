import { ClipboardItem } from '../types'
import { cn, formatRelativeTime, formatGroupLabel } from '../lib/utils'
import { FileText, Link, Image, Search, X } from 'lucide-react'
import { tr } from '../i18n'

interface SidebarProps {
  items: ClipboardItem[]
  selectedId: number | null
  searchQuery: string
  onSearchChange: (query: string) => void
  onSelect: (id: number) => void
  density: 'comfortable' | 'compact'
}

function typeIcon(type: string) {
  const cls = 'w-4 h-4 flex-shrink-0'
  switch (type) {
    case 'url':
      return <Link className={cn(cls, 'text-blue-500 dark:text-blue-400')} />
    case 'image':
      return <Image className={cn(cls, 'text-green-500 dark:text-green-400')} />
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

export default function Sidebar({
  items,
  selectedId,
  searchQuery,
  onSearchChange,
  onSelect,
  density,
}: SidebarProps) {
  const groups = groupedItems(items)
  const itemPy = density === 'compact' ? 'py-1' : 'py-2'

  return (
    <div className="h-full flex flex-col bg-white dark:bg-zinc-950 select-none">
      {/* Search bar */}
      <div className="flex-shrink-0 px-3 pt-6 pb-2">
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

      {/* Items list */}
      <div className="flex-1 overflow-y-auto px-2">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="px-3 py-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
              {group.label}
            </div>
            {group.items.map((item) => (
              <button
                key={item.id}
                onClick={() => onSelect(item.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 text-left transition-all rounded-lg',
                  itemPy,
                  selectedId === item.id
                    ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50',
                )}
              >
                <span className="flex-shrink-0 mt-0.5">
                  {typeIcon(item.type)}
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
        ))}
        {items.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-zinc-400 dark:text-zinc-600">
            {searchQuery ? tr('sidebar.noResults') : tr('sidebar.noRecords')}
          </div>
        )}
      </div>
    </div>
  )
}
