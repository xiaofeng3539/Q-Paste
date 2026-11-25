import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import { openUrl } from "@tauri-apps/plugin-opener";
import { convertFileSrc } from "../../electron/core";
import type { Components } from "react-markdown";
import "katex/dist/katex.min.css";
import remarkAlerts from "./remarkAlerts";
import { resolveMarkdownImageSrc } from "./imageSrc";

function ImageViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, x: 0, y: 0 });
  const reset = () => setView({ scale: 1, x: 0, y: 0 });
  const { t } = useTranslation();
  useEffect(() => {
    // 原生模态框负责焦点限制、Esc 和关闭后的焦点恢复，不受预览区裁剪影响。
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!event.deltaY) return;
      const rect = dialog.getBoundingClientRect();
      const cx = event.clientX - rect.left - rect.width / 2;
      const cy = event.clientY - rect.top - rect.height / 2;
      setView((previous) => {
        const scale = Math.min(10, Math.max(0.1, previous.scale + (event.deltaY > 0 ? -0.1 : 0.1)));
        const ratio = scale / previous.scale;
        return { scale, x: cx - ratio * (cx - previous.x), y: cy - ratio * (cy - previous.y) };
      });
    };
    // 非被动监听才能阻止滚轮同时滚动底下的笔记。
    dialog.addEventListener("wheel", onWheel, { passive: false });
    return () => dialog.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: MouseEvent) => setView((previous) => ({
      ...previous,
      x: dragRef.current.x + event.clientX - dragRef.current.startX,
      y: dragRef.current.y + event.clientY - dragRef.current.startY,
    }));
    const onEnd = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("blur", onEnd);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("blur", onEnd);
    };
  }, [dragging]);

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-label={t("markdown.imagePreview", { defaultValue: "图片预览" })}
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="m-auto p-0 border-0 bg-black/90 text-white backdrop:bg-black/70 overflow-hidden"
      style={{ width: "100vw", height: "100vh", maxWidth: "100vw", maxHeight: "100vh" }}
    >
      <div className="absolute top-0 left-0 right-0 h-12 flex items-center justify-between px-4 z-10 pointer-events-none">
        <span className="text-xs text-zinc-400">
          {t("markdown.imageControls", { defaultValue: "滚轮缩放 · 拖拽平移 · 双击重置" })} · {Math.round(view.scale * 100)}%
        </span>
        <div className="flex gap-2 pointer-events-auto">
          <button
            type="button"
            title={t("markdown.resetImage", { defaultValue: "重置" })}
            aria-label={t("markdown.resetImage", { defaultValue: "重置" })}
            onClick={reset}
            className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-zinc-400 cursor-pointer"
          >↺</button>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label={t("markdown.closeImagePreview", { defaultValue: "关闭图片预览" })}
            className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-zinc-400 cursor-pointer"
          >×</button>
        </div>
      </div>
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="absolute rounded-lg select-none"
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          dragRef.current = { startX: event.clientX, startY: event.clientY, x: view.x, y: view.y };
          setDragging(true);
        }}
        onDoubleClick={(event) => { event.stopPropagation(); reset(); }}
        style={{
          width: "90vw", height: "80vh", objectFit: "contain", top: "50%", left: "50%",
          transform: `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px)) scale(${view.scale})`,
          transformOrigin: "center center", cursor: dragging ? "grabbing" : "grab",
        }}
      />
    </dialog>,
    document.body,
  );
}

function MarkdownImage({
  src,
  alt,
  imageBaseDir,
  ...props
}: React.ComponentProps<"img"> & { src?: string; imageBaseDir?: string }) {
  const [resolvedSrc, setResolvedSrc] = useState(src ?? "");
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    let cancelled = false;
    void resolveMarkdownImageSrc(src, imageBaseDir, convertFileSrc)
      .then((url) => {
        if (!cancelled) setResolvedSrc(url);
      })
      .catch(() => {
        if (!cancelled) setResolvedSrc("");
      });
    return () => {
      cancelled = true;
    };
  }, [src, imageBaseDir]);

  return <>
    <img
      {...props}
      src={resolvedSrc}
      alt={alt ?? ""}
      role="button"
      tabIndex={0}
      title={t("markdown.enlargeImage", { defaultValue: "双击放大图片" })}
      style={{ ...props.style, cursor: "zoom-in" }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (resolvedSrc) setExpanded(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          if (resolvedSrc) setExpanded(true);
        }
      }}
    />
    {expanded && <ImageViewer src={resolvedSrc} alt={alt ?? ""} onClose={() => setExpanded(false)} />}
  </>;
}

