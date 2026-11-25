export interface DetectedColor {
  raw: string
  cssColor: string
  hex: string
  rgb: string
  hsl: string
  alpha: number
  isDark: boolean
}

export interface DetectedTimestamp {
  raw: string
  unit: 's' | 'ms'
  ms: number
  localFormatted: string
  isoUtc: string
  relative: string
}

export interface DetectedJson {
  parsed: unknown
  formatted: string
  minified: string
  kind: 'object' | 'array'
  entryCount: number
}

export interface SmartInspection {
  color: DetectedColor | null
  timestamp: DetectedTimestamp | null
  json: DetectedJson | null
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function clampAlpha(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function toHex2(n: number): string {
  return clampByte(n).toString(16).padStart(2, '0')
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, Math.round(l * 100)]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = ((h % 360) + 360) % 360
  const sn = Math.max(0, Math.min(100, s)) / 100
  const ln = Math.max(0, Math.min(100, l)) / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1))
  const m = ln - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (hn < 60) [r, g, b] = [c, x, 0]
  else if (hn < 120) [r, g, b] = [x, c, 0]
  else if (hn < 180) [r, g, b] = [0, c, x]
  else if (hn < 240) [r, g, b] = [0, x, c]
  else if (hn < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [clampByte((r + m) * 255), clampByte((g + m) * 255), clampByte((b + m) * 255)]
}

function buildDetectedColor(raw: string, r: number, g: number, b: number, alpha = 1): DetectedColor {
  const cr = clampByte(r)
  const cg = clampByte(g)
  const cb = clampByte(b)
  const a = clampAlpha(alpha)
  const hasAlpha = a < 0.999
  const hexBase = `#${toHex2(cr)}${toHex2(cg)}${toHex2(cb)}`
  const hex = hasAlpha ? `${hexBase}${toHex2(a * 255)}` : hexBase
  const alphaStr = Number(a.toFixed(2)).toString()
  const rgb = hasAlpha ? `rgba(${cr}, ${cg}, ${cb}, ${alphaStr})` : `rgb(${cr}, ${cg}, ${cb})`
  const [h, s, l] = rgbToHsl(cr, cg, cb)
  const hsl = hasAlpha ? `hsla(${h}, ${s}%, ${l}%, ${alphaStr})` : `hsl(${h}, ${s}%, ${l}%)`
  const luminance = (0.299 * cr + 0.587 * cg + 0.114 * cb) / 255
  return {
    raw,
    cssColor: rgb,
    hex,
    rgb,
    hsl,
    alpha: a,
    isDark: luminance < 0.55,
  }
}

function parseAlphaToken(token: string | undefined): number | null {
  if (!token) return 1
  const trimmed = token.trim()
  if (trimmed.endsWith('%')) {
    const pct = Number(trimmed.slice(0, -1))
    return Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct / 100 : null
  }
  const num = Number(trimmed)
  return Number.isFinite(num) && num >= 0 && num <= 1 ? num : null
}

