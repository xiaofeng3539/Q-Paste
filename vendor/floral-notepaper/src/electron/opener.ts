export function openUrl(url: string): Promise<void> {
  return window.electronAPI!.floralOpenUrl(url);
}
