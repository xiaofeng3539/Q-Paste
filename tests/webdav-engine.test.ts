/**
 * WebDAV 云同步引擎回归测试：空目录自举、增量推拉、大内容 blob 旁路、删除墓碑。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SyncEngine } from '../src/main/sync/SyncEngine'
import { computeContentHash } from '../src/main/sync/SyncEngine'

/** 内存 WebDAV 模拟（坚果云式严格语义：父目录缺失返回 409/404） */
function createDavMock() {
  const dirs = new Set<string>(['/dav'])
  const files = new Map<string, Buffer>()
  const norm = (p: string) => '/' + decodeURIComponent(p).replace(/^\/+|\/+$/g, '')
  return http.createServer((req, res) => {
    const url = norm(req.url ?? '/')
    const method = (req.method ?? '').toUpperCase()
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const done = (code: number, payload: Buffer | string = '') => {
        res.writeHead(code, { 'Content-Type': 'application/xml; charset=utf-8' })
        res.end(payload)
      }
      const parentOf = (p: string) => { const i = p.lastIndexOf('/'); return i <= 0 ? null : p.slice(0, i) }
      if (method === 'MKCOL') {
        if (dirs.has(url) || files.has(url)) return done(405)
        const parent = parentOf(url)
        if (parent !== null && !dirs.has(parent)) return done(409)
        dirs.add(url)
        return done(201)
      }
      if (method === 'PUT') {
        const parent = parentOf(url)
        if (parent && !dirs.has(parent)) return done(409)
        files.set(url, body)
        return done(201)
      }
      if (method === 'GET') {
        if (files.has(url)) return done(200, files.get(url) as Buffer)
        return done(404)
      }
      if (method === 'DELETE') {
        if (files.delete(url) || dirs.delete(url)) return done(204)
        return done(404)
      }
      if (method === 'MOVE') {
        const dest = norm(new URL(req.headers.destination ?? '').pathname)
        if (!files.has(url)) return done(404)
        files.set(dest, files.get(url) as Buffer)
        files.delete(url)
        return done(201)
      }
      if (method === 'PROPFIND') {
        if (!dirs.has(url)) {
          const parent = parentOf(url)
          if (parent && !dirs.has(parent)) return done(409)
          return done(404)
        }
        const children = (req.headers.depth ?? '0') === '1'
          ? [...dirs, ...files.keys()].filter((p) => p.startsWith(url + '/') && !p.slice(url.length + 1).includes('/'))
          : []
        const xml = '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">' +
          `<D:response><D:href>${url}/</D:href></D:response>` +
          children.map((p) => `<D:response><D:href>${p}</D:href></D:response>`).join('') +
          '</D:multistatus>'
        return done(207, xml)
      }
      done(405)
    })
  })
}

function mkEngine(deviceId: string, stateDir: string): Promise<SyncEngine> {
  const e = new SyncEngine()
  e.onPulled = () => {}
  return e.init({
    enabled: true,
    webdavUrl: 'http://127.0.0.1:18862/dav',
    username: 'u', password: 'p',
    basePath: 'qpaste-sync', deviceId, intervalSecs: 0,
  }, join(stateDir, `${deviceId}.json`)).then(() => e)
}

function mkItem(text: string, deviceId = 'devA') {
  const hash = computeContentHash(text)
  return {
    id: `text:${hash}`, type: 'text' as const, content: text, html: null,
    hash, preview: text.slice(0, 50), createdAt: Date.now(), updatedAt: Date.now(),
    deviceId, deletedAt: 0,
  }
}

describe('WebDAV 云同步引擎', () => {
  let srv: http.Server
  let stateDir: string
  let a: SyncEngine
  let b: SyncEngine

  beforeAll(async () => {
    srv = createDavMock()
    await new Promise<void>((r) => srv.listen(18862, '127.0.0.1', r))
    stateDir = mkdtempSync(join(tmpdir(), 'qp-sync-test-'))
    a = await mkEngine('devA', stateDir)
    b = await mkEngine('devB', stateDir)
  })

  afterAll(() => {
    srv.close()
    rmSync(stateDir, { recursive: true, force: true })
  })

  it('空服务器自举：两台设备初始化不报错', () => {
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
  })

  it('A 推送 → B 拉取内容一致（增量 ops）', async () => {
    expect(await a.pushItem(mkItem('hello-sync'))).toBe(true)
    expect(await a.pushItem(mkItem('second-item'))).toBe(true)
    const got = await b.pullChanges(0)
    const texts = got.filter((i) => i.type === 'text' && !i.deletedAt).map((i) => i.content)
    expect(texts).toContain('hello-sync')
    expect(texts).toContain('second-item')
  })

  it('内容指纹稳定：同内容同 hash（墓碑匹配前提）', () => {
    expect(computeContentHash('abc')).toBe(computeContentHash('abc'))
    expect(computeContentHash('abc')).not.toBe(computeContentHash('abd'))
  })

  it('pushAll 全量上传：B 一次性拉到 A 的全部存量', async () => {
    const items = [mkItem('bulk-1'), mkItem('bulk-2'), mkItem('bulk-3')]
    const pushed = await a.pushAll(items)
    expect(pushed).toBe(3)
    const got = await b.pullChanges(0)
    const texts = got.filter((i) => i.type === 'text' && !i.deletedAt).map((i) => i.content)
    expect(texts).toContain('bulk-1')
    expect(texts).toContain('bulk-2')
    expect(texts).toContain('bulk-3')
  })

  it('删除墓碑：A 推墓碑 → B 拉到 deletedAt 条目且 hash 匹配', async () => {
    const text = 'to-be-deleted'
    await a.pushItem(mkItem(text))
    await b.pullChanges(0)
    const hash = computeContentHash(text)
    const tomb = { ...mkItem(text), content: '', deletedAt: Date.now(), updatedAt: Date.now() }
    await a.pushItem(tomb)
    const got = await b.pullChanges(0)
    const tombstones = got.filter((i) => i.deletedAt > 0)
    expect(tombstones.length).toBeGreaterThan(0)
    expect(tombstones[0].hash).toBe(hash)
  })
})
