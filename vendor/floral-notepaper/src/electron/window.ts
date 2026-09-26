const currentWindow = {
  label: "main",
  show: () => window.electronAPI!.floralWindow("show"),
  hide: () => window.electronAPI!.floralWindow("hide"),
  close: () => window.electronAPI!.floralWindow("close"),
  minimize: () => window.electronAPI!.floralWindow("minimize"),
  toggleMaximize: () => window.electronAPI!.floralWindow("toggleMaximize"),
  isMaximized: () => window.electronAPI!.floralWindow("isMaximized"),
  setFocus: () => window.electronAPI!.floralWindow("focus"),
  setAlwaysOnTop: (value: boolean) => window.electronAPI!.floralWindow("setAlwaysOnTop", value),
  startDragging: () => window.electronAPI!.floralWindow("startDragging"),
  startResizeDragging: (_direction: string) => Promise.resolve(),
  outerPosition: () => window.electronAPI!.floralWindow("outerPosition"),
  innerSize: () => window.electronAPI!.floralWindow("innerSize"),
  setPosition: (position: { x: number; y: number }) => window.electronAPI!.floralWindow("setPosition", position),
  setSize: (size: { width: number; height: number }) => window.electronAPI!.floralWindow("setSize", size),
  onDragDropEvent: (_handler: (event: unknown) => void) => Promise.resolve(() => {}),
  onResized: (_handler: () => void) => Promise.resolve(() => {}),
};

export function getCurrentWindow() {
  return currentWindow;
}
