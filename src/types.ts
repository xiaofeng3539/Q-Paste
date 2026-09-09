import type { CloudSyncConfig, CloudSyncStatus, WebDavToggleResult } from './main/sync/types'

export interface CloudSyncPulledItem {
  id: number
  type: string
  content: string
  preview: string
  charCount: number
  storageSize: number
  createdAt: string
}

/* ── 局域网文件传输（移植自 Tiez） ── */

export interface FtMessage {
  id: number
  direction: 'in' | 'out'
  msg_type: string
  content: string
  timestamp: number
  sender_id?: string
  sender_name?: string
  file_path?: string
  _preparing?: boolean
  _fileName?: string
}

export interface FtDeviceInfo { id: string; name: string; last_seen: number }
export interface FtStatus { enabled: boolean; port: number; ip: string }
export interface FtSettings {
  enabled: boolean
  port: number
  path: string
  autoOpen: boolean
  autoClose: boolean
  autoCopy: boolean
  bindIp: string
}

export type ItemType = 'text' | 'url' | 'image' | 'html' | 'files'

export interface ClipboardItem {
  id: number
  type: ItemType
  content: string
  preview: string
  char_count: number
  storage_size: number
  created_at: string
  /** 是否收藏/常驻 */
  is_pinned: boolean
  /** 收藏时间（金库按此排序；旧数据为 null，按 created_at 兜底） */
  pinned_at?: string | null
  /** 自定义别名 */
  alias: string
  /** 分类标签 */
  tags: string[]
  /** 是否为敏感数据 */
  is_sensitive: boolean
  /** 历史列表自定义拖拽排序权重（值越大越靠前） */
  sort_order?: number
  /** 金库列表自定义拖拽排序权重（值越大越靠前） */
  vault_sort_order?: number
}

export interface UpdateMetaParams {
  id: number
  isPinned?: boolean
  alias?: string
  tags?: string
  isSensitive?: boolean
}

