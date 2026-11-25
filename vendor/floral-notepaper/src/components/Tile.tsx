import chroma from "chroma-js";
import type { CSSProperties, HTMLAttributes } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { splitTextWithLinks } from "../features/notes/linkUtils";
import { DEFAULT_TILE_COLOR, normalizeTileColor, getTileTextColor } from "../features/settings/tileColor";
import { MarkdownPreviewLazy as MarkdownPreview } from "../features/markdown/MarkdownPreviewLazy";

export interface TileProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "color" | "content" | "title"
> {
  title?: string;
  content: string;
  color?: string;
  width?: number | string;
  rotation?: number;
  fontSize?: number;
  renderMarkdown?: boolean;
  imageBaseDir?: string;
}

const MARK_SIZE = 8;
const MARK_OFFSET = 6;

const cornerPaths = [
  {
    pos: { top: MARK_OFFSET, left: MARK_OFFSET },
    d: `M0,${MARK_SIZE} L0,0 L${MARK_SIZE},0`,
  },
  {
    pos: { top: MARK_OFFSET, right: MARK_OFFSET },
    d: `M0,0 L${MARK_SIZE},0 L${MARK_SIZE},${MARK_SIZE}`,
  },
  {
    pos: { bottom: MARK_OFFSET, left: MARK_OFFSET },
    d: `M0,0 L0,${MARK_SIZE} L${MARK_SIZE},${MARK_SIZE}`,
  },
  {
    pos: { bottom: MARK_OFFSET, right: MARK_OFFSET },
    d: `M${MARK_SIZE},0 L${MARK_SIZE},${MARK_SIZE} L0,${MARK_SIZE}`,
  },
];

function CornerMarks({ color }: { color: string }) {
  return (
    <>
      {cornerPaths.map((mark, index) => (
        <svg
          key={index}
          className="absolute pointer-events-none"
          data-tile-corner-mark="true"
          style={mark.pos as CSSProperties}
          width={MARK_SIZE}
          height={MARK_SIZE}
          viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`}
        >
          <path
            d={mark.d}
            stroke={color}
            strokeWidth="0.8"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </>
  );
}

export function Tile({
  title,
  content,
  color = DEFAULT_TILE_COLOR,
  width = 260,
  rotation = 0,
  fontSize = 14,
  renderMarkdown = false,
  imageBaseDir,
  className = "",
  style,
  children,
  ...divProps
}: TileProps) {
  const { t } = useTranslation();
  const tileColor = normalizeTileColor(color);
  const { borderColor, cornerColor, titleColor, contentColor, emptyColor, linkColor } = useMemo(() => {
    const isLightBg = chroma(tileColor).luminance() > 0.18;
    const mixTarget = isLightBg ? "#1a1a18" : "#ffffff";
    const textColor = getTileTextColor(tileColor);
    const candidateLink = isLightBg ? "#1f6a4a" : "#7dd3fc";
    return {
      borderColor: chroma.mix(tileColor, mixTarget, 0.18).alpha(0.55).css(),
      cornerColor: chroma.mix(tileColor, mixTarget, 0.3).alpha(0.26).css(),
      titleColor: textColor,
      contentColor: textColor,
      emptyColor: textColor,
      linkColor: chroma.contrast(candidateLink, tileColor) >= 4.5 ? candidateLink : textColor,
    };
  }, [tileColor]);
  const plainSegments = useMemo(
    () => (renderMarkdown || !content ? [] : splitTextWithLinks(content)),
    [content, renderMarkdown],
  );
  const mergedStyle: CSSProperties = {
    width,
    backgroundColor: tileColor,
    borderColor,
    transition: "box-shadow 0.3s ease",
    ...(rotation ? { transform: `rotate(${rotation}deg)` } : {}),
    ...style,
  };

  return (
    <div
      {...divProps}
      className={`app-surface-frame relative border overflow-hidden select-none shadow-[0_1px_8px_rgba(26,26,24,0.04)] hover:shadow-[0_6px_24px_rgba(26,26,24,0.07)] ${className}`}
      style={mergedStyle}
    >
      <div data-tile-scroll="true" className="h-full overflow-y-auto overflow-x-hidden tile-scroll-area">
      <div data-tile-body="true" className="pl-4 pr-8 pt-6 pb-4 min-w-0" style={{ fontSize: `${fontSize}px`, overflowWrap: 'anywhere' }}>
        {title && (
          <div
            className="font-display tracking-wide mb-3 leading-snug"
            style={{ color: titleColor, fontSize: `${fontSize + 1}px` }}
          >
            {title}
          </div>
        )}
        {content ? (
          renderMarkdown ? (
            <div style={{ color: contentColor }}>
              <MarkdownPreview
                content={content}
                fontSize={fontSize}
                renderHtml={false}
                imageBaseDir={imageBaseDir}
              />
            </div>
          ) : (
            <div
              className="leading-[1.8] whitespace-pre-wrap font-body"
              style={{ color: contentColor, fontSize: `${fontSize}px` }}
            >
              {plainSegments.map((segment, index) =>
                segment.type === "link" && segment.href ? (
                  <a
                    key={index}
                    href={segment.href}
                    title={segment.href}
                    data-tile-link="true"
                    className="electron-no-drag underline underline-offset-2 cursor-pointer hover:opacity-75 transition-opacity"
                    style={{ color: linkColor }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void openUrl(segment.href!);
                    }}
                  >
                    {segment.value}
                  </a>
                ) : (
                  segment.value
                ),
              )}
            </div>
          )
        ) : (
          <div
            className="font-body text-center py-6"
            style={{ color: emptyColor, fontSize: `${fontSize}px` }}
          >
            {t("tile.empty", { defaultValue: "空" })}
          </div>
        )}
      </div>
      </div>

      <CornerMarks color={cornerColor} />
      {children}
    </div>
  );
}
