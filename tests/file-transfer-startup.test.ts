import { describe, expect, it, vi } from 'vitest'
import { FileTransferServer } from '../electron/file-transfer/server'

function createServer() {
  return new FileTransferServer({
    getTransfersDir: () => '.',
    getTempDir: () => '.',
    getClipboardText: () => '',
    getColorMode: () => 'system',
    getLogoBase64: () => '',
    onReceiveText: () => {},
    onFileReceived: () => {},
    onStatusChange: () => {},
    onDevicesChange: () => {},
    onMessage: () => {},
  })
}

describe('文件传输服务启动', () => {
  it('并发启动只绑定一次端口', async () => {
    const transfer = createServer()
    let resolveBind!: () => void
    const binding = new Promise<void>((resolve) => { resolveBind = resolve })
    const listener = { on: () => listener, close: vi.fn() }
    const bind = vi.fn(async () => {
      await binding
      return { server: listener, port: 18888 }
    })
    ;(transfer as any).bindListener = bind

    const first = transfer.start(18888, false)
    const second = transfer.start(18888, false)
    resolveBind()
    try {
      expect(await Promise.all([first, second])).toEqual([18888, 18888])
      expect(bind).toHaveBeenCalledTimes(1)
    } finally {
      transfer.stop()
    }
  })

  it('启动期间关闭服务不会在绑定完成后重新变为在线', async () => {
    const transfer = createServer()
    let resolveBind!: () => void
    const binding = new Promise<void>((resolve) => { resolveBind = resolve })
    const listener = { on: () => listener, close: vi.fn() }
    ;(transfer as any).bindListener = async () => {
      await binding
      return { server: listener, port: 18888 }
    }

    const starting = transfer.start(18888, false)
    transfer.stop()
    resolveBind()
    await expect(starting).rejects.toThrow()
    expect(transfer.status.enabled).toBe(false)
    expect(listener.close).toHaveBeenCalledOnce()
  })
})
