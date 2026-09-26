export type UnlistenFn = () => void;

export function listen<T>(name: string, handler: (event: { payload: T }) => void): Promise<UnlistenFn> {
  return window.electronAPI!.floralListen(name, handler);
}

export function emit<T>(name: string, payload?: T): Promise<void> {
  return window.electronAPI!.floralEmit(name, payload);
}
