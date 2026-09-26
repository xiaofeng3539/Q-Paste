export function getVersion(): Promise<string> {
  return window.electronAPI!.floralVersion();
}
