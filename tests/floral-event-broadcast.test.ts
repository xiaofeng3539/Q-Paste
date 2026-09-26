import { describe, expect, it, vi } from 'vitest'
import { broadcastFloralEvent } from '../electron/floral/event-broadcast'

describe('花笺配置事件广播', () => {
  it('将配置变更发送给主窗口和所有仍打开的便签/磁贴窗口', () => {
    const mainWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } }
    const noteWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } }
    const destroyedWindow = { isDestroyed: () => true, webContents: { send: vi.fn() } }
    const payload = { surfaceFontSize: 18, tabIndentSize: 6 }

    broadcastFloralEvent([noteWindow, destroyedWindow], mainWindow, 'config-changed', payload)

    expect(mainWindow.webContents.send).toHaveBeenCalledWith('floral:event:config-changed', payload)
    expect(noteWindow.webContents.send).toHaveBeenCalledWith('floral:event:config-changed', payload)
    expect(destroyedWindow.webContents.send).not.toHaveBeenCalled()
  })
})
