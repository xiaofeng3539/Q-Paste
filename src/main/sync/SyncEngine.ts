import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import type {
  ClipboardSyncItem,
  CloudSyncStatus,
  SyncConfig,
  SyncState,
  WireOpBatch,
  WireSyncItem,
} from './types'
import {
  SYNC_INLINE_HTML_THRESHOLD_BYTES,
  SYNC_INLINE_TEXT_THRESHOLD_BYTES,
  SYNC_MAX_IMAGE_BYTES,
  SyncError,
} from './types'

const MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 600
const REQUEST_TIMEOUT_MS = 45_000
const BLOB_CACHE_MAX_ENTRIES = 5000
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])
const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8" ?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/></d:prop></d:propfind>'

/** 内容 SHA-256 指纹（图片针对完整 data URL 计算） */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 按段编码相对路径（保留 / 分隔，兼容中文/空格目录名） */
function encodeRelPath(relative: string): string {
  return relative
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg.trim() !== '')
    .map((seg) => encodeURIComponent(seg.trim()))
    .join('/')
}

function opsFileName(deviceId: string, seq: number): string {
  return `${deviceId}__${String(seq).padStart(20, '0')}.json`
}

export class SyncEngine {
  private cfg: SyncConfig | null = null
  private statePath = ''
  private state: SyncState = { localSeq: 0, opCursors: {}, pushedDigests: {}, blobCache: {} }
  private knownDirs = new Set<string>()
  private pullTimer: ReturnType<typeof setInterval> | null = null
  private pulling = false
  private ready = false

  status: CloudSyncStatus = {
    ready: false,
    lastSyncAt: null,
    lastError: null,
    uploadedItems: 0,
    receivedItems: 0,
  }

  /** 拉取到远端新条目时的回调（宿主负责入库并通知渲染层） */
  onPulled: (items: ClipboardSyncItem[]) => void | Promise<void> = () => {}

  /**
   * 初始化与鉴权配置：加载本地游标并确保远端目录就绪。
   * enabled=false 时仅记录配置，不发起任何网络请求。
   */
  async init(config: SyncConfig, statePath: string): Promise<void> {
    const cfg: SyncConfig = {
      ...config,
      webdavUrl: config.webdavUrl.trim().replace(/\/+$/, ''),
      username: config.username ?? '',
      password: config.password ?? '',
      basePath: (config.basePath || 'qpaste-sync').replace(/\\/g, '/').split('/').map((s) => s.trim()).filter(Boolean).join('/') || 'qpaste-sync',
      deviceId: config.deviceId.trim(),
    }
    this.cfg = cfg
    this.statePath = statePath
    this.stopAutoSync()
    try {
      this.state = JSON.parse(await readFile(statePath, 'utf8')) as SyncState
    } catch {
      this.state = { localSeq: 0, opCursors: {}, pushedDigests: {}, blobCache: {} }
    }
    this.status = { ...this.status, ready: false }

    if (!cfg.enabled) return
    if (!/^https?:\/\//.test(cfg.webdavUrl)) {
      throw new SyncError(`非法的 WebDAV 地址: ${cfg.webdavUrl}`)
    }
    if (!cfg.deviceId) throw new SyncError('deviceId 不能为空')

    this.knownDirs.clear()
    await this.ensureRemoteDirs()
    this.ready = true
    this.status = { ...this.status, ready: true, lastError: null }
    if (cfg.intervalSecs > 0) this.startAutoSync(cfg.intervalSecs)
  }

  startAutoSync(intervalSecs: number): void {
    this.stopAutoSync()
    if (intervalSecs <= 0) return
    this.pullTimer = setInterval(() => {
      void this.pullChanges(this.status.lastSyncAt ?? 0).catch(() => {/* 状态已记录 */})
    }, Math.max(intervalSecs, 5) * 1000)
  }

  stopAutoSync(): void {
    if (this.pullTimer) clearInterval(this.pullTimer)
    this.pullTimer = null
  }

  /** 是否已就绪（决定 pushItem 是否生效） */
  isEnabled(): boolean {
    return this.ready
  }

