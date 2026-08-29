/**
 * WebDAV 服务门面：连通性校验（鉴权/网络/服务器三态归因）+ 同步入口。
 * 传输层复用 SyncEngine 内置的零依赖 WebDAV 客户端（重试/原子写/blob 旁路），
 * 不引入 webdav npm 包以免重复栈。
 */
import type { CloudSyncStatus, SyncConfig } from './types'
import type { SyncEngine } from './SyncEngine'

export type WebDavFailReason = 'auth' | 'network' | 'server'

export interface WebDavVerifyResult {
  ok: boolean
  reason?: WebDavFailReason
  message?: string
}

/** 单次探测超时：开启开关时用户在等结果，必须快速失败 */
const VERIFY_TIMEOUT_MS = 10_000

function classifyNetworkError(err: unknown): WebDavFailReason {
  // Node fetch 把底层系统错误包在 cause 链里（cause(ECONNREFUSED)），必须递归展开
  let text = ''
  let cur: unknown = err
  for (let depth = 0; cur instanceof Error && depth < 5; depth++) {
    text += `${(cur as NodeJS.ErrnoException).code ?? ''} ${cur.name} ${cur.message} `
    cur = (cur as { cause?: unknown }).cause
  }
  return /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|UND_ERR|AbortError|TimeoutError|certificate|TLS|SSL/i.test(text)
    ? 'network'
    : 'server'
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
}

/**
 * 校验 WebDAV 地址与账密连通性（PROPFIND Depth:0 探测，不写任何数据）。
 * - 401/403            → auth（鉴权失败）
 * - 超时/DNS/连接拒绝   → network（网络断开）
 * - 2xx/207/404        → ok（404 表示目录未建，引擎会 MKCOL 创建）
 * - 其余状态码          → server
 */
export async function verifyWebDav(
  config: Pick<SyncConfig, 'webdavUrl' | 'username' | 'password' | 'basePath'>,
): Promise<WebDavVerifyResult> {
  const base = config.webdavUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) {
    return { ok: false, reason: 'server', message: `WebDAV 地址不合法: ${base || '(空)'}` }
  }
  const probe = `${base}/${(config.basePath || 'qpaste-sync').replace(/\\/g, '/').split('/').filter(Boolean).map(encodeURIComponent).join('/')}/`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)
  try {
    const headers: Record<string, string> = { Depth: '0' }
    if (config.username.trim()) headers.Authorization = basicAuth(config.username.trim(), config.password)
    const res = await fetch(probe, { method: 'PROPFIND', headers, signal: controller.signal })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: 'auth', message: `鉴权失败 (HTTP ${res.status})` }
    }
    if (res.ok || res.status === 207 || res.status === 404) {
      return { ok: true }
    }
    return { ok: false, reason: 'server', message: `服务器返回 HTTP ${res.status}` }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: classifyNetworkError(err), message: `连接失败: ${message}` }
  } finally {
    clearTimeout(timer)
  }
}

export class WebDavService {
  constructor(private readonly engine: SyncEngine) {}

  /** 测试 URL 与账密连通性 */
  verify(config: Pick<SyncConfig, 'webdavUrl' | 'username' | 'password' | 'basePath'>): Promise<WebDavVerifyResult> {
    return verifyWebDav(config)
  }

  /**
   * 同步一轮：拉取云端增量与本地按 updatedAt 归并（LWW），
   * 本地变更由捕获时刻的增量推送完成，无需整包回传。
   */
  async sync(): Promise<CloudSyncStatus> {
    await this.engine.pullChanges(this.engine.status.lastSyncAt ?? 0)
    return this.engine.status
  }
}
