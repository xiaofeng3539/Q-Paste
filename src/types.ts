export type ItemType = 'text' | 'url' | 'image'

export interface ClipboardItem {
  id: number
  type: ItemType
  content: string
  preview: string
  char_count: number
  storage_size: number
  created_at: string
}

export interface ElectronAPI {
  getItems: (params: { limit: number; offset: number }) => Promise<ClipboardItem[]>
  insertItem: (item: { type: string; content: string; preview: string; charCount: number; storageSize: number }) => Promise<number>
  deleteItem: (id: number) => Promise<boolean>
  updateItem: (params: { id: number; content: string; preview: string; charCount: number; storageSize: number }) => Promise<boolean>
  getItemCount: () => Promise<number>
  writeText: (text: string) => Promise<boolean>
  writeImage: (dataUrl: string) => Promise<boolean>
  onClipboardChanged: (callback: (data: ClipboardChangedData) => void) => () => void
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  getShortcut: () => Promise<string>
  updateShortcut: (newShortcut: string) => Promise<{ success: boolean; shortcut: string }>
}

export interface ClipboardChangedData {
  type: ItemType
  content: string
  preview: string
  charCount?: number
  storageSize?: number
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
