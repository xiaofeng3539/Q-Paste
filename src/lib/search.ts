import { pinyin } from 'pinyin-pro'

/** 提取字符串的拼音首字母缩写（小写），如 "历史记录" -> "lsjl" */
export function pinyinAbbr(text: string): string {
  return pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' })
    .map((s) => s[0].toLowerCase())
    .join('')
}

/** 提取字符串的完整拼音（小写，不带声调），如 "历史" -> "lishi" */
export function pinyinFull(text: string): string {
  return pinyin(text, { toneType: 'none', type: 'array' })
    .map((s) => s.toLowerCase())
    .join('')
}

/** 在 text 中查找 query（支持子串 / 拼音首字母 / 全拼音），返回命中起始下标；未命中返回 -1（大小写不敏感） */
export function searchIndexOf(text: string, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q || !text) return -1
  const lower = text.toLowerCase()
  // 1. 直接子串匹配
  let idx = lower.indexOf(q)
  if (idx !== -1) return idx
  // 2. 拼音匹配（仅当查询含字母时）
  if (/[a-z]/.test(q)) {
    const full = pinyinFull(text)
    idx = full.indexOf(q)
    if (idx !== -1) return idx
    const abbr = pinyinAbbr(text)
    return abbr.indexOf(q)
  }
  return -1
}

/** 判断 text 是否命中 query（子串 / 拼音） */
export function searchIncludes(text: string, query: string): boolean {
  return searchIndexOf(text, query) !== -1
}

export interface HighlightSegment {
  text: string
  hit: boolean
}

/** 把 text 按命中片段切分，供渲染层高亮（返回所有命中片段的合并，命中的连续片段合并为一段） */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const q = query.trim()
  if (!q || !text) return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const ql = q.toLowerCase()
  const segments: HighlightSegment[] = []
  let i = 0
  while (i <= text.length) {
    const idx = lower.indexOf(ql, i)
    if (idx === -1) {
      const rest = text.slice(i)
      if (rest) segments.push({ text: rest, hit: false })
      break
    }
    if (idx > i) segments.push({ text: text.slice(i, idx), hit: false })
    segments.push({ text: text.slice(idx, idx + q.length), hit: true })
    i = idx + q.length
  }
  return segments.length ? segments : [{ text, hit: false }]
}
