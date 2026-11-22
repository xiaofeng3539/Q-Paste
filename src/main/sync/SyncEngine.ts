import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
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
const SHA256_HEX = /^[\da-f]{64}$/

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

function emptyState(): SyncState {
  return { localSeq: 0, opCursors: {}, pushedDigests: {}, blobCache: {} }
}

function isWireItem(raw: unknown, deviceId: string): raw is WireSyncItem {
  if (!raw || typeof raw !== 'object') return false
  const item = raw as Partial<WireSyncItem>
  return item.deviceId === deviceId &&
    (item.type === 'text' || item.type === 'link' || item.type === 'image' || item.type === 'rich_text') &&
    typeof item.content === 'string' &&
    (item.html === null || typeof item.html === 'string') &&
    (item.contentBlobHash === null || (typeof item.contentBlobHash === 'string' && SHA256_HEX.test(item.contentBlobHash))) &&
    (item.htmlBlobHash === null || (typeof item.htmlBlobHash === 'string' && SHA256_HEX.test(item.htmlBlobHash))) &&
    typeof item.hash === 'string' && SHA256_HEX.test(item.hash) &&
    typeof item.preview === 'string' &&
    Number.isFinite(item.createdAt) && Number.isFinite(item.updatedAt) && Number.isFinite(item.deletedAt)
}

export class SyncEngine {
  private cfg: SyncConfig | null = null
  private statePath = ''
  private state = emptyState()
  private knownDirs = new Set<string>()
  private pullTimer: ReturnType<typeof setInterval> | null = null
  private work = Promise.resolve()
  private pulling: Promise<ClipboardSyncItem[]> | null = null
  private publishedSeq = 0
  private ready = false

  status: CloudSyncStatus = {
    ready: false,
    lastSyncAt: null,
    lastError: null,
    uploadedItems: 0,
    receivedItems: 0,
  }

  /** 宿主须在持久化条目后才完成回调，失败时抛错。游标落盘失败时同一批次会重放。 */
  onPulled: (items: ClipboardSyncItem[]) => void | Promise<void> = () => {}

  /**
   * 初始化与鉴权配置：加载本地游标并确保远端目录就绪。
   * enabled=false 时仅记录配置，不发起任何网络请求。
   */
  init(config: SyncConfig, statePath: string): Promise<void> {
    this.stopAutoSync()
    return this.enqueue(() => this.configure(config, statePath))
  }

  private async configure(config: SyncConfig, statePath: string): Promise<void> {
    const cfg: SyncConfig = {
      ...config,
      webdavUrl: config.webdavUrl.trim().replace(/\/+$/, ''),
      username: (config.username ?? '').trim(),
      password: config.password ?? '',
      basePath: (config.basePath || 'qpaste-sync').replace(/\\/g, '/').split('/').map((s) => s.trim()).filter(Boolean).join('/') || 'qpaste-sync',
      deviceId: config.deviceId.trim(),
    }
    this.cfg = cfg
    this.statePath = statePath
    this.stopAutoSync()
    this.ready = false
    this.status = { ...this.status, ready: false }

    if (!cfg.enabled) return
    if (!/^https?:\/\//.test(cfg.webdavUrl)) {
      throw new SyncError(`非法的 WebDAV 地址: ${cfg.webdavUrl}`)
    }
    if (!cfg.deviceId) throw new SyncError('deviceId 不能为空')

    const remoteKey = computeContentHash(JSON.stringify([cfg.webdavUrl, cfg.basePath, cfg.username, cfg.deviceId]))
    const previousKey = this.state.remoteKey
    const saved = await readFile(statePath, 'utf8')
      .then((json) => JSON.parse(json) as SyncState | null)
      .catch(() => null)
    const useSaved = saved && (!saved.remoteKey || saved.remoteKey === remoteKey)
    this.state = { ...(useSaved ? saved : emptyState()), remoteKey }
    if ((previousKey || saved?.remoteKey) && (previousKey || saved?.remoteKey) !== remoteKey) {
      this.status = { ...this.status, lastSyncAt: null }
    }
    this.knownDirs.clear()
    await this.ensureRemoteDirs()
    // 已发布的批次可能在保存本地序号前中断。重启后从远端恢复序号，避免覆盖批次。
    this.publishedSeq = this.state.localSeq
    for (const ref of await this.listOpRefs()) {
      if (ref.deviceId === cfg.deviceId) this.publishedSeq = Math.max(this.publishedSeq, ref.seq)
    }
    if (useSaved && !saved.remoteKey) await this.saveState(this.state)
    this.ready = true
    this.status = { ...this.status, ready: true, lastError: null }
    if (cfg.intervalSecs > 0) this.startAutoSync(cfg.intervalSecs)
  }