function CodeBlock({ children, language }: { children: React.ReactNode; language?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = extractText(children);
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [children]);

  return (
    <div className="markdown-code-block my-3 relative group">
      <pre
        className={`markdown-code-scroll m-0 px-4 rounded bg-paper-warm/80 overflow-x-auto ${
          language ? "pt-8 pb-3" : "py-3"
        }`}
      >
        {children}
      </pre>
      {language && (
        <span className="absolute top-2 left-3 text-[10px] font-mono text-ink-faint/70 uppercase tracking-wider select-none">
          {language}
        </span>
      )}
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-mono bg-paper-deep/30 text-ink-ghost opacity-0 group-hover:opacity-100 hover:bg-paper-deep/50 hover:text-ink-soft transition-all cursor-pointer"
      >
        {copied
          ? t("markdown.copied", { defaultValue: "已复制" })
          : t("markdown.copy", { defaultValue: "复制" })}
      </button>
    </div>
  );
}

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    return extractText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return "";
}

interface MarkdownPreviewProps {
  content: string;
  fontSize?: number;
  renderHtml?: boolean;
  imageBaseDir?: string;
}

const remarkPlugins = [remarkGfm, remarkMath, remarkAlerts];
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark", "center", "font", "u", "abbr"],
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      ...(defaultSchema.attributes?.["*"] ?? []),
      "style",
      "className",
      "data-alert-type",
      "dataAlertType",
    ],
    font: ["color", "size", "face"],
    abbr: ["title"],
  },
};
const rehypePluginsDefault = [rehypeKatex, rehypeSlug];
const rehypePluginsWithHtml = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  rehypeKatex,
  rehypeSlug,
] as Parameters<typeof Markdown>[0]["rehypePlugins"];

function AlertIcon({ type }: { type: string }) {
  switch (type) {
    case "note":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
        </svg>
      );
    case "tip":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.149-.176.214-.253.56-.679.984-1.32.984-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z" />
        </svg>
      );
    case "important":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
        </svg>
      );
    case "warning":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.396A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.557ZM8.22 2.097a.25.25 0 0 0-.44 0L1.698 13.493a.25.25 0 0 0 .22.382h12.164a.25.25 0 0 0 .22-.382Z" />
          <path d="M8.75 5.75a.75.75 0 0 0-1.5 0v2.5a.75.75 0 0 0 1.5 0v-2.5ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
        </svg>
      );
    case "caution":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
        </svg>
      );
    default:
      return null;
  }
}

function Blockquote({
  children,
  node,
}: {
  children?: React.ReactNode;
  node?: { properties?: Record<string, unknown> };
}) {
  const { t } = useTranslation();
  const alertType =
    ((node?.properties?.dataAlertType || node?.properties?.["data-alert-type"]) as string) ?? "";
  if (alertType) {
    const alertTitleMap: Record<string, string> = {
      note: t("markdown.alert.note", { defaultValue: "备注" }),
      tip: t("markdown.alert.tip", { defaultValue: "提示" }),
      important: t("markdown.alert.important", { defaultValue: "重要" }),
      warning: t("markdown.alert.warning", { defaultValue: "警告" }),
      caution: t("markdown.alert.caution", { defaultValue: "注意" }),
    };

    return (
      <div className={`markdown-alert markdown-alert-${alertType}`} role="note">
        <p className="markdown-alert-title">
          <AlertIcon type={alertType} />
          {alertTitleMap[alertType] ?? alertType.toUpperCase()}
        </p>
        {children}
      </div>
    );
  }
  return (
    <blockquote className="border-l-2 border-bamboo/40 pl-4 my-3 text-ink-soft/80 italic leading-[1.9]">
      {children}
    </blockquote>
  );
}

