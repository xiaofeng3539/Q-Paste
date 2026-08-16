import { contextBridge, ipcRenderer } from 'electron'

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
    ipcRenderer.invoke('data:import-json') as Promise<{ success: boolean; canceled?: boolean; count?: number; error?: string }>,

  // Tray → renderer events
  onOpenSettings: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('open-settings', handler)
    return () => ipcRenderer.removeListener('open-settings', handler)
  },
})
