/**
 * Q-Paste 云同步数据契约（WebDAV 协议，解耦自 Tiez cloud_sync.rs）
 * 线路格式字段带 Wire 前缀，仅在网络传输的 JSON 文件中使用。
 */

export type ClipboardSyncType = 'text' | 'link' | 'image' | 'rich_text'

/** 同步条目（跨设备业务主键：id = `${type}:${hash}`） */
export interface ClipboardSyncItem {
  id: string
  type: ClipboardSyncType
  /** 文本正文；图片为 data URL（data:image/png;base64,...）；link 为完整 URL */
  content: string
  /** rich_text 附带的 HTML 正文 */
  html: string | null
  /** 内容指纹：SHA-256 hex（图片针对完整 data URL 计算） */
  hash: string
  /** 列表预览文本（≤200 字符），缺省由引擎截取 */
  preview: string
  /** 产生该内容的原始时间戳（epoch ms） */
  createdAt: number
  /** 最后一次变更时间戳（epoch ms），LWW 冲突裁决依据 */
  updatedAt: number
  /** 产生该条目的设备标识 */
  deviceId: string
  /** >0 为软删除墓碑时间戳 */
  deletedAt: number
}

/** 渲染层/主进程共用的云同步配置（传入 SyncEngine.init） */
export interface SyncConfig {
  enabled: boolean
  /** WebDAV 服务地址，如 https://dav.jianguoyun.com/dav/ */
  webdavUrl: string
  username: string
  password: string
  /** 远端根目录名，默认 'qpaste-sync' */
  basePath: string
  /** 本机设备标识（首次生成后持久化） */
  deviceId: string
  /** 自动拉取间隔（秒），0 = 关闭自动拉取 */
  intervalSecs: number
}

/** 兼容旧命名的别名 */
export type CloudSyncConfig = SyncConfig

/** 同步状态（供设置页展示） */
export interface CloudSyncStatus {
  ready: boolean
  lastSyncAt: number | null
  lastError: string | null
  uploadedItems: number
  receivedItems: number
}

/** toggleWebDav 结果：失败时带归因（auth=鉴权失败 / network=网络断开 / server=服务器异常） */
export interface WebDavToggleResult {
  ok: boolean
  reason?: 'auth' | 'network' | 'server'
  message?: string
  status?: CloudSyncStatus
}

/* ---------- 线路格式（WebDAV 上的 JSON 文件结构） ---------- */

/** 大内容旁路引用；存在 blob hash 时对应正文字段为空字符串/null */
export interface WireSyncItem {
  deviceId: string
  type: ClipboardSyncType
  content: string
  html: string | null
  contentBlobHash: string | null
  htmlBlobHash: string | null
  hash: string
  preview: string
  createdAt: number
  updatedAt: number
  deletedAt: number
}

/** ops 目录下的单批增量文件：ops/{deviceId}__{seq 补零 20 位}.json */
export interface WireOpBatch {
  deviceId: string
  seq: number
  uploadedAt: number
  entries: WireSyncItem[]
}

/** 本地持久化状态（写入 userData/sync-state.json） */
export interface SyncState {
  localSeq: number
  opCursors: Record<string, number>
  pushedDigests: Record<string, string>
  blobCache: Record<string, number>
}

/** 大内容旁路阈值（与 Tiez 一致） */
export const SYNC_INLINE_TEXT_THRESHOLD_BYTES = 12 * 1024
export const SYNC_INLINE_HTML_THRESHOLD_BYTES = 24 * 1024
export const SYNC_MAX_IMAGE_BYTES = 8 * 1024 * 1024

export class SyncError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'SyncError'
  }
}
