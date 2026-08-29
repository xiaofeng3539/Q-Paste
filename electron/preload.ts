import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { CloudSyncConfig, CloudSyncStatus, WebDavToggleResult } from '../src/main/sync/types'

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

export interface CloudSyncPulledItem {
  id: number
  type: string
  content: string
  preview: string
  charCount: number
  storageSize: number
  createdAt: string
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Database
  getItems: (params: { limit: number; offset: number; search?: string; pinnedOnly?: boolean }) =>
    ipcRenderer.invoke('db:get-items', params),
  getItemContent: (id: number) =>
    ipcRenderer.invoke('db:get-item-content', id) as Promise<string>,
  insertItem: (item: { type: string; content: string; preview: string; charCount: number; storageSize: number; createdAt: string; isSensitive?: boolean }) =>
    ipcRenderer.invoke('db:insert-item', item),
  deleteItem: (id: number) =>
    ipcRenderer.invoke('db:delete-item', id),
  forceClearData: (type: string) =>
    ipcRenderer.invoke('force-clear-data', type) as Promise<{ success: boolean; error?: string }>,
  updateItem: (params: { id: number; content: string; preview: string; charCount: number; storageSize: number }) =>
    ipcRenderer.invoke('db:update-item', params),
  updateItemMeta: (params: { id: number; isPinned?: boolean; alias?: string; tags?: string; isSensitive?: boolean }) =>
    ipcRenderer.invoke('db:update-item-meta', params) as Promise<boolean>,
  getItemCount: () =>
    ipcRenderer.invoke('db:get-item-count'),
  getStorageUsage: () =>
    ipcRenderer.invoke('db:get-storage-usage') as Promise<{ textBytes: number; imageBytes: number; totalBytes: number }>,

  // Clipboard
  writeText: (text: string) =>
    ipcRenderer.invoke('clipboard:write-text', text),
  writeImage: (dataUrl: string) =>
    ipcRenderer.invoke('clipboard:write-image', dataUrl),
  writeHtml: (html: string) =>
    ipcRenderer.invoke('clipboard:write-html', html),
  writeFiles: (paths: string[]) =>
    ipcRenderer.invoke('clipboard:write-files', paths),
  openUrl: (url: string) =>
    ipcRenderer.invoke('shell:open-url', url) as Promise<boolean>,
  openFile: (filePath: string) =>
    ipcRenderer.invoke('shell:open-file', filePath) as Promise<boolean>,