  /**
   * 增量上传一条剪贴板记录。
   * 返回 false = 内容因校验/尺寸被拒；抛出 SyncError = 网络失败（可直接重试）。
   */
  async pushItem(item: ClipboardSyncItem): Promise<boolean> {
    if (!this.ready || !this.cfg) throw new SyncError('云同步未启用')
    const updatedAt = item.updatedAt > 0 ? item.updatedAt : Date.now()
    const tombstone = item.deletedAt > 0
    if (!tombstone && item.content.length === 0) return false

    const hash = item.hash || computeContentHash(tombstone ? item.id.split(':')[1] ?? '' : item.content)
    const id = item.id || `${item.type}:${hash}`
    const digest = computeContentHash(`${updatedAt}|${item.deletedAt}|${hash}|${item.html ?? ''}`)
    if (this.state.pushedDigests[id] === digest) return true // 内容无变化，幂等跳过

    const wire: WireSyncItem = {
      deviceId: this.cfg.deviceId, // 上传方恒为本机设备标识
      type: item.type,
      content: tombstone ? '' : item.content,
      html: item.html,
      contentBlobHash: null,
      htmlBlobHash: null,
      hash,
      preview: item.preview || [...item.content].slice(0, 200).join(''),
      createdAt: item.createdAt > 0 ? item.createdAt : updatedAt,
      updatedAt,
      deletedAt: item.deletedAt,
    }
    // 图片/大文本/大 HTML 自动旁路为 blob 文件（远端 JSON 里只留 hash 引用）
    if (!tombstone) {
      if (item.type === 'image') {
        if (!item.content.startsWith('data:image/')) return false
        const b64 = item.content.slice(item.content.indexOf(',') + 1)
        if (Buffer.from(b64, 'base64').byteLength > SYNC_MAX_IMAGE_BYTES) return false
      }
      await this.offloadField(wire, 'content')
      if (wire.html !== null) await this.offloadField(wire, 'html')
    }

    // 上传成功后才推进本地序号，失败时下次重试复用同一文件名（原子覆盖）
    const seq = this.state.localSeq + 1
    const batch: WireOpBatch = { deviceId: this.cfg.deviceId, seq, uploadedAt: Date.now(), entries: [wire] }
    await this.uploadAtomic(this.rp(`ops/${opsFileName(this.cfg.deviceId, seq)}`), Buffer.from(JSON.stringify(batch), 'utf8'))

    this.state.localSeq = seq
    this.state.pushedDigests[id] = digest
    await this.saveState()
    this.status = { ...this.status, uploadedItems: this.status.uploadedItems + 1 }
    return true
  }

  /**
   * 拉取自 sinceTimestamp（epoch ms）以来其它设备的变更，
   * 返回按 updatedAt 升序的去重条目（重复键按 LWW 归并）。
   */
  /**
   * 全量上传（首次启用/迁移）：把调用方给定的本地历史按 400 条/批写入 ops 序列。
   * 拉取端按既有「同类型同内容」去重合并，不会产生重复记录。
   */
  async pushAll(items: ClipboardSyncItem[]): Promise<number> {
    if (!this.ready || !this.cfg) throw new SyncError('云同步未启用')
    const BATCH = 400
    let pushed = 0
    for (let i = 0; i < items.length; i += BATCH) {
      const slice = items.slice(i, i + BATCH)
      const seq = this.state.localSeq + 1
      const batch: WireOpBatch = {
        deviceId: this.cfg.deviceId,
        seq,
        uploadedAt: Date.now(),
        entries: slice.map((it) => ({
          deviceId: this.cfg!.deviceId,
          type: it.type,
          content: it.deletedAt > 0 ? '' : it.content,
          html: it.html,
          contentBlobHash: null,
          htmlBlobHash: null,
          hash: it.hash,
          preview: it.preview,
          createdAt: it.createdAt,
          updatedAt: it.updatedAt,
          deletedAt: it.deletedAt,
        })),
      }
      await this.uploadAtomic(
        this.rp(`ops/${opsFileName(this.cfg.deviceId, seq)}`),
        Buffer.from(JSON.stringify(batch), 'utf8'),
      )
      this.state.localSeq = seq
      pushed += slice.length
    }
    if (pushed > 0) await this.saveState()
    return pushed
  }

