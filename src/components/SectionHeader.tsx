import { cn } from '../lib/utils'

interface SectionHeaderProps {
  children: React.ReactNode
  className?: string
}

export default function SectionHeader({ children, className }: SectionHeaderProps) {
  return (
    <h3
      className={cn(
        'text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-4',
        className,
      )}
    >
      {children}
    </h3>
  )
}