export interface ElectronAPI {
  getItems: (params: { limit: number; offset: number; search?: string; pinnedOnly?: boolean }) => Promise<ClipboardItem[]>
  getItemContent: (id: number) => Promise<string>
  insertItem: (item: { type: string; content: string; preview: string; charCount: number; storageSize: number; createdAt: string; isSensitive?: boolean }) => Promise<{ id: number; updated: boolean }>
  deleteItem: (id: number) => Promise<boolean>
  deleteItems: (ids: number[]) => Promise<boolean>
  forceClearData: (type: 'images' | 'all') => Promise<{ success: boolean; error?: string }>
  updateItem: (params: { id: number; content: string; preview: string; charCount: number; storageSize: number }) => Promise<boolean>
  updateItemMeta: (params: UpdateMetaParams) => Promise<boolean>
  reorderItems: (order: number[]) => Promise<boolean>
  vaultReorderItems: (order: number[]) => Promise<boolean>
  getItemCount: () => Promise<number>
  getStorageUsage: () => Promise<{ textBytes: number; imageBytes: number; totalBytes: number }>
  writeText: (text: string) => Promise<boolean>
  writeImage: (dataUrl: string) => Promise<boolean>
  writeHtml: (html: string) => Promise<boolean>
  writeFiles: (paths: string[]) => Promise<boolean>
  openUrl: (url: string) => Promise<boolean>
  openFile: (filePath: string) => Promise<boolean>
  onClipboardChanged: (callback: (data: ClipboardChangedData) => void) => () => void
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => Promise<boolean>
  getAutoStart: () => Promise<{ autoStart: boolean; startMinimized: boolean }>
  setAutoStart: (settings: { autoStart?: boolean; startMinimized?: boolean }) => Promise<{ success: boolean }>
  getShortcut: () => Promise<string>
  updateShortcut: (newShortcut: string) => Promise<{ success: boolean; shortcut: string }>
  selectDirectory: () => Promise<{ canceled: boolean; path: string | null }>
  openFolder: (dirPath: string) => Promise<void>
  changeStoragePath: (newPath: string) => Promise<{ success: boolean; error?: string }>
  getConfigPath: () => Promise<string>
  getRetention: () => Promise<{ retentionDays: number | 'forever'; maxRecords: number }>
  setRetention: (settings: { retentionDays?: number | 'forever'; maxRecords?: number }) => Promise<{ success: boolean }>
  getCaptureRules: () => Promise<{ ignorePatterns: string[]; dedupeOnCapture: boolean; maxCaptureKb: number }>
  setCaptureRules: (settings: { ignorePatterns?: string[]; dedupeOnCapture?: boolean; maxCaptureKb?: number }) => Promise<{ success: boolean }>
  getCloudSyncConfig: () => Promise<CloudSyncConfig>
  getCloudSyncStatus: () => Promise<CloudSyncStatus>
  toggleWebDav: (config: Partial<CloudSyncConfig>, state: boolean) => Promise<WebDavToggleResult>
  cloudSyncNow: () => Promise<{ ok: boolean; error?: string; status: CloudSyncStatus }>
  onCloudSyncPulled: (callback: (items: CloudSyncPulledItem[]) => void) => () => void
  getWindowMaximized: () => Promise<boolean>
  showWindowSystemMenu: () => Promise<boolean>
  getAppIcon: () => Promise<string>
  writeTextAsFile: (text: string, name?: string) => Promise<{ success: boolean; path?: string; error?: string }>
  insertOversize: (content: string, truncate: boolean) => Promise<{ id: number | null; updated: boolean } | null>
  checkDatabase: () => Promise<{ ok: boolean; integrity: string; count: number; size: number }>
  onOversizeConfirm: (callback: (info: { content: string; kb: number }) => void) => () => void
  onDbIntegrityIssue: (callback: () => void) => () => void
  openLogsDir: () => Promise<boolean>
  onWindowMaximizeChanged: (callback: (maximized: boolean) => void) => () => void
  ftToggle: (enabled: boolean, port?: number) => Promise<{ success: boolean; port: number; error?: string }>
  ftStatus: () => Promise<FtStatus>
  ftGetSettings: () => Promise<FtSettings>
  ftSetSetting: (key: 'fileTransferAutoOpen' | 'fileTransferAutoClose' | 'fileTransferAutoCopy' | 'fileTransferBindIp', value: boolean | string) => Promise<boolean>
  ftGetAvailableIps: () => Promise<string[]>
  ftSetDisplayIp: (ip: string) => Promise<void>
  ftGetChatHistory: () => Promise<FtMessage[]>
  ftSendChatText: (content: string) => Promise<boolean>
  ftSendFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
  ftGetActivePath: () => Promise<string>
  ftChooseSavePath: () => Promise<{ canceled: boolean; path?: string }>
  ftSaveTempImage: (base64Data: string) => Promise<string>
  ftGetAppLogo: () => Promise<string>
  ftReadFileDataUrl: (filePath: string) => Promise<string>
  ftOpenPath: (target: string) => Promise<boolean>
  ftSaveFileCopy: (sourcePath: string, targetPath: string) => Promise<boolean>
  ftSaveFileAs: (sourcePath: string, defaultName: string) => Promise<{ canceled: boolean; path?: string }>
  ftPickFiles: () => Promise<string[]>
  ftPathForFile: (file: File) => string
  onFtStatusChanged: (callback: (status: FtStatus) => void) => () => void
  onFtDevicesUpdated: (callback: (devices: FtDeviceInfo[]) => void) => () => void
  onFtNewMessage: (callback: () => void) => () => void
  getVersion: () => Promise<string>
  checkUpdate: () => Promise<{ success: boolean; error?: string }>
  installUpdate: () => Promise<{ success: boolean; error?: string }>
  onUpdateStatus: (callback: (status: { status: string; version?: string; percent?: number; message?: string }) => void) => () => void
  exportDb: () => Promise<{ success: boolean; canceled?: boolean; path?: string; imagesCopied?: boolean; error?: string }>
  exportJson: () => Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>
  importJson: () => Promise<{ success: boolean; canceled?: boolean; count?: number; duplicates?: number; error?: string }>
  onOpenSettings: (callback: () => void) => () => void
}

export interface ClipboardChangedData {
  type: ItemType
  content: string
  preview: string
  charCount?: number
  storageSize?: number
  createdAt: string
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
