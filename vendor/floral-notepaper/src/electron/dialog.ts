export function open(options?: unknown): Promise<string | string[] | null> {
  return window.electronAPI!.floralDialog("open", options);
}

export function save(options?: unknown): Promise<string | null> {
  return window.electronAPI!.floralDialog("save", options);
}

export function message(message: string, options?: unknown): Promise<void> {
  return window.electronAPI!.floralDialog("message", { message, ...((options as object) || {}) });
}
