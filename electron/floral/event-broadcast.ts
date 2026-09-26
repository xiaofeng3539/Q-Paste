interface FloralEventWindow {
  isDestroyed(): boolean
  webContents: { send(channel: string, payload: unknown): void }
}

export function broadcastFloralEvent(
  surfaceWindows: Iterable<FloralEventWindow>,
  mainWindow: FloralEventWindow | null,
  name: string,
  payload: unknown,
): void {
  const channel = `floral:event:${name}`
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
  for (const window of surfaceWindows) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}
