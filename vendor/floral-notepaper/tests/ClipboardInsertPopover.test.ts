import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  importClipboardItem,
  listClipboardHistory,
} from "../src/features/clipboardHistory/api";
import { ClipboardInsertPopover } from "../src/components/ClipboardInsertPopover";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

afterEach(() => {
  invokeMock.mockReset();
});

describe("Floral clipboard history integration", () => {
  it("invokes qpaste_clipboard_list and qpaste_clipboard_import with expected args", async () => {
    invokeMock.mockResolvedValueOnce([]);
    await listClipboardHistory({ limit: 15, search: "报销" });
    expect(invokeMock).toHaveBeenCalledWith("qpaste_clipboard_list", {
      limit: 15,
      search: "报销",
    });

    invokeMock.mockResolvedValueOnce({ kind: "image", text: "![](images/n1/a.png)", relPath: "images/n1/a.png" });
    const imported = await importClipboardItem(42, "note-1");
    expect(invokeMock).toHaveBeenCalledWith("qpaste_clipboard_import", {
      itemId: 42,
      noteId: "note-1",
    });
    expect(imported.text).toBe("![](images/n1/a.png)");
  });

  it("renders ClipboardInsertPopover shell when open and null when closed", () => {
    const closedMarkup = renderToStaticMarkup(
      createElement(ClipboardInsertPopover, {
        open: false,
        onClose: () => {},
        onPick: async () => {},
      }),
    );
    expect(closedMarkup).toBe("");

    const openMarkup = renderToStaticMarkup(
      createElement(ClipboardInsertPopover, {
        open: true,
        onClose: () => {},
        onPick: async () => {},
      }),
    );
    expect(openMarkup).toContain('data-testid="clipboard-insert-popover"');
    expect(openMarkup).toContain("Q-Paste 剪贴板");
    expect(openMarkup).toContain("bg-paper-card");
  });

  it("defines opaque --color-paper-card token in both light and dark themes", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../src/App.css"), "utf8");
    const matches = css.match(/--color-paper-card:\s*#[0-9a-fA-F]{6};/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
