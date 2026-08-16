/**
 * 本地快捷键自定义
 * 支持动作：copy / delete / pin / prev / next / clearSearch
 * 每个动作可配置一个组合键（如 "Ctrl+P"、"D"、"W"），持久化到 localStorage。
 */

export type ShortcutAction =
  | 'copy'
  | 'delete'
  | 'pin'
  | 'prev'
  | 'next'
  | 'clearSearch'

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  copy: 'C',
  delete: 'D',
  pin: 'Ctrl+P',
  prev: 'W',
  next: 'S',
  clearSearch: 'Esc',
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  'copy',
  'delete',
  'pin',
  'prev',
  'next',
  'clearSearch',
]

const STORAGE_KEY = 'q-paste-shortcuts'

/** 从 localStorage 读取自定义快捷键（无效值回退默认） */
export function loadShortcuts(): Record<ShortcutAction, string> {
  const result = { ...DEFAULT_SHORTCUTS }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      for (const action of SHORTCUT_ACTIONS) {
        if (typeof parsed[action] === 'string' && parsed[action].trim()) {
          result[action] = parsed[action].trim()
        }
      }
    }
  } catch { /* 忽略损坏数据 */ }
  return result
}

/** 保存自定义快捷键 */
export function saveShortcuts(shortcuts: Record<ShortcutAction, string>): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts)) } catch { /* 忽略 */ }
}

/** 重置为默认 */
export function resetShortcuts(): Record<ShortcutAction, string> {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* 忽略 */ }
  return { ...DEFAULT_SHORTCUTS }
}

/** 把键盘事件与一个组合键字符串匹配（如 "Ctrl+P" / "D" / "Esc"） */
export function matchShortcut(e: KeyboardEvent, combo: string): boolean {
  if (!combo) return false
  const parts = combo.split('+').map((p) => p.trim())
  const keyPart = parts[parts.length - 1]
  const mods = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()))

  // 修饰键状态必须完全匹配
  if (mods.has('ctrl') !== e.ctrlKey) return false
  if (mods.has('alt') !== e.altKey) return false
  if (mods.has('shift') !== e.shiftKey) return false
  if (mods.has('meta') !== e.metaKey) return false

  // 主键匹配（大小写不敏感，特殊键名原样比较）
  const key = keyPart.length === 1 ? keyPart.toLowerCase() : keyPart
  const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key
  return key === eventKey
}
