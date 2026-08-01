export type ItemType = 'text' | 'url' | 'image'

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
  /** 自定义别名 */
  alias: string
  /** 分类标签 */
  tags: string[]
  /** 是否为敏感数据 */
  is_sensitive: boolean
}

export interface UpdateMetaParams {
  id: number
  isPinned?: boolean
  alias?: string
  tags?: string
  isSensitive?: boolean
}

export interface ElectronAPI {
  getItems: (params: { limit: number; offset: number }) => Promise<ClipboardItem[]>
  insertItem: (item: { type: string; content: string; preview: string; charCount: number; storageSize: number; createdAt: string; isSensitive?: boolean }) => Promise<number>
  deleteItem: (id: number) => Promise<boolean>
  forceClearData: (type: 'images' | 'all') => Promise<{ success: boolean; error?: string }>
  updateItem: (params: { id: number; content: string; preview: string; charCount: number; storageSize: number }) => Promise<boolean>
  updateItemMeta: (params: UpdateMetaParams) => Promise<boolean>
  getItemCount: () => Promise<number>
  getStorageUsage: () => Promise<{ textBytes: number; imageBytes: number; totalBytes: number }>
  writeText: (text: string) => Promise<boolean>
  writeImage: (dataUrl: string) => Promise<boolean>
  onClipboardChanged: (callback: (data: ClipboardChangedData) => void) => () => void
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  getAutoStart: () => Promise<{ autoStart: boolean; startMinimized: boolean }>
  setAutoStart: (settings: { autoStart?: boolean; startMinimized?: boolean }) => Promise<{ success: boolean }>
  getShortcut: () => Promise<string>
  updateShortcut: (newShortcut: string) => Promise<{ success: boolean; shortcut: string }>
  selectDirectory: () => Promise<{ canceled: boolean; path: string | null }>
  openFolder: (dirPath: string) => Promise<void>
  changeStoragePath: (newPath: string) => Promise<void>
  getConfigPath: () => Promise<string>
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