  // Listeners
  onClipboardChanged: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('clipboard-changed', handler)
    return () => ipcRenderer.removeListener('clipboard-changed', handler)
  },

  // Window control (for frameless macOS)
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  getWindowMaximized: () => ipcRenderer.invoke('window:is-maximized') as Promise<boolean>,
  showWindowSystemMenu: () => ipcRenderer.invoke('window:system-menu') as Promise<boolean>,
  getAppIcon: () => ipcRenderer.invoke('app:get-icon') as Promise<string>,
  insertOversize: (content: string, truncate: boolean) =>
    ipcRenderer.invoke('clipboard:insert-oversize', { content, truncate }) as Promise<{ id: number | null; updated: boolean } | null>,
  checkDatabase: () =>
    ipcRenderer.invoke('db:check') as Promise<{ ok: boolean; integrity: string; count: number; size: number }>,
  onOversizeConfirm: (callback: (info: { content: string; kb: number }) => void) => {
    const handler = (_event: any, info: { content: string; kb: number }) => callback(info)
    ipcRenderer.on('clipboard:oversize-confirm', handler)
    return () => ipcRenderer.removeListener('clipboard:oversize-confirm', handler)
  },
  onDbIntegrityIssue: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('db:integrity-issue', handler)
    return () => ipcRenderer.removeListener('db:integrity-issue', handler)
  },
  writeTextAsFile: (text: string, name?: string) =>
    ipcRenderer.invoke('clipboard:write-text-as-file', { text, name }) as Promise<{ success: boolean; path?: string; error?: string }>,
  openLogsDir: () => ipcRenderer.invoke('app:open-logs') as Promise<boolean>,
  onWindowMaximizeChanged: (callback: (maximized: boolean) => void) => {
    const handler = (_event: any, maximized: boolean) => callback(maximized)
    ipcRenderer.on('window:maximize-changed', handler)
    return () => ipcRenderer.removeListener('window:maximize-changed', handler)
  },
  closeWindow: () => ipcRenderer.invoke('window:close'),

  // Auto-start
  getAutoStart: () =>
    ipcRenderer.invoke('autostart:get') as Promise<{ autoStart: boolean; startMinimized: boolean }>,
  setAutoStart: (settings: { autoStart?: boolean; startMinimized?: boolean }) =>
    ipcRenderer.invoke('autostart:set', settings) as Promise<{ success: boolean }>,

  // Shortcut
  getShortcut: () => ipcRenderer.invoke('shortcut:get'),
  updateShortcut: (newShortcut: string) =>
    ipcRenderer.invoke('shortcut:update', newShortcut),

  // Dialog & Shell
  selectDirectory: () =>
    ipcRenderer.invoke('dialog:select-directory') as Promise<{ canceled: boolean; path: string | null }>,
  openFolder: (dirPath: string) =>
    ipcRenderer.invoke('shell:open-folder', dirPath),
  changeStoragePath: (newPath: string) =>
    ipcRenderer.invoke('storage:change-path', newPath) as Promise<{ success: boolean; error?: string }>,
  getConfigPath: () =>
    ipcRenderer.invoke('config:get-path') as Promise<string>,

  // Retention rules
  getRetention: () =>
    ipcRenderer.invoke('settings:get-retention') as Promise<{ retentionDays: number | 'forever'; maxRecords: number }>,
  setRetention: (settings: { retentionDays?: number | 'forever'; maxRecords?: number }) =>
    ipcRenderer.invoke('settings:set-retention', settings) as Promise<{ success: boolean }>,

  // Capture rules (ignore patterns / dedupe toggle)
  getCaptureRules: () =>
    ipcRenderer.invoke('settings:get-capture-rules') as Promise<{ ignorePatterns: string[]; dedupeOnCapture: boolean }>,
  setCaptureRules: (settings: { ignorePatterns?: string[]; dedupeOnCapture?: boolean }) =>
    ipcRenderer.invoke('settings:set-capture-rules', settings) as Promise<{ success: boolean }>,

  // Cloud sync (WebDAV, multi-device)
  getCloudSyncConfig: () =>
    ipcRenderer.invoke('cloud-sync:get-config') as Promise<CloudSyncConfig>,
  getCloudSyncStatus: () =>
    ipcRenderer.invoke('cloud-sync:get-status') as Promise<CloudSyncStatus>,
  toggleWebDav: (config: Partial<CloudSyncConfig>, state: boolean) =>
    ipcRenderer.invoke('webdav:toggle', config, state) as Promise<WebDavToggleResult>,
  cloudSyncNow: () =>
    ipcRenderer.invoke('cloud-sync:sync-now') as Promise<{ ok: boolean; error?: string; status: CloudSyncStatus }>,
  onCloudSyncPulled: (callback: (items: CloudSyncPulledItem[]) => void) => {
    const handler = (_event: any, items: CloudSyncPulledItem[]) => callback(items)
    ipcRenderer.on('cloud-sync:pulled', handler)
    return () => ipcRenderer.removeListener('cloud-sync:pulled', handler)
  },

  // LAN file transfer (phone ↔ PC, ported from Tiez)
  ftToggle: (enabled: boolean, port?: number) =>
    ipcRenderer.invoke('ft:toggle', enabled, port) as Promise<{ success: boolean; port: number; error?: string }>,
  ftStatus: () => ipcRenderer.invoke('ft:status') as Promise<FtStatus>,
  ftGetSettings: () => ipcRenderer.invoke('ft:get-settings') as Promise<FtSettings>,
  ftSetSetting: (key: 'fileTransferAutoOpen' | 'fileTransferAutoClose' | 'fileTransferAutoCopy' | 'fileTransferBindIp', value: boolean | string) =>
    ipcRenderer.invoke('ft:set-setting', key, value) as Promise<boolean>,
  ftGetAvailableIps: () => ipcRenderer.invoke('ft:get-available-ips') as Promise<string[]>,
  ftSetDisplayIp: (ip: string) => ipcRenderer.invoke('ft:set-display-ip', ip) as Promise<void>,
  ftGetChatHistory: () => ipcRenderer.invoke('ft:get-chat-history') as Promise<FtMessage[]>,
  ftSendChatText: (content: string) => ipcRenderer.invoke('ft:send-chat-text', content) as Promise<boolean>,
  ftSendFile: (filePath: string) =>
    ipcRenderer.invoke('ft:send-file', filePath) as Promise<{ success: boolean; error?: string }>,
  ftGetActivePath: () => ipcRenderer.invoke('ft:get-active-path') as Promise<string>,
  ftChooseSavePath: () =>
    ipcRenderer.invoke('ft:choose-save-path') as Promise<{ canceled: boolean; path?: string }>,
  ftSaveTempImage: (base64Data: string) => ipcRenderer.invoke('ft:save-temp-image', base64Data) as Promise<string>,
  ftGetAppLogo: () => ipcRenderer.invoke('ft:get-app-logo') as Promise<string>,
  ftReadFileDataUrl: (filePath: string) => ipcRenderer.invoke('ft:read-file-data-url', filePath) as Promise<string>,
  ftOpenPath: (target: string) => ipcRenderer.invoke('ft:open-path', target) as Promise<boolean>,
  ftSaveFileCopy: (sourcePath: string, targetPath: string) =>
    ipcRenderer.invoke('ft:save-file-copy', sourcePath, targetPath) as Promise<boolean>,
  ftSaveFileAs: (sourcePath: string, defaultName: string) =>
    ipcRenderer.invoke('ft:save-file-as', sourcePath, defaultName) as Promise<{ canceled: boolean; path?: string }>,
  ftPickFiles: () => ipcRenderer.invoke('ft:pick-files') as Promise<string[]>,
  /** 拖拽的 File 对象 → 磁盘绝对路径（Electron ≥32 移除 File.path 后的唯一途径） */
  ftPathForFile: (file: File) => webUtils.getPathForFile(file),
  onFtStatusChanged: (callback: (status: FtStatus) => void) => {
    const handler = (_event: any, status: FtStatus) => callback(status)
    ipcRenderer.on('ft:status-changed', handler)
    return () => ipcRenderer.removeListener('ft:status-changed', handler)
  },
  onFtDevicesUpdated: (callback: (devices: FtDeviceInfo[]) => void) => {
    const handler = (_event: any, devices: FtDeviceInfo[]) => callback(devices)
    ipcRenderer.on('ft:devices-updated', handler)
    return () => ipcRenderer.removeListener('ft:devices-updated', handler)
  },
  onFtNewMessage: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('ft:new-message', handler)
    return () => ipcRenderer.removeListener('ft:new-message', handler)
  },

  // App version
  getVersion: () =>
    ipcRenderer.invoke('app:get-version') as Promise<string>,

  // Auto-update (electron-updater)
  checkUpdate: () =>
    ipcRenderer.invoke('update:check') as Promise<{ success: boolean; error?: string }>,
  installUpdate: () =>
    ipcRenderer.invoke('update:install') as Promise<{ success: boolean; error?: string }>,
  onUpdateStatus: (callback: (status: any) => void) => {
    const handler = (_event: any, status: any) => callback(status)
    ipcRenderer.on('update-status', handler)
    return () => ipcRenderer.removeListener('update-status', handler)
  },

  // Backup / Export
  exportDb: () =>
    ipcRenderer.invoke('data:export-db') as Promise<{ success: boolean; canceled?: boolean; path?: string; imagesCopied?: boolean; error?: string }>,
  exportJson: () =>
    ipcRenderer.invoke('data:export-json') as Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>,
  importJson: () =>
    ipcRenderer.invoke('data:import-json') as Promise<{ success: boolean; canceled?: boolean; count?: number; duplicates?: number; error?: string }>,

  // Tray → renderer events
  onOpenSettings: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('open-settings', handler)
    return () => ipcRenderer.removeListener('open-settings', handler)
  },
})
