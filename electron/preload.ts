import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Database
  getItems: (params: { limit: number; offset: number }) =>
    ipcRenderer.invoke('db:get-items', params),
  insertItem: (item: { type: string; content: string; preview: string; charCount: number; storageSize: number }) =>
    ipcRenderer.invoke('db:insert-item', item),
  deleteItem: (id: number) =>
    ipcRenderer.invoke('db:delete-item', id),
  forceClearData: (type: string) =>
    ipcRenderer.invoke('force-clear-data', type) as Promise<{ success: boolean; error?: string }>,
  updateItem: (params: { id: number; content: string; preview: string; charCount: number; storageSize: number }) =>
    ipcRenderer.invoke('db:update-item', params),
  getItemCount: () =>
    ipcRenderer.invoke('db:get-item-count'),
  getStorageUsage: () =>
    ipcRenderer.invoke('db:get-storage-usage') as Promise<{ textBytes: number; imageBytes: number; totalBytes: number }>,

  // Clipboard
  writeText: (text: string) =>
    ipcRenderer.invoke('clipboard:write-text', text),
  writeImage: (dataUrl: string) =>
    ipcRenderer.invoke('clipboard:write-image', dataUrl),

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
    ipcRenderer.invoke('storage:change-path', newPath),
  getConfigPath: () =>
    ipcRenderer.invoke('config:get-path') as Promise<string>,
})
