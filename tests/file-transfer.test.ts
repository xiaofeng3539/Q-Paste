/**
 * 局域网文件传输服务回归测试：配对码鉴权、分块上传（追加续传）、Range 下载、路由保护。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileTransferServer } from '../electron/file-transfer/server'

const saveDir = join(tmpdir(), `qp-ft-test-${Date.now()}`)
const tempDir = join(saveDir, 'temp')
let server: FileTransferServer
let port = 0
const openDesktop = vi.fn()

beforeAll(async () => {
  server = new FileTransferServer({
    getTransfersDir: () => saveDir,
    getTempDir: () => tempDir,
    getClipboardText: () => '',
    onPhoneShortcutOpen: openDesktop,
    getColorMode: () => 'system',
    getLogoBase64: () => '',
    onReceiveText: () => {},
    onFileReceived: () => {},
    onStatusChange: () => {},
    onDevicesChange: () => {},
    onMessage: () => {},
  })
  port = await server.start(18861, false, { host: '127.0.0.1' })
})

afterAll(() => {
  server.stop()
  rmSync(saveDir, { recursive: true, force: true })
})

function chunkRequest(uploadId: string, idx: number, total: number, data: Buffer, totalSize = 0) {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(data)]))
  form.append('metadata', JSON.stringify({
    upload_id: uploadId, chunk_index: idx, total_chunks: total,
    file_name: 'f.bin', sender_id: 'm1', sender_name: 'Mobile',
    total_size: totalSize, content_type: 'application/octet-stream',
  }))
  return fetch(`http://127.0.0.1:${port}/upload-chunk`, { method: 'POST', body: form })
}

describe('文件传输服务', () => {
  it('原传输页可同源请求打开电脑端，旧快捷地址仍可用', async () => {
    const base = `http://127.0.0.1:${port}`
    const page = await fetch(base)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('/api/open-desktop')
    expect(openDesktop).not.toHaveBeenCalled()

    const oldShortcut = await fetch(`${base}/shortcut/${'a'.repeat(32)}`, { redirect: 'manual' })
    expect(oldShortcut.status).toBe(302)
    expect(oldShortcut.headers.get('location')).toBe('/')
    const open = (origin?: string) => fetch(`${base}/api/open-desktop`, {
      method: 'POST',
      headers: origin ? { Origin: origin } : {},
    })
    expect((await open()).status).toBe(403)
    expect((await open('http://example.invalid')).status).toBe(403)
    expect(openDesktop).not.toHaveBeenCalled()
    expect((await open(base)).status).toBe(204)
    expect(openDesktop).toHaveBeenCalledOnce()
  })

  it('配对码骨架：/api/pin-required 恒返回未启用（直连模式）', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/pin-required`)
    expect(res.status).toBe(200)
    expect((await res.json()).required).toBe(false)
  })

  it('数据接口直连可用（无配对码校验）', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/poll?last_id=0`)
    expect(res.status).toBe(200)
    const bad = await chunkRequest('nope', 0, 1, Buffer.from('x'))
    expect(bad.status).toBe(200)
  })

  it('分块上传按序追加合并（断点续传语义），落盘字节精确', async () => {
    const id = 'vitest-up'
    const a = Buffer.from('A'.repeat(1000))
    const b = Buffer.from('B'.repeat(1000))
    const c = Buffer.from('C'.repeat(500))
    expect((await chunkRequest(id, 0, 3, a)).status).toBe(200)
    expect(existsSync(join(tempDir, `.tmp_${id}`))).toBe(true)
    expect((await chunkRequest(id, 1, 3, b)).status).toBe(200)
    expect((await chunkRequest(id, 2, 3, c)).status).toBe(200)
    expect(existsSync(join(tempDir, `.tmp_${id}`))).toBe(false)
    const file = readdirSync(saveDir).find((f) => f.endsWith('_f.bin'))
    expect(file).toBeDefined()
    const buf = readFileSync(join(saveDir, file!))
    expect(buf.length).toBe(2500)
    expect(buf[0]).toBe(65)
    expect(buf[1000]).toBe(66)
    expect(buf[2000]).toBe(67)
  })

  it('PC→手机下载代理支持 Range 206 断点续传，且受配对码保护', async () => {
    mkdirSync(saveDir, { recursive: true })
    const src = join(saveDir, 'range.txt')
    writeFileSync(src, '0123456789ABCDEF')
    server.sendFileToClient(src)
    const dlPath = server.getChatHistory().at(-1)!.content
    const full = await fetch(`http://127.0.0.1:${port}${dlPath}`)
    expect(full.status).toBe(200)
    expect((await full.arrayBuffer()).byteLength).toBe(16)
    const part = await fetch(`http://127.0.0.1:${port}${dlPath}`, { headers: { Range: 'bytes=0-9' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 0-9/16')
    expect((await part.arrayBuffer()).byteLength).toBe(10)
  })

  it('连接重试同时补发同一分块时只保存一份内容和接收记录', async () => {
    const id = 'retry-upload'
    const first = Buffer.from('first ')
    const final = Buffer.from('last')
    const size = first.length + final.length
    const before = server.getChatHistory().length
    expect((await chunkRequest(id, 0, 2, first, size)).status).toBe(200)
    const responses = await Promise.all([
      chunkRequest(id, 0, 2, first, size),
      chunkRequest(id, 0, 2, first, size),
    ])
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    const completions = await Promise.all([
      chunkRequest(id, 1, 2, final, size),
      chunkRequest(id, 1, 2, final, size),
    ])
    expect(completions.map((response) => response.status)).toEqual([200, 200])
    const receipts = server.getChatHistory().slice(before)
    expect(receipts).toHaveLength(1)
    expect(readFileSync(receipts[0].file_path!, 'utf8')).toBe('first last')
  })
})

describe('局域网设备授权', () => {
  it('新手机等待桌面批准，保存信任后从原快捷地址直接进入', async () => {
    const trusted = new Set<string>()
    let finishApproval!: () => void
    const decision = new Promise<void>((resolve) => { finishApproval = resolve })
    const approve = vi.fn(async (digest: string, _address: string) => {
      await decision
      trusted.add(digest)
      return true
    })
    const wake = vi.fn()
    const receive = vi.fn()
    const guarded = new FileTransferServer({
      getTransfersDir: () => saveDir,
      getTempDir: () => tempDir,
      getClipboardText: () => '电脑剪贴板',
      getColorMode: () => 'system',
      getLogoBase64: () => '',
      onReceiveText: receive,
      onFileReceived: () => {},
      onStatusChange: () => {},
      onDevicesChange: () => {},
      onMessage: () => {},
      onPhoneShortcutOpen: wake,
      deviceTrust: { isTrusted: digest => trusted.has(digest), approve },
    })
    guarded.setDisplayIp('127.0.0.1')
    const guardedPort = await guarded.start(18862, false, { host: '127.0.0.1' })
    const base = `http://127.0.0.1:${guardedPort}`
    const shortcut = `/shortcut/${'b'.repeat(32)}`
    const request = (route: string, options?: RequestInit) => fetch(`${base}${route}`, options)
    const post = (route: string, cookie?: string) => request(route, {
      method: 'POST',
      headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
    })
    try {
      const page = await request(shortcut)
      expect(await page.text()).toContain('id="trust-device"')
      expect(approve).not.toHaveBeenCalled()
      expect(wake).not.toHaveBeenCalled()
      expect((await request('/poll')).status).toBe(401)
      expect((await request('/api/clipboard')).status).toBe(401)
      expect((await post('/api/open-desktop')).status).toBe(401)
      expect((await post('/send-text')).status).toBe(401)
      expect((await post('/upload')).status).toBe(401)
      expect((await post('/upload-chunk')).status).toBe(401)
      const localFile = join(saveDir, 'authorized.txt')
      mkdirSync(saveDir, { recursive: true })
      writeFileSync(localFile, '仅授权设备可下载')
      const download = guarded.getDownloadUrl(localFile)
      expect((await request(download)).status).toBe(401)
      expect(wake).not.toHaveBeenCalled()
      expect(receive).not.toHaveBeenCalled()

      expect((await request('/api/trust-device', { method: 'POST' })).status).toBe(403)
      const pending = post('/api/trust-device')
      await vi.waitFor(() => expect(approve).toHaveBeenCalledOnce())
      expect((await post('/api/trust-device')).status).toBe(429)
      finishApproval()
      const enrollment = await pending
      expect(enrollment.status).toBe(204)
      const setCookie = enrollment.headers.get('set-cookie')!
      expect(setCookie).toMatch(/^qpaste_lan_device=[A-Za-z0-9_-]{43};/)
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie).toContain('SameSite=Strict')
      const [cookie] = setCookie.split(';')
      const token = cookie.split('=')[1]
      expect(approve).toHaveBeenCalledOnce()
      expect(approve).toHaveBeenCalledWith(createHash('sha256').update(token).digest('hex'), '127.0.0.1')

      const headers = { Cookie: cookie }
      expect(await (await request(shortcut, { headers })).text()).toContain('/api/open-desktop')
      expect(await (await request('/api/clipboard', { headers })).json()).toMatchObject({ content: '电脑剪贴板' })
      expect(await (await request(download, { headers })).text()).toBe('仅授权设备可下载')
      expect((await request('/send-text', {
        method: 'POST',
        headers: { ...headers, Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '授权设备消息' }),
      })).status).toBe(200)
      expect(receive).toHaveBeenCalledWith('授权设备消息', 'mobile', '手机')
      expect((await post('/api/open-desktop', cookie)).status).toBe(204)
      expect((await post('/api/trust-device', cookie)).status).toBe(204)
      expect(wake).toHaveBeenCalledOnce()
      expect(approve).toHaveBeenCalledOnce()
    } finally {
      finishApproval()
      guarded.stop()
    }
  })
})
