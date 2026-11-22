import { clipboard, ClipboardItem, type BrowserWindow } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { NativeImage } from 'electron'

const LEGACY_FILES = 'electron application/osclipboard;format="FileNameW"'

export async function readClipboardSnapshot() {
  const [item] = await clipboard.read()
  const get = async (type: 'image/png' | 'image/jpeg' | 'text/uri-list' | typeof LEGACY_FILES | 'text/html' | 'text/plain') =>
    item?.types.includes(type) ? item.getType(type) : undefined
  const imageType = item?.types.includes('image/png') ? 'image/png' : 'image/jpeg'
  const image = await get(imageType)
  if (image?.size) return { image: Buffer.from(await image.arrayBuffer()), imageType, files: [], html: '', text: '' }

  const uris = await (await get('text/uri-list'))?.text()
  const files = (uris ?? '').split(/\r?\n/).flatMap((uri) => {
    try { return [fileURLToPath(uri)] } catch { return [] }
  })
  if (!files.length) {
    const legacy = await get(LEGACY_FILES)
    if (legacy) files.push(...Buffer.from(await legacy.arrayBuffer()).toString('utf16le').split('\0').filter(Boolean))
  }
  if (files.length) return { files, text: '', html: '' }
  const html = await (await get('text/html'))?.text() ?? ''
  const text = await (await get('text/plain'))?.text() ?? ''
  return { files, html, text: text.trim() }
}

export async function writeClipboardImage(image: NativeImage): Promise<Buffer> {
  const png = image.toPNG()
  await clipboard.write([new ClipboardItem({
    'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }),
  })])
  return png
}

export function writeClipboardFiles(files: string[]): Promise<void> {
  return clipboard.write([new ClipboardItem({
    'text/uri-list': files.map((file) => pathToFileURL(file).href).join('\r\n'),
  })])
}

export function listenForClipboardChanges(window: BrowserWindow, onChange: () => void) {
  if (process.platform !== 'win32') return null
  const koffi = require('koffi') as typeof import('koffi')
  const user32 = koffi.load('user32.dll')
  const add = user32.func('int __stdcall AddClipboardFormatListener(uintptr_t window)')
  const remove = user32.func('int __stdcall RemoveClipboardFormatListener(uintptr_t window)')
  const sequence = user32.func('uint32_t __stdcall GetClipboardSequenceNumber()')
  const buffer = window.getNativeWindowHandle()
  const handle = buffer.length >= 8 ? buffer.readBigUInt64LE() : buffer.readUInt32LE()
  const updateMessage = 0x031d // WM_CLIPBOARDUPDATE
  window.hookWindowMessage(updateMessage, onChange)
  if (!add(handle)) {
    window.unhookWindowMessage(updateMessage)
    throw new Error('AddClipboardFormatListener failed')
  }
  return {
    sequence: () => Number(sequence()),
    stop: () => {
      if (window.isDestroyed()) return
      remove(handle)
      window.unhookWindowMessage(updateMessage)
    },
  }
}
