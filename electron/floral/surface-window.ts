interface FloralSurfaceWindow {
  webContents: object
  isDestroyed(): boolean
}

interface Bounds { x: number; y: number; width: number; height: number }

export function installFloralNativeDrag(
  window: {
    hookWindowMessage(message: number, callback: (wParam: Buffer, lParam: Buffer) => void): void
    on?(event: 'move', callback: () => void): unknown
  },
  onDoubleClick: (point?: { x: number; y: number }) => void,
): void {
  // CSS app-region delegates moving to Windows. Forward non-client double
  // clicks separately because Chromium does not dispatch DOM events there.
  window.hookWindowMessage(0x00a3, (wParam) => {
    if (wParam.readUInt32LE(0) === 2) onDoubleClick() // WM_NCLBUTTONDBLCLK / HTCAPTION
  })
  // Chromium owns a child HWND. Its clicks reach the BrowserWindow as
  // WM_PARENTNOTIFY / WM_LBUTTONDOWN, not WM_NCLBUTTONDBLCLK.
  let previous: { x: number; y: number; at: number } | null = null
  window.on?.('move', () => { previous = null })
  window.hookWindowMessage(0x0210, (wParam, lParam) => {
    if ((wParam.readUInt32LE(0) & 0xffff) !== 0x0201) return
    const point = { x: lParam.readInt16LE(0), y: lParam.readInt16LE(2), at: Date.now() }
    if (previous && point.at - previous.at <= 500 && Math.abs(point.x - previous.x) <= 6 && Math.abs(point.y - previous.y) <= 6) {
      previous = null
      onDoubleClick({ x: point.x, y: point.y })
    } else previous = point
  })
}

/** All values are Electron DIP coordinates, including work areas on scaled displays. */
export function fitFloralTileBounds(current: Bounds, requested: { width: number; height: number }, area: Bounds): Bounds {
  const maxWidth = Math.max(1, area.width - 32)
  const maxHeight = Math.max(1, area.height - 32)
  const width = Math.min(maxWidth, Math.max(240, Math.ceil(Number(requested.width) || 240)))
  const height = Math.min(maxHeight, Math.max(96, Math.ceil(Number(requested.height) || 96)))
  const x = Math.max(area.x + 16, Math.min(current.x, area.x + area.width - 16 - width))
  const y = Math.max(area.y + 16, Math.min(current.y, area.y + area.height - 16 - height))
  return { x, y, width, height }
}

export function findFloralSurfaceWindow<T extends FloralSurfaceWindow>(
  windows: Iterable<T>,
  sender: object,
): T | undefined {
  return [...windows].find((window) => !window.isDestroyed() && window.webContents === sender)
}

/** Keep the host registry in sync when a pad becomes a pinned tile (and back). */
export function registerFloralSurfaceMode<T extends FloralSurfaceWindow>(
  windows: Map<string, T>, sender: object, mode: 'pad' | 'tile', noteId: string,
): void {
  const window = findFloralSurfaceWindow(windows.values(), sender)
  if (!window) throw new Error('Floral surface window not found')
  if (mode !== 'pad' && mode !== 'tile') throw new Error('Invalid surface mode')
  if (mode === 'tile' && !noteId) throw new Error('Save the note before pinning')
  const nextKey = mode === 'tile' ? `tile:${noteId}` : `notepad:${noteId || 'new'}`
  const existing = windows.get(nextKey)
  if (existing && existing !== window && !existing.isDestroyed()) throw new Error('Note already has an open surface')
  for (const [key, candidate] of windows) {
    if (candidate === window) windows.delete(key)
  }
  windows.set(nextKey, window)
}
