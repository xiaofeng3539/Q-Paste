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
    case 'html': return tr('detail.typeHtml')
    case 'files': return tr('detail.typeFiles')
    default: return type
  }
}

// ── HTML / 文件列表工具 ──

/** 去除 HTML 标签与实体，提取纯文本（用于预览、敏感检测、复制纯文本） */
export function stripHtml(html: string): string {
  if (!html) return ''
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 解析文件路径列表（Windows 剪贴板 FileNameW 格式：UTF-16LE，\0 分隔） */
export function parseFilePaths(content: string): string[] {
  if (!content) return []
  try {
    const arr = JSON.parse(content)
    if (!Array.isArray(arr)) return []
    return arr.filter((p): p is string => typeof p === 'string' && p.length > 0)
  } catch {
    return []
  }
}

/** 从完整路径中取文件名 */
export function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}

// ── 敏感数据检测 ──

interface SensitivePattern {
  name: string
  regex: RegExp
  weight: number
}

const SENSITIVE_PATTERNS: SensitivePattern[] = [
  { name: 'privateKey', regex: /-----BEGIN\s(?:RSA\s)?PRIVATE\sKEY-----/, weight: 3 },
  { name: 'chinaIdCard', regex: /\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/, weight: 2 },
  { name: 'apiKey', regex: /\b(?:sk-|api[_-]?key|access[_-]?token|secret[_-]?key)\s*[=:]\s*['"]?[\w-]{16,}['"]?/i, weight: 2 },
  { name: 'awsKey', regex: /\bAKIA[0-9A-Z]{16}\b/, weight: 2 },
  { name: 'jwt', regex: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/, weight: 2 },
  { name: 'chinaPhone', regex: /\b1[3-9]\d{9}\b/, weight: 1 },
  { name: 'creditCard', regex: /\b(?:\d[ -]*?){13,19}\b/, weight: 1 },
  { name: 'password', regex: /(?:password|passwd|pwd|密码)\s*[=:]\s*\S{3,}/i, weight: 1 },
]

const MIN_CONFIDENCE = 2

/** 检测内容是否包含敏感数据 */
export function detectSensitive(content: string): boolean {
  if (!content || content.trim().length === 0) return false
  let score = 0
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.regex.test(content)) {
      score += pattern.weight
      if (score >= MIN_CONFIDENCE) return true
    }
  }
  return false
}

/** 对敏感内容进行脱敏处理 */
export function maskSensitive(content: string): string {
  if (!content) return content

  // API Key / Token 类：保留前缀和最后 4 位
  content = content.replace(
    /\b((?:sk-|api[_-]?key|access[_-]?token|secret[_-]?key)\s*[=:]\s*['"]?)([\w-]{4})[\w-]{8,}([\w-]{4})(['"]?)/gi,
    (_, prefix, start, end, suffix) => `${prefix}${start}${'*'.repeat(8)}${end}${suffix}`,
  )

  // JWT: 保留 header 前 10 位，其余掩码
  content = content.replace(
    /\b(eyJ[a-zA-Z0-9_-]{6})[a-zA-Z0-9_-]{4,}(\.[a-zA-Z0-9_-]+){2}\b/g,
    (_, head) => `${head}${'*'.repeat(12)}.***`,
  )

  // 中国身份证号：保留前 3 后 4 位
  content = content.replace(
    /\b([1-9]\d{2})\d{11,13}([\dXx]{4})\b/g,
    (_, head, tail) => `${head}${'*'.repeat(11)}${tail}`,
  )

  // 手机号：保留前 3 后 4 位
  content = content.replace(
    /\b(1[3-9]\d)\d{4}(\d{4})\b/g,
    (_, head, tail) => `${head}****${tail}`,
  )

  // AWS Key：保留前 4 后 4 位
  content = content.replace(
    /\b(AKIA)([0-9A-Z]{12})([0-9A-Z]{4})\b/g,
    (_, head, mid, tail) => `${head}${'*'.repeat(12)}${tail}`,
  )

  return content
}
