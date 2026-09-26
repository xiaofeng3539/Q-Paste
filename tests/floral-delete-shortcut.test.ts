import { describe, expect, it } from 'vitest'
import { getDeleteShortcutAction } from '../vendor/floral-notepaper/src/features/notes/deleteShortcut'

function keyEvent(key: string, modifiers: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'repeat'>> = {}): KeyboardEvent {
  return { key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false, ...modifiers } as KeyboardEvent
}

describe('花笺共享 Q-Paste 删除快捷键', () => {
  it('第一次按配置的删除键打开确认，第二次确认删除', () => {
    expect(getDeleteShortcutAction(keyEvent('d'), 'D', false, false)).toBe('request-confirmation')
    expect(getDeleteShortcutAction(keyEvent('D'), 'D', true, false)).toBe('confirm-delete')
  })

  it('组合键必须与 Q-Paste 配置匹配', () => {
    expect(getDeleteShortcutAction(keyEvent('Delete', { ctrlKey: true }), 'Ctrl+Delete', false, false)).toBe('request-confirmation')
    expect(getDeleteShortcutAction(keyEvent('Delete'), 'Ctrl+Delete', false, false)).toBeNull()
  })

  it('正在输入时不触发删除', () => {
    expect(getDeleteShortcutAction(keyEvent('d'), 'D', false, true)).toBeNull()
  })

  it('按住删除键产生的重复事件不会越过确认步骤', () => {
    expect(getDeleteShortcutAction(keyEvent('d', { repeat: true }), 'D', true, false)).toBeNull()
  })
})