/** 识别单个颜色值：#RGB / #RGBA / #RRGGBB / #RRGGBBAA / rgb() / rgba() / hsl() / hsla() */
export function detectColor(text: string): DetectedColor | null {
  const raw = text.trim()
  if (!raw || raw.length > 64 || raw.includes('\n')) return null

  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(raw)
  if (hexMatch) {
    const h = hexMatch[1]
    if (h.length === 3 || h.length === 4) {
      const r = parseInt(h[0] + h[0], 16)
      const g = parseInt(h[1] + h[1], 16)
      const b = parseInt(h[2] + h[2], 16)
      const a = h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1
      return buildDetectedColor(raw, r, g, b, a)
    }
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    return buildDetectedColor(raw, r, g, b, a)
  }

  const rgbMatch = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/i.exec(raw)
  if (rgbMatch) {
    const r = Number(rgbMatch[1])
    const g = Number(rgbMatch[2])
    const b = Number(rgbMatch[3])
    const a = parseAlphaToken(rgbMatch[4])
    if (r > 255 || g > 255 || b > 255 || a === null) return null
    return buildDetectedColor(raw, r, g, b, a)
  }

  const hslMatch = /^hsla?\(\s*(-?\d+(?:\.\d+)?)(?:deg)?\s*[, ]\s*(\d{1,3}(?:\.\d+)?)%\s*[, ]\s*(\d{1,3}(?:\.\d+)?)%(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/i.exec(raw)
  if (hslMatch) {
    const h = Number(hslMatch[1])
    const s = Number(hslMatch[2])
    const l = Number(hslMatch[3])
    const a = parseAlphaToken(hslMatch[4])
    if (s > 100 || l > 100 || a === null) return null
    const [r, g, b] = hslToRgb(h, s, l)
    return buildDetectedColor(raw, r, g, b, a)
  }

  return null
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatLocalDateTime(date: Date, includeMs: boolean): string {
  const base = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  if (!includeMs) return base
  return `${base}.${String(date.getMilliseconds()).padStart(3, '0')}`
}

function formatRelativeOffset(ms: number, nowMs: number): string {
  const diffSec = Math.round((nowMs - ms) / 1000)
  const abs = Math.abs(diffSec)
  const suffix = diffSec >= 0 ? '前' : '后'
  if (abs < 5) return '刚刚'
  if (abs < 60) return `${abs} 秒${suffix}`
  const mins = Math.floor(abs / 60)
  if (mins < 60) return `${mins} 分钟${suffix}`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时${suffix}`
  const days = Math.floor(hours / 24)
  if (days < 365) return `${days} 天${suffix}`
  const years = (days / 365).toFixed(1).replace(/\.0$/, '')
  return `${years} 年${suffix}`
}

/** 识别 10 位秒级或 13 位毫秒级 Unix 时间戳（1990–2100 合理区间，避免误识别普通编号） */
export function detectTimestamp(text: string, nowMs = Date.now()): DetectedTimestamp | null {
  const raw = text.trim()
  if (!/^\d{10}(\d{3})?$/.test(raw)) return null
  const unit: 's' | 'ms' = raw.length === 13 ? 'ms' : 's'
  const num = Number(raw)
  const ms = unit === 's' ? num * 1000 : num
  // 限定 1990-01-01 ~ 2100-01-01，过滤常见 10/13 位订单号/手机号/条码
  const MIN_MS = Date.UTC(1990, 0, 1)
  const MAX_MS = Date.UTC(2100, 0, 1)
  if (!Number.isFinite(ms) || ms < MIN_MS || ms > MAX_MS) return null
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return null
  return {
    raw,
    unit,
    ms,
    localFormatted: formatLocalDateTime(date, unit === 'ms' && date.getMilliseconds() !== 0),
    isoUtc: date.toISOString(),
    relative: formatRelativeOffset(ms, nowMs),
  }
}

const MAX_JSON_INSPECT_LENGTH = 512 * 1024

/** 识别合法的 JSON 对象或数组（支持格式化/压缩/树形折叠） */
export function detectJson(text: string): DetectedJson | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > MAX_JSON_INSPECT_LENGTH) return null
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if (!((first === '{' && last === '}') || (first === '[' && last === ']'))) {
    return null
  }
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed === null || typeof parsed !== 'object') return null
    const isArr = Array.isArray(parsed)
    return {
      parsed,
      formatted: JSON.stringify(parsed, null, 2),
      minified: JSON.stringify(parsed),
      kind: isArr ? 'array' : 'object',
      entryCount: isArr ? parsed.length : Object.keys(parsed as Record<string, unknown>).length,
    }
  } catch {
    return null
  }
}

export function inspectClipboardText(text: string, nowMs = Date.now()): SmartInspection {
  if (!text || !text.trim()) {
    return { color: null, timestamp: null, json: null }
  }
  const color = detectColor(text)
  if (color) return { color, timestamp: null, json: null }
  const timestamp = detectTimestamp(text, nowMs)
  if (timestamp) return { color: null, timestamp, json: null }
  const json = detectJson(text)
  return { color: null, timestamp: null, json }
}
