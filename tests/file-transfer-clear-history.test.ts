import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileTransferServer } from '../electron/file-transfer/server'

function createServer(root = '.') {
  return new FileTransferServer({
    getTransfersDir: () => root, getTempDir: () => root, getClipboardText: () => '',
    getColorMode: () => 'system', getLogoBase64: () => '', onReceiveText: () => {},
    onFileReceived: () => {}, onStatusChange: () => {}, onDevicesChange: () => {}, onMessage: () => {},
  })
}

describe('清除本机文件传输聊天记录', () => {
  it('清空历史且可重复清空，之后正常收发并保持消息编号递增', () => {
    const server = createServer()
    const first = server.sendChatText('旧消息')
    server.sendChatText('另一条旧消息')
    server.clearChatHistory()
    server.clearChatHistory()
    expect(server.getChatHistory()).toEqual([])
    const next = server.sendChatText('新消息')
    expect(next.id).toBeGreaterThan(first.id + 1)
    expect(server.getChatHistory().map((msg) => msg.content)).toEqual(['新消息'])
  })
  it('不删除文件、不失效已有下载地址，手机旧游标仍能读到新消息', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qpaste-clear-history-'))
    const file = join(root, 'keep.txt')
    writeFileSync(file, '保留文件')
    const server = createServer(root)
    try {
      const port = await server.start(18869, false, { host: '127.0.0.1' })
      const url = server.getDownloadUrl(file)
      const last = server.sendChatText('清空前')
      server.clearChatHistory()
      server.sendChatText('清空后')
      const messages = await (await fetch(`http://127.0.0.1:${port}/poll?last_id=${last.id}`)).json()
      expect(messages.map((msg: { content: string }) => msg.content)).toEqual(['清空后'])
      expect(await (await fetch(`http://127.0.0.1:${port}${url}`)).text()).toBe('保留文件')
      expect(readFileSync(file, 'utf8')).toBe('保留文件')
      expect(server.status.enabled).toBe(true)
    } finally {
      server.stop()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
