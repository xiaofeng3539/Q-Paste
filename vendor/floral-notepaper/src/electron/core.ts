export function invoke<T>(command: string, args?: unknown, options?: unknown): Promise<T> {
  return window.electronAPI!.floralInvoke(command, args, options);
}

export function convertFileSrc(path: string): Promise<string> {
  return window.electronAPI!.floralAssetUrl(path);
}
