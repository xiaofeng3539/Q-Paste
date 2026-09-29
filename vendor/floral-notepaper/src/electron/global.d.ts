export {};

declare global {
  interface Window {
    electronAPI?: {
      switchAppMode: (mode: "clipboard" | "floral", deleteShortcut?: string) => Promise<{ success: boolean }>;
      getSharedDeleteShortcut: () => Promise<string>;
      floralInvoke: (command: string, args?: unknown, options?: unknown) => Promise<any>;
      floralListen: (event: string, listener: (payload: any) => void) => Promise<() => void>;
      floralEmit: (event: string, payload?: unknown) => Promise<void>;
      floralDialog: (kind: "open" | "save" | "message", options?: unknown) => Promise<any>;
      floralClipboard: (kind: "read" | "write", text?: string) => Promise<any>;
      floralOpenUrl: (url: string) => Promise<void>;
      floralWindow: (method: string, ...args: unknown[]) => Promise<any>;
      onWindowMaximizeChanged?: (callback: (maximized: boolean) => void) => () => void;
      floralVersion: () => Promise<string>;
      checkUpdate: () => Promise<{ success: boolean; error?: string }>;
      installUpdate: () => Promise<{ success: boolean; error?: string }>;
      getUpdateStatus: () => Promise<{ status: string; version?: string; percent?: number; message?: string }>;
      onUpdateStatus: (callback: (status: { status: string; version?: string; percent?: number; message?: string }) => void) => () => void;
      floralAssetUrl: (path: string) => Promise<string>;
    };
  }
}
