import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { tr } from '../i18n'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatRelativeTime(dateStr: string): string {
  const now = Date.now()
  const date = new Date(dateStr).getTime()
  const diffMs = now - date
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) return tr('time.justNow')
  if (diffMin < 60) return tr('time.minutesAgo', { n: diffMin })
  if (diffHour < 24) return tr('time.hoursAgo', { n: diffHour })
  if (diffDay === 1) return tr('time.yesterday')
  if (diffDay < 7) return tr('time.daysAgo', { n: diffDay })
  if (diffDay < 30) return tr('time.weeksAgo', { n: Math.floor(diffDay / 7) })
  if (diffDay < 365) return tr('time.monthsAgo', { n: Math.floor(diffDay / 30) })
  return tr('time.yearsAgo', { n: Math.floor(diffDay / 365) })
}

export function formatGroupLabel(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffDay = Math.floor((now.getTime() - date.getTime()) / 86400000)

  if (diffDay === 0) return tr('sidebar.today')
  if (diffDay === 1) return tr('sidebar.yesterday')
  if (diffDay < 7) return tr('sidebar.thisWeek')
  if (diffDay < 30) return tr('sidebar.thisMonth')
  return tr('sidebar.earlier')
}

export function formatStorageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function getTypeLabel(type: string): string {
  switch (type) {
    case 'text': return tr('detail.typeText')
    case 'url': return tr('detail.typeUrl')
    case 'image': return tr('detail.typeImage')
    default: return type
  }
}