  startAutoSync(intervalSecs: number): void {
    this.stopAutoSync()
    if (intervalSecs <= 0) return
    this.pullTimer = setInterval(() => {
      void this.pullChanges().catch(() => {/* 状态已记录 */})
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
  pushItem(item: ClipboardSyncItem): Promise<boolean> {
    return this.enqueue(() => this.pushOne(item))
  }

  private async pushOne(item: ClipboardSyncItem): Promise<boolean> {
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

    await this.publishBatch([wire], { ...this.state.pushedDigests, [id]: digest })
    this.status = { ...this.status, uploadedItems: this.status.uploadedItems + 1 }
    return true
  }

  /**
   * 全量上传（首次启用/迁移）：把调用方给定的本地历史按 400 条/批写入 ops 序列。
   * 拉取端按既有「同类型同内容」去重合并，不会产生重复记录。
   */
  pushAll(items: ClipboardSyncItem[]): Promise<number> {
    return this.enqueue(() => this.pushBulk(items))
  }

  private async pushBulk(items: ClipboardSyncItem[]): Promise<number> {
    const deviceId = this.cfg?.deviceId
    if (!this.ready || !deviceId) throw new SyncError('云同步未启用')
    const BATCH = 400
    let pushed = 0
    for (let i = 0; i < items.length; i += BATCH) {
      const slice = items.slice(i, i + BATCH)
      await this.publishBatch(slice.map((it) => ({
        deviceId,
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
      })))
      pushed += slice.length
    }
    return pushed
  }

  private async publishBatch(entries: WireSyncItem[], pushedDigests = this.state.pushedDigests): Promise<void> {
    const deviceId = entries[0].deviceId
    const seq = this.publishedSeq + 1
    const batch: WireOpBatch = { deviceId, seq, uploadedAt: Date.now(), entries }
    await this.uploadAtomic(this.rp(`ops/${opsFileName(deviceId, seq)}`), Buffer.from(JSON.stringify(batch), 'utf8'))
    this.publishedSeq = seq
    await this.saveState({ ...this.state, localSeq: seq, pushedDigests })
  }

  /** 上传任意文件到引擎目录（供云端快照备份使用），走原子上传通道 */
  uploadFile(relative: string, data: Buffer): Promise<void> {
    return this.enqueue(async () => {
      if (!this.ready || !this.cfg) throw new SyncError('云同步未启用')
      await this.uploadAtomic(this.rp(relative), data)
    })
  }

  /** 旧调用方可保留时间戳参数。增量范围仅由各设备的批次游标决定。 */
  pullChanges(_sinceTimestamp?: number): Promise<ClipboardSyncItem[]> {
    this.pulling ??= this.enqueue(() => this.pullPendingBatches()).finally(() => { this.pulling = null })
    return this.pulling
  }

  private async pullPendingBatches(): Promise<ClipboardSyncItem[]> {
    if (!this.ready || !this.cfg) throw new SyncError('云同步未启用')
    const collected = new Map<string, ClipboardSyncItem>()
    const cursors = new Map(Object.entries(this.state.opCursors))
    const blockedDevices = new Set<string>()
    let batchError: SyncError | undefined
    let changed = false

    try {
      const refs = await this.listOpRefs()
      for (const ref of refs) {
        if (ref.deviceId === this.cfg.deviceId || blockedDevices.has(ref.deviceId)) continue
        const cursor = cursors.get(ref.deviceId) ?? 0
        if (ref.seq <= cursor) continue

        try {
          if (ref.seq !== cursor + 1) throw new SyncError(`缺少远端同步批次 ${opsFileName(ref.deviceId, cursor + 1)}`)
          const batch = await this.fetchBatch(ref.deviceId, ref.seq)
          const items = []
          for (const raw of batch.entries) items.push(await this.inflateWireItem(raw))
          for (const item of items) {
            const prev = collected.get(item.id)
            if (!prev || item.updatedAt > prev.updatedAt) collected.set(item.id, item)
          }
          cursors.set(ref.deviceId, ref.seq)
          changed = true
        } catch (err) {
          blockedDevices.add(ref.deviceId)
          const message = err instanceof Error ? err.message : String(err)
          batchError ??= new SyncError(`无法拉取同步批次 ${opsFileName(ref.deviceId, ref.seq)}: ${message}`, err)
        }
      }

      const result = [...collected.values()].sort((a, b) => a.updatedAt - b.updatedAt)
      if (result.length > 0) await this.onPulled(result)
      if (changed) await this.saveState({ ...this.state, opCursors: Object.fromEntries(cursors) })
      this.status = {
        ...this.status,
        receivedItems: this.status.receivedItems + result.length,
      }
      if (batchError) throw batchError
      this.status = { ...this.status, lastSyncAt: Date.now(), lastError: null }
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.status = { ...this.status, lastError: msg }
      throw err instanceof SyncError ? err : new SyncError('拉取失败', err)
    }
  }

  /** 冲突策略：Last-Write-Wins；删除墓碑恒优先于更旧的存活条目 */
  resolveConflict(local: ClipboardSyncItem, remote: ClipboardSyncItem): ClipboardSyncItem {
    if (local.deletedAt > 0 && remote.deletedAt === 0) return remote.updatedAt >= local.updatedAt ? remote : local
    if (remote.deletedAt > 0 && local.deletedAt === 0) return local.updatedAt >= remote.updatedAt ? local : remote
    return remote.updatedAt >= local.updatedAt ? remote : local
  }

  /* ================= WebDAV 传输层（私有） ================= */

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const pending = this.work.then(run)
    this.work = pending.then(() => undefined, () => undefined)
    return pending
  }

  private async saveState(state: SyncState): Promise<void> {
    // 截断 blob 缓存，防止无限增长
    const entries = Object.entries(state.blobCache)
      .sort((a, b) => b[1] - a[1])
      .slice(0, BLOB_CACHE_MAX_ENTRIES)
    const next = { ...state, blobCache: Object.fromEntries(entries) }
    const tmp = `${this.statePath}.${randomUUID()}.tmp`
    try {
      await writeFile(tmp, JSON.stringify(next), 'utf8')
      await rename(tmp, this.statePath)
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined)
      throw err
    }
    this.state = next
  }

  private async davRequest(
    method: string,
    relativePath: string,
    options: { body?: Uint8Array; headers?: Record<string, string>; treat404AsNull?: boolean; readBytes?: boolean } = {},
  ): Promise<{ status: number; text: string; ok: boolean; bytes?: Buffer }> {
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
        const bytes = options.readBytes && res.ok ? Buffer.from(await res.arrayBuffer()) : undefined
        const text = bytes ? bytes.toString('utf8') : await res.text()
        if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
          lastErr = new SyncError(`暂时性错误 ${res.status}: ${text.slice(0, 200)}`)
        } else if (options.treat404AsNull && (res.status === 404 || res.status === 409)) {
          return { status: res.status, text: '', ok: false } // 409 兼容坚果云父目录未建
        } else {
          return { status: res.status, text, ok: res.ok, bytes }
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

  private async fetchBatch(deviceId: string, seq: number): Promise<WireOpBatch> {
    const res = await this.davRequest('GET', this.rp(`ops/${opsFileName(deviceId, seq)}`), { treat404AsNull: true })
    if (!res.ok) throw new SyncError(`读取远端批次失败 (HTTP ${res.status})`)
    let batch: WireOpBatch | null
    try {
      batch = JSON.parse(res.text) as WireOpBatch | null
    } catch {
      throw new SyncError('远端批次不是有效 JSON')
    }
    if (!batch || batch.deviceId !== deviceId || batch.seq !== seq || !Number.isFinite(batch.uploadedAt) ||
        !Array.isArray(batch.entries) || !batch.entries.every((raw) => isWireItem(raw, deviceId))) {
      throw new SyncError('远端批次标识或条目无效')
    }
    return batch
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
      await this.saveState({ ...this.state, blobCache: { ...this.state.blobCache, [cacheKey]: Date.now() } })
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
      const res = await this.davRequest('GET', this.rp(this.blobRel(kind, blobHash)), {
        treat404AsNull: true,
        readBytes: true,
      })
      if (!res.bytes) throw new SyncError(`远端内容分片读取失败 (HTTP ${res.status}): ${blobHash}`)
      if (createHash('sha256').update(res.bytes).digest('hex') !== blobHash) {
        throw new SyncError(`远端内容分片校验失败: ${blobHash}`)
      }
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
      let fileName: string
      try {
        fileName = decodeURIComponent(rawHref.trim()).replace(/\/$/, '').split('/').pop() ?? ''
      } catch {
        continue
      }
      const m = nameRe.exec(fileName)
      if (!m) continue
      const seq = Number(m[2])
      if (Number.isSafeInteger(seq) && seq > 0) refs.set(`${m[1]}:${m[2]}`, { deviceId: m[1], seq })
    }
    return [...refs.values()].sort((a, b) => a.deviceId.localeCompare(b.deviceId) || a.seq - b.seq)
  }
}
