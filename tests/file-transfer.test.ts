/**
 * 局域网文件传输服务回归测试：配对码鉴权、分块上传（追加续传）、Range 下载、路由保护。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileTransferServer } from '../electron/file-transfer/server'

const saveDir = join(tmpdir(), `qp-ft-test-${Date.now()}`)
let server: FileTransferServer
let port = 0

beforeAll(async () => {
  server = new FileTransferServer({
    getSaveDir: () => saveDir,
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

function chunkRequest(uploadId: string, idx: number, total: number, data: Buffer) {
  const form = new FormData()
  form.append('file', new Blob([data]))
  form.append('metadata', JSON.stringify({
    upload_id: uploadId, chunk_index: idx, total_chunks: total,
    file_name: 'f.bin', sender_id: 'm1', sender_name: 'Mobile',
    total_size: 0, content_type: 'application/octet-stream',
  }))
  return fetch(`http://127.0.0.1:${port}/upload-chunk`, { method: 'POST', body: form })
}

describe('文件传输服务', () => {
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
    expect(existsSync(join(saveDir, `.tmp_${id}`))).toBe(true)
    expect((await chunkRequest(id, 1, 3, b)).status).toBe(200)
    expect((await chunkRequest(id, 2, 3, c)).status).toBe(200)
    expect(existsSync(join(saveDir, `.tmp_${id}`))).toBe(false)
    const file = readdirSync(saveDir).find((f) => f.endsWith('_f.bin'))
    expect(file).toBeDefined()
    const buf = readFileSync(join(saveDir, file!))
    expect(buf.length).toBe(2500)
    expect(buf[0]).toBe(65)
    expect(buf[1000]).toBe(66)
    expect(buf[2000]).toBe(67)
  })

  it('PC→手机下载代理支持 Range 206 断点续传，且受配对码保护', async () => {
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
})

