export function readText(): Promise<string> {
  return window.electronAPI!.floralClipboard("read");
}

export function writeText(text: string): Promise<void> {
  return window.electronAPI!.floralClipboard("write", text);
}
