import { useEffect, useRef, useState } from "react";
import {
  listClipboardHistory,
  type ClipboardHistoryEntry,
} from "../features/clipboardHistory/api";

interface ClipboardInsertPopoverProps {
  open: boolean;
  onClose: () => void;
  onPick: (entry: ClipboardHistoryEntry) => Promise<void>;
}

function typeLabel(type: string): string {
  switch (type) {
    case "url":
      return "链接";
    case "image":
      return "图片";
    case "html":
      return "富文本";
    case "files":
      return "文件";
    default:
      return "文本";
  }
}

function shortStamp(createdAt: string): string {
  const m = createdAt.match(/(\d{2}-\d{2})\s+(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : createdAt.slice(0, 16);
}

export function ClipboardInsertPopover({
  open,
  onClose,
  onPick,
}: ClipboardInsertPopoverProps) {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<ClipboardHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setError(null);
      setImportingId(null);
      return;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void listClipboardHistory({ limit: 20, search })
        .then((rows) => {
          if (!cancelled) setItems(Array.isArray(rows) ? rows : []);
        })
        .catch((err) => {
          if (!cancelled) {
            setItems([]);
            setError(err instanceof Error ? err.message : "读取剪贴板历史失败");
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, search ? 150 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, search]);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      data-testid="clipboard-insert-popover"
      className="absolute left-0 top-full mt-1.5 z-[120] w-[320px] max-w-[80vw] rounded-xl bg-paper-card border border-paper-deep/90 shadow-[0_12px_32px_var(--color-shadow-deep)] ring-1 ring-black/5 overflow-hidden flex flex-col"
    >
      <div className="px-3 py-2 bg-paper-warm/45 border-b border-paper-deep/60 flex items-center gap-2">
        <span className="text-[11px] font-medium text-ink shrink-0">Q-Paste 剪贴板</span>
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索历史..."
          className="flex-1 min-w-0 h-6 px-2 rounded-md bg-paper-card border border-paper-deep/75 text-[11px] text-ink placeholder:text-ink-ghost outline-none focus:border-bamboo/75"
        />
      </div>

      <div className="max-h-[320px] overflow-y-auto p-1.5 space-y-0.5">
        {loading && items.length === 0 ? (
          <div className="py-6 text-center text-[11px] text-ink-faint">正在读取剪贴板...</div>
        ) : error ? (
          <div className="py-5 px-3 text-center text-[11px] text-red-500">{error}</div>
        ) : items.length === 0 ? (
          <div className="py-6 text-center text-[11px] text-ink-faint">暂无匹配的剪贴板记录</div>
        ) : (
          items.map((entry) => {
            const busy = importingId === entry.id;
            const titleText = entry.isSensitive
              ? "••••••（敏感内容）"
              : entry.alias || entry.preview || (entry.type === "image" ? "剪贴板图片" : "空内容");
            return (
              <button
                key={entry.id}
                type="button"
                disabled={importingId !== null}
                onMouseDown={(event) => event.preventDefault()}
                onClick={async () => {
                  setImportingId(entry.id);
                  try {
                    await onPick(entry);
                  } finally {
                    setImportingId(null);
                  }
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-paper-warm transition-colors cursor-pointer disabled:opacity-50"
              >
                {entry.type === "image" && entry.thumbnail ? (
                  <img
                    src={entry.thumbnail}
                    alt=""
                    className="w-10 h-7 rounded object-cover shrink-0 border border-paper-deep/60 bg-paper-warm"
                  />
                ) : (
                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-bamboo-mist/70 text-bamboo">
                    {typeLabel(entry.type)}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] text-ink truncate leading-snug">
                    {busy ? "正在插入..." : titleText}
                  </div>
                  <div className="text-[10px] text-ink-faint font-mono tabular-nums mt-0.5">
                    {shortStamp(entry.createdAt)}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
