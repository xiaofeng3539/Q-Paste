import { ClipboardList, Settings } from 'lucide-react'
import { cn } from '../lib/utils'
import { tr } from '../i18n'

interface NavBarProps {
  onOpenSettings: () => void
}

export default function NavBar({ onOpenSettings }: NavBarProps) {
  return (
    <div className="h-full flex flex-col qp-canvas select-none w-[52px] flex-shrink-0">
      {/* Top — app icon */}
      <div className="flex-shrink-0 h-11 flex items-center justify-center">
        <div className="w-7 h-7 rounded-md bg-white border border-[#d9dee5] shadow-sm dark:bg-zinc-900 dark:border-zinc-700/80 dark:shadow-sm flex items-center justify-center">
          <ClipboardList className="w-4 h-4 text-zinc-600 dark:text-zinc-300" />
        </div>
      </div>

      {/* Middle spacer */}
      <div className="flex-1" />

      {/* Bottom — settings button */}
      <button
        onClick={onOpenSettings}
        className={cn(
          'flex-shrink-0 h-11 w-full flex items-center justify-center',
          'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-300/50',
          'dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800/80',
          'transition-colors',
        )}
        title={tr('nav.settings')}
      >
        <Settings className="w-5 h-5" />
      </button>
    </div>
  )
}
