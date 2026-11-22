/**
 * WebDAV 云同步引擎回归测试：空目录自举、增量推拉、大内容 blob 旁路、删除墓碑。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SyncEngine } from '../src/main/sync/SyncEngine'
import { computeContentHash } from '../src/main/sync/SyncEngine'

const unreadableFiles = new Set<string>()

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
        if (files.has(url) && !unreadableFiles.has(url)) return done(200, files.get(url) as Buffer)
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

function mkEngine(deviceId: string, stateDir: string, basePath = 'qpaste-sync'): Promise<SyncEngine> {
  const e = new SyncEngine()
  e.onPulled = () => {}
  return e.init({
    enabled: true,
    webdavUrl: 'http://127.0.0.1:18862/dav',
    username: 'u', password: 'p',
    basePath, deviceId, intervalSecs: 0,
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

function opPath(deviceId: string, seq: number): string {
  return `ops/${deviceId}__${String(seq).padStart(20, '0')}.json`
}

function opBatch(deviceId: string, seq: number, content: string) {
  return {
    deviceId, seq, uploadedAt: Date.now(),
    entries: [{ ...mkItem(content, deviceId), contentBlobHash: null, htmlBlobHash: null }],
  }
}

describe('WebDAV 云同步引擎', () => {
  let srv: http.Server
  let stateDir: string
  let a: SyncEngine
  let b: SyncEngine

  beforeEach(async () => {
    srv = createDavMock()
    await new Promise<void>((r) => srv.listen(18862, '127.0.0.1', r))
    stateDir = mkdtempSync(join(tmpdir(), 'qp-sync-test-'))
    a = await mkEngine('devA', stateDir)
    b = await mkEngine('devB', stateDir)
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => srv.close(() => resolve()))
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

  it('replays the same remote item after the host rejects durable storage', async () => {
    const source = await mkEngine('callback-source', stateDir)
    const peer = await mkEngine('callback-peer', stateDir)
    await source.pushItem(mkItem('callback-retry'))
    peer.onPulled = () => { throw new Error('database commit failed') }
    await expect(peer.pullChanges(0)).rejects.toThrow()
    expect(peer.status.lastSyncAt).toBeNull()
    expect(peer.status.receivedItems).toBe(0)

    const restarted = await mkEngine('callback-peer', stateDir)
    expect((await restarted.pullChanges(0)).map((item) => item.content)).toContain('callback-retry')
  })

  it('keeps the in-memory cursor retryable when saving the state file fails', async () => {
    const source = await mkEngine('save-source', stateDir)
    const peer = await mkEngine('save-peer', stateDir)
    await source.pushItem(mkItem('state-save-retry'))
    const statePath = join(stateDir, 'save-peer.json')
    mkdirSync(statePath)
    const applied: string[] = []
    peer.onPulled = (items) => { applied.push(...items.map((item) => item.content)) }
    try {
      await expect(peer.pullChanges(0)).rejects.toThrow()
      expect(applied).toContain('state-save-retry')
      expect(peer.status.lastSyncAt).toBeNull()
    } finally {
      rmSync(statePath, { force: true, recursive: true })
    }
    expect((await peer.pullChanges(0)).map((item) => item.content)).toContain('state-save-retry')
  })

  it('applies late batches even when their entry timestamps precede the last sync', async () => {
    const source = await mkEngine('late-source', stateDir)
    const peer = await mkEngine('late-peer', stateDir)
    await peer.pullChanges(0)
    await source.pushItem({ ...mkItem('late-entry'), createdAt: 100, updatedAt: 100 })
    expect((await peer.pullChanges(peer.status.lastSyncAt!)).map((item) => item.content)).toContain('late-entry')
  })

  it.each(['unlisted', 'unreadable', 'invalid JSON', 'wrong device', 'wrong seq', 'invalid entry'])(
    'waits for an earlier %s batch while applying other devices',
    async (failure) => {
      const id = `retry-${failure.replace(/ /g, '-')}`
      const peer = await mkEngine(`${id}-peer`, stateDir)
      const invalidBatch = opBatch(id, 1, `${id}-first`)
      let body = JSON.stringify(invalidBatch)
      if (failure === 'invalid JSON') body = '{'
      if (failure === 'wrong device') body = JSON.stringify({ ...invalidBatch, deviceId: 'different-device' })
      if (failure === 'wrong seq') body = JSON.stringify({ ...invalidBatch, seq: 8 })
      if (failure === 'invalid entry') body = JSON.stringify({ ...invalidBatch, entries: [{ ...invalidBatch.entries[0], type: 'invalid' }] })
      const firstPath = opPath(id, 1)
      const remoteFirst = `/dav/qpaste-sync/${firstPath}`
      if (failure !== 'unlisted') await a.uploadFile(firstPath, Buffer.from(body))
      if (failure === 'unreadable') unreadableFiles.add(remoteFirst)
      await a.uploadFile(opPath(id, 2), Buffer.from(JSON.stringify(opBatch(id, 2, `${id}-second`))))
      await a.uploadFile(opPath(`${id}-other`, 1), Buffer.from(JSON.stringify(opBatch(`${id}-other`, 1, `${id}-independent`))))
      const applied: string[] = []
      peer.onPulled = (items) => { applied.push(...items.map((item) => item.content)) }

      try {
        await expect(peer.pullChanges(0)).rejects.toThrow()
        expect(applied).toContain(`${id}-independent`)
        expect(applied).not.toContain(`${id}-first`)
        expect(applied).not.toContain(`${id}-second`)
      } finally {
        unreadableFiles.delete(remoteFirst)
        await a.uploadFile(firstPath, Buffer.from(JSON.stringify(invalidBatch)))
      }

      const retried = (await peer.pullChanges(0)).map((item) => item.content)
      expect(retried).toEqual(expect.arrayContaining([`${id}-first`, `${id}-second`]))
      expect(retried).not.toContain(`${id}-independent`)
    },
  )

  it('retries a blob whose contents do not match its address', async () => {
    const source = await mkEngine('blob-source', stateDir)
    const peer = await mkEngine('blob-peer', stateDir)
    const content = 'blob body'.repeat(2048)
    await source.pushItem(mkItem(content))
    const hash = computeContentHash(content)
    const path = `blobs/${hash.slice(0, 2)}/content_${hash}.blob`
    await source.uploadFile(path, Buffer.from('corrupted'))
    try {
      await expect(peer.pullChanges(0)).rejects.toThrow()
    } finally {
      await source.uploadFile(path, Buffer.from(content))
    }
    expect((await peer.pullChanges(0)).map((item) => item.content)).toContain(content)
  })

  it('publishes simultaneous incremental and bulk pushes with distinct sequences', async () => {
    const source = await mkEngine('concurrent-source', stateDir)
    const peer = await mkEngine('concurrent-peer', stateDir)
    await Promise.all([
      source.pushItem(mkItem('concurrent-incremental-1')),
      source.pushAll([mkItem('concurrent-bulk')]),
      source.pushItem(mkItem('concurrent-incremental-2')),
    ])
    const contents = (await peer.pullChanges(0)).map((item) => item.content)
    expect(contents).toEqual(expect.arrayContaining([
      'concurrent-incremental-1', 'concurrent-bulk', 'concurrent-incremental-2',
    ]))
  })

  it.each(['in the same engine', 'after restart'])(
    'preserves a published batch %s after saving the sequence fails',
    async (resume) => {
      const source = await mkEngine('push-save-source', stateDir)
      const peer = await mkEngine('push-save-peer', stateDir)
      const statePath = join(stateDir, 'push-save-source.json')
      mkdirSync(statePath)
      try {
        await expect(source.pushItem(mkItem('published-before-save-failed'))).rejects.toThrow()
      } finally {
        rmSync(statePath, { force: true, recursive: true })
      }
      const resumed = resume === 'after restart' ? await mkEngine('push-save-source', stateDir) : source
      await resumed.pushItem(mkItem('published-next'))
      expect((await peer.pullChanges(0)).map((item) => item.content)).toEqual(expect.arrayContaining([
        'published-before-save-failed', 'published-next',
      ]))
    },
  )

  it('resets operation cursors and sequences when changing the WebDAV destination', async () => {
    await a.pushItem(mkItem('first-destination'))
    await b.pullChanges(0)

    const movedSource = await mkEngine('devA', stateDir, 'second destination')
    const movedPeer = await mkEngine('devB', stateDir, 'second destination')
    await movedSource.pushItem(mkItem('second-destination'))
    expect((await movedPeer.pullChanges(0)).map((item) => item.content)).toEqual(['second-destination'])

    const returningSource = await mkEngine('devA', stateDir)
    await returningSource.pushItem(mkItem('returned-to-first'))
    expect((await b.pullChanges(0)).map((item) => item.content)).toEqual(['returned-to-first'])
  })
})
