import { describe, it, expect } from 'vitest'
import { FileTransferServer } from '../electron/file-transfer/server'

describe('新增功能端点', () => {
  it('/api/clipboard 直连返回电脑剪贴板内容', async () => {
    let clip = '电脑端的文本'
    const server = new FileTransferServer({
      getSaveDir: () => process.env.TEMP ?? '.', getColorMode: () => 'system',
      getLogoBase64: () => '', getClipboardText: () => clip,
      onReceiveText: () => {}, onFileReceived: () => {}, onStatusChange: () => {}, onDevicesChange: () => {}, onMessage: () => {},
    })
    const port = await server.start(18871, false, { host: '127.0.0.1' })
    const ok = await fetch(`http://127.0.0.1:${port}/api/clipboard`)
    const data = await ok.json()
    expect(ok.status).toBe(200)
    expect(data.content).toBe('电脑端的文本')
    clip = '更新后的内容'
    const ok2 = await fetch(`http://127.0.0.1:${port}/api/clipboard`)
    expect((await ok2.json()).content).toBe('更新后的内容')
    server.stop()
  })

  it('手机页面：无配对码遮罩，含拉取按钮与核心功能', async () => {
    const server = new FileTransferServer({
      getSaveDir: () => process.env.TEMP ?? '.', getColorMode: () => 'system',
      getLogoBase64: () => '', getClipboardText: () => '',
      onReceiveText: () => {}, onFileReceived: () => {}, onStatusChange: () => {}, onDevicesChange: () => {}, onMessage: () => {},
    })
    const port = await server.start(18872, false)
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text()
    expect(html).not.toContain('pin-mask')
    expect(html).toContain('id="fetch-clip"')
    expect(html).toContain('/api/clipboard')
    expect(html).toContain('/upload-chunk')
    expect(html).toContain('Q-Paste 终端')
    server.stop()
  })
})
