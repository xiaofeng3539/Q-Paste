interface FloralSurfaceWindow {
  webContents: object
  isDestroyed(): boolean
}

export function findFloralSurfaceWindow<T extends FloralSurfaceWindow>(
  windows: Iterable<T>,
  sender: object,
): T | undefined {
  return [...windows].find((window) => !window.isDestroyed() && window.webContents === sender)
}