const staticComponents: Components = {
  h1: ({ children, id }) => (
    <h1 id={id} className="text-[1.57em] font-display font-bold text-ink mt-6 mb-4 tracking-wide">
      {children}
    </h1>
  ),
  h2: ({ children, id }) => (
    <h2 id={id} className="text-[1.21em] font-display font-bold text-ink mt-7 mb-3 tracking-wide">
      {children}
    </h2>
  ),
  h3: ({ children, id }) => (
    <h3 id={id} className="text-[1.07em] font-display font-bold text-ink mt-5 mb-2 tracking-wide">
      {children}
    </h3>
  ),
  h4: ({ children, id }) => (
    <h4 id={id} className="text-[1em] font-display font-semibold text-ink mt-4 mb-2 tracking-wide">
      {children}
    </h4>
  ),
  p: ({ children }) => <p className="text-ink-soft leading-[1.9]">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic text-bamboo-light">{children}</em>,
  blockquote: Blockquote,
  ul: ({ children }) => (
    <ul className="ml-4 text-ink-soft leading-[1.9] list-disc list-outside marker:text-bamboo/40">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="ml-4 text-ink-soft leading-[1.9] list-decimal list-outside marker:text-bamboo/50 marker:font-mono marker:text-[0.85em]">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="text-ink-soft leading-[1.9]">{children}</li>,
  hr: () => (
    <hr className="my-6 border-none h-px bg-gradient-to-r from-transparent via-paper-deep to-transparent" />
  ),
  code: ({ className, children }) => {
    const isBlock = className?.startsWith("language-") || String(children).includes("\n");
    if (isBlock) {
      return (
        <code className="text-[0.85em] font-mono text-ink-soft leading-[1.8] whitespace-pre">
          {children}
        </code>
      );
    }
    return (
      <code className="px-1.5 py-0.5 text-[0.85em] font-mono bg-paper-warm rounded text-bamboo">
        {children}
      </code>
    );
  },
  pre: ({ children }) => {
    // Extract language from the <code> element's className
    let language = "";
    if (
      children != null &&
      typeof children === "object" &&
      "props" in (children as React.ReactElement)
    ) {
      const codeProps = (children as React.ReactElement<{ className?: string }>).props;
      const match = codeProps.className?.match(/language-(\S+)/);
      if (match) language = match[1];
    }

    return <CodeBlock language={language}>{children}</CodeBlock>;
  },
  a: ({ href, children }) => (
    <a
      href={href}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!href) return;
        if (/^(?:https?:\/\/|mailto:)/i.test(href)) {
          void openUrl(href);
        } else if (href.startsWith("#")) {
          const id = decodeURIComponent(href.slice(1));
          document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
        }
      }}
      className="electron-no-drag text-bamboo hover:text-bamboo-light underline underline-offset-2 cursor-pointer"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full text-[0.93em] border-collapse border border-paper-deep/50">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="text-left px-3 py-1.5 border border-paper-deep/40 font-semibold text-ink text-[0.85em] bg-paper-warm/50">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-1.5 border border-paper-deep/35 text-ink-soft">{children}</td>
  ),
  input: ({ checked, ...props }) => (
    <input {...props} checked={checked} disabled className="mr-1.5 accent-bamboo" />
  ),
};

export function MarkdownPreview({
  content,
  fontSize = 14,
  renderHtml = false,
  imageBaseDir,
}: MarkdownPreviewProps) {
  const { t } = useTranslation();
  const components = useMemo<Components>(
    () => ({
      ...staticComponents,
      img: ({ src, alt, ...props }) => {
        return (
          <MarkdownImage
            src={src}
            alt={alt ?? ""}
            imageBaseDir={imageBaseDir}
            loading="lazy"
            className="w-[50%] rounded-md my-2 mx-auto block border border-paper-deep/55 shadow-[0_1px_4px_var(--color-shadow)]"
            {...props}
          />
        );
      },
    }),
    [imageBaseDir],
  );
  return (
    <div className="font-body markdown-selectable" style={{ fontSize: `${fontSize}px` }}>
      {content.trim() ? (
        <Markdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={renderHtml ? rehypePluginsWithHtml : rehypePluginsDefault}
          components={components}
        >
          {content}
        </Markdown>
      ) : (
        <p className="text-ink-ghost leading-[1.9]">
          {t("markdown.emptyHint", { defaultValue: "预览区会显示当前笔记内容" })}
        </p>
      )}
    </div>
  );
}
