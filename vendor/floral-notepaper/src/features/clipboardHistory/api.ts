import { invoke } from "@tauri-apps/api/core";

export interface ClipboardHistoryEntry {
  id: number;
  type: "text" | "url" | "image" | "html" | "files" | string;
  preview: string;
  alias: string;
  createdAt: string;
  storageSize: number;
  isSensitive: boolean;
  thumbnail: string;
}

export interface ClipboardImportResult {
  kind: "text" | "image";
  text: string;
  relPath?: string;
}

export function listClipboardHistory(params?: {
  limit?: number;
  search?: string;
}): Promise<ClipboardHistoryEntry[]> {
  return invoke<ClipboardHistoryEntry[]>("qpaste_clipboard_list", {
    limit: params?.limit ?? 20,
    search: params?.search ?? "",
  });
}

export function importClipboardItem(
  itemId: number,
  noteId?: string,
): Promise<ClipboardImportResult> {
  return invoke<ClipboardImportResult>("qpaste_clipboard_import", {
    itemId,
    noteId: noteId ?? "",
  });
}