  /** 上传任意文件到引擎目录（供云端快照备份使用），走原子上传通道 */
  async uploadFile(relative: string, data: Buffer): Promise<void> {
    if (!this.ready || !this.cfg) throw new SyncError('云同步未启用')
    await this.uploadAtomic(this.rp(relative), data)
  }

  async pullChanges(sinceTimestamp: number): Promise<ClipboardSyncItem[]> {
    if (!this.ready || !this.cfg) throw new SyncError('云同步未启用')
    if (this.pulling) return []
    this.pulling = true
    const collected = new Map<string, ClipboardSyncItem>()

    try {
      const refs = await this.listOpRefs()
      for (const ref of refs) {
        if (ref.deviceId === this.cfg.deviceId) continue
        const cursor = this.state.opCursors[ref.deviceId] ?? 0
        if (ref.seq <= cursor) continue

        const batch = await this.fetchJsonOrNull<WireOpBatch>(this.rp(`ops/${opsFileName(ref.deviceId, ref.seq)}`))
        if (!batch || batch.deviceId !== ref.deviceId) continue // 文件残缺，下次重试

        for (const raw of batch.entries) {
          const item = await this.inflateWireItem(raw)
          if (item.updatedAt <= sinceTimestamp) continue
          const prev = collected.get(item.id)
          if (!prev || item.updatedAt > prev.updatedAt) collected.set(item.id, item)
        }
        this.state.opCursors[ref.deviceId] = Math.max(ref.seq, batch.seq)
        await this.saveState() // 逐设备落盘，中断时不回退已完成设备
      }

      const result = [...collected.values()].sort((a, b) => a.updatedAt - b.updatedAt)
      this.status = {
        ...this.status,
        receivedItems: this.status.receivedItems + result.length,
        lastSyncAt: Date.now(),
        lastError: null,
      }
      if (result.length > 0) await this.onPulled(result)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.status = { ...this.status, lastError: msg }
      throw err instanceof SyncError ? err : new SyncError('拉取失败', err)
    } finally {
      this.pulling = false
    }
  }

  /** 冲突策略：Last-Write-Wins；删除墓碑恒优先于更旧的存活条目 */
  resolveConflict(local: ClipboardSyncItem, remote: ClipboardSyncItem): ClipboardSyncItem {
    if (local.deletedAt > 0 && remote.deletedAt === 0) return remote.updatedAt >= local.updatedAt ? remote : local
    if (remote.deletedAt > 0 && local.deletedAt === 0) return local.updatedAt >= remote.updatedAt ? local : remote
    return remote.updatedAt >= local.updatedAt ? remote : local
  }

  /* ================= WebDAV 传输层（私有） ================= */

  private async saveState(): Promise<void> {
    // 截断 blob 缓存，防止无限增长
    const entries = Object.entries(this.state.blobCache)
      .sort((a, b) => b[1] - a[1])
      .slice(0, BLOB_CACHE_MAX_ENTRIES)
    this.state.blobCache = Object.fromEntries(entries)
    const tmp = `${this.statePath}.${randomUUID()}.tmp`
    await writeFile(tmp, JSON.stringify(this.state), 'utf8')
    await rename(tmp, this.statePath)
  }

