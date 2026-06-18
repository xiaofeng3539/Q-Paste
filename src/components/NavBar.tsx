import { ClipboardList, Settings } from 'lucide-react'
import { cn } from '../lib/utils'
import { tr } from '../i18n'

interface NavBarProps {
  onOpenSettings: () => void
}

export default function NavBar({ onOpenSettings }: NavBarProps) {
  return (
    <div className="h-full flex flex-col bg-zinc-50 dark:bg-zinc-950 select-none w-[52px] flex-shrink-0">
      {/* Top — app icon */}
      <div className="flex-shrink-0 h-11 flex items-center justify-center">
        <div className="w-7 h-7 rounded-md bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center">
          <ClipboardList className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
        </div>
      </div>

      {/* Middle spacer */}
      <div className="flex-1" />

      {/* Bottom — settings button */}
      <button
        onClick={onOpenSettings}
        className={cn(
          'flex-shrink-0 h-11 w-full flex items-center justify-center',
          'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/60',
          'dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-800/60',
          'transition-colors',
        )}
        title={tr('nav.settings')}
      >
        <Settings className="w-5 h-5" />
      </button>
    </div>
  )
}