  private async davRequest(
    method: string,
    relativePath: string,
    options: { body?: Uint8Array; headers?: Record<string, string>; treat404AsNull?: boolean } = {},
  ): Promise<{ status: number; text: string; ok: boolean }> {
    if (!this.cfg) throw new SyncError('云同步未配置')
    const url = `${this.cfg.webdavUrl}/${encodeRelPath(relativePath)}`
    let lastErr: unknown

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS)
      try {
        const headers: Record<string, string> = { ...options.headers }
        if (this.cfg.username.trim()) {
          headers.Authorization = `Basic ${Buffer.from(`${this.cfg.username}:${this.cfg.password}`).toString('base64')}`
        }
        const res = await fetch(url, {
          method,
          headers,
          // 拷贝到独立 ArrayBuffer 的 Uint8Array，兼容 fetch 的 BodyInit 类型
          body: options.body ? new Uint8Array(options.body) : undefined,
          signal: ac.signal,
        })
        const text = await res.text()
        if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
          lastErr = new SyncError(`暂时性错误 ${res.status}: ${text.slice(0, 200)}`)
        } else if (options.treat404AsNull && (res.status === 404 || res.status === 409)) {
          return { status: res.status, text: '', ok: false } // 409 兼容坚果云父目录未建
        } else {
          return { status: res.status, text, ok: res.status >= 200 && res.status < 300 }
        }
      } catch (err) {
        lastErr = err
      } finally {
        clearTimeout(timer)
      }
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt)
    }
    throw lastErr instanceof Error ? lastErr : new SyncError(String(lastErr))
  }

  private async mkcol(dirRelative: string): Promise<void> {
    const cacheKey = `${this.cfg?.webdavUrl ?? ''}/${dirRelative}`
    if (this.knownDirs.has(cacheKey)) return
    const res = await this.davRequest('MKCOL', dirRelative)
    if (res.ok || res.status === 405) { // 405 = 目录已存在
      this.knownDirs.add(cacheKey)
      return
    }
    throw new SyncError(`创建远端目录失败 ${dirRelative}: ${res.status} ${res.text.slice(0, 200)}`)
  }

  /**
   * 远端相对路径统一出口：自动挂 basePath 前缀并压平多余斜杠。
   * 修复历史缺陷：ops/blobs 曾直接拼在 DAV 根下（/ops）而非根目录内（/qpaste-sync/ops），
   * 坚果云等服务上 PROPFIND 必然 404。
   */
  private rp(sub: string): string {
    const base = (this.cfg?.basePath ?? '').replace(/\\/g, '/').split('/').filter(Boolean).join('/')
    const clean = sub.replace(/\\/g, '/').split('/').map((s) => s.trim()).filter(Boolean).join('/')
    if (!base) return clean
    return clean ? `${base}/${clean}` : base
  }

  /** 幂等递归建目录：逐段 MKCOL（405 = 已存在视为成功），已确认目录走内存缓存不再发请求 */
  async ensureDir(remotePath: string): Promise<void> {
    const segs = remotePath.replace(/\\/g, '/').split('/').map((s) => s.trim()).filter(Boolean)
    let cur = ''
    for (const seg of segs) {
      cur = cur ? `${cur}/${seg}` : seg
      await this.mkcol(cur)
    }
  }

  private async ensureRemoteDirs(): Promise<void> {
    // 初次同步的空目录自举：逐段 MKCOL（幂等，405 视为已存在）
    await this.ensureDir(this.rp('ops'))
    await this.ensureDir(this.rp('blobs'))
  }

  /** 原子上传：先写 .tmp 再 MOVE 发布；服务器不支持 MOVE 时回退直 PUT */
  private async uploadAtomic(relative: string, body: Buffer): Promise<void> {
    const tmpRel = `${relative}.uploading.${randomUUID()}.tmp`
    const slash = relative.lastIndexOf('/')
    if (slash > 0) await this.mkcol(relative.slice(0, slash))

    const putTo = async (rel: string): Promise<void> => {
      const res = await this.davRequest('PUT', rel, {
        body,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
      if (!res.ok) throw new SyncError(`上传失败 ${rel}: ${res.status} ${res.text.slice(0, 200)}`)
    }

    await putTo(tmpRel)
    const dest = `${this.cfg?.webdavUrl ?? ''}/${encodeRelPath(relative)}`
    const mv = await this.davRequest('MOVE', tmpRel, { headers: { Destination: dest, Overwrite: 'T' } })
    if (mv.ok) return
    if ([405, 409, 412, 501].includes(mv.status)) {
      // 服务器不支持 MOVE 覆盖 → 直接 PUT 目标位置
      await putTo(relative)
      await this.davRequest('DELETE', tmpRel).catch(() => undefined)
      return
    }
    await this.davRequest('DELETE', tmpRel).catch(() => undefined)
    throw new SyncError(`发布失败 ${relative}: ${mv.status} ${mv.text.slice(0, 200)}`)
  }

  private async fetchJsonOrNull<T>(relative: string): Promise<T | null> {
    const res = await this.davRequest('GET', relative, { treat404AsNull: true })
    if (!res.ok) return null
    try {
      return JSON.parse(res.text) as T
    } catch {
      return null // 上次中断残留的半截文件，等待下次覆盖
    }
  }

  private blobRel(kind: string, hash: string): string {
    return `blobs/${hash.slice(0, 2)}/${kind}_${hash}.blob`
  }

  /** 超过内联阈值的内容剥离为独立 blob 文件（按 hash 前两位分片） */
  private async offloadField(wire: WireSyncItem, field: 'content' | 'html'): Promise<void> {
    const value = wire[field]
    if (value === null || value.length === 0) return
    const bytes = Buffer.byteLength(value, 'utf8')
    const isImage = wire.type === 'image' && field === 'content' && value.startsWith('data:')
    const oversize =
      isImage ||
      (field === 'content' && bytes > SYNC_INLINE_TEXT_THRESHOLD_BYTES) ||
      (field === 'html' && bytes > SYNC_INLINE_HTML_THRESHOLD_BYTES)
    if (!oversize) return

    const kind = isImage ? 'image' : field
    const blobHash = computeContentHash(value)
    const rel = this.rp(this.blobRel(kind, blobHash))
    const cacheKey = `${this.cfg?.webdavUrl ?? ''}|${rel}`
    if (!(cacheKey in this.state.blobCache)) {
      const exists = await this.davRequest('HEAD', rel, { treat404AsNull: true })
      if (!exists.ok) {
        await this.ensureDir(this.rp(`blobs/${blobHash.slice(0, 2)}`))
        await this.uploadAtomic(rel, Buffer.from(value, 'utf8'))
      }
      this.state.blobCache[cacheKey] = Date.now()
      await this.saveState()
    }
    if (field === 'content') {
      wire.contentBlobHash = blobHash
      wire.content = ''
    } else {
      wire.htmlBlobHash = blobHash
      wire.html = null
    }
  }

  /** 拉取侧：按 blob 引用还原完整内容（远端 JSON 中大内容为空） */
  private async inflateWireItem(raw: WireSyncItem): Promise<ClipboardSyncItem> {
    const resolve = async (
      blobHash: string | null,
      value: string | null,
      kind: string,
    ): Promise<string | null> => {
      if (!blobHash) return value ?? ''
      const res = await this.davRequest('GET', this.rp(this.blobRel(kind, blobHash)), { treat404AsNull: true })
      if (!res.ok) throw new SyncError(`远端缺少内容分片 blob: ${blobHash}`)
      return res.text
    }
    const content = await resolve(raw.contentBlobHash, raw.content, raw.type === 'image' ? 'image' : 'content')
    const html = raw.htmlBlobHash ? await resolve(raw.htmlBlobHash, raw.html, 'html') : raw.html
    return {
      id: `${raw.type}:${raw.hash}`,
      type: raw.type,
      content: content ?? '',
      html,
      hash: raw.hash,
      preview: raw.preview,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      deviceId: raw.deviceId,
      deletedAt: raw.deletedAt,
    }
  }

  /** PROPFIND 列出 ops 目录下的增量批次（deviceId, seq）；404/409 = 目录缺失，自动补建后按空列表继续 */
  private async listOpRefs(): Promise<Array<{ deviceId: string; seq: number }>> {
    const res = await this.davRequest('PROPFIND', this.rp('ops'), {
      body: Buffer.from(PROPFIND_BODY, 'utf8'),
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    })
    if (res.status === 404 || res.status === 409) {
      // 409 兼容坚果云「父目录不存在」；不作为致命错误中断，补建后继续本轮上传/同步
      await this.ensureDir(this.rp('ops'))
      return []
    }
    if (!res.ok && res.status !== 207) {
      throw new SyncError(`列取远端 ops 目录失败: ${res.status}`)
    }
    const hrefRe = /<[^>]*href[^>]*>\s*([^<]+)\s*</gi
    const nameRe = /^(.+)__(\d{20})\.json$/
    const refs = new Map<string, { deviceId: string; seq: number }>()
    for (const [, rawHref] of res.text.matchAll(hrefRe)) {
      const fileName = decodeURIComponent(rawHref.trim()).replace(/\/$/, '').split('/').pop() ?? ''
      const m = nameRe.exec(fileName)
      if (m) refs.set(`${m[1]}:${m[2]}`, { deviceId: m[1], seq: Number(m[2]) })
    }
    return [...refs.values()].sort((a, b) => a.deviceId.localeCompare(b.deviceId) || a.seq - b.seq)
  }
}
