export interface TextSegment {
  type: "text" | "link";
  value: string;
  href?: string;
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`\u3000-\u303f\uff00-\uffef\u4e00-\u9fff]+/gi;
const SIMPLE_TRAILING_PUNCTUATION = /[.,;:!?]$/;
const CLOSING_TO_OPENING: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
};

function countChar(text: string, target: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === target) count++;
  }
  return count;
}

function trimTrailingUrlPunctuation(raw: string): string {
  let cleaned = raw;
  while (cleaned.length > 0) {
    if (SIMPLE_TRAILING_PUNCTUATION.test(cleaned)) {
      cleaned = cleaned.slice(0, -1);
      continue;
    }
    const last = cleaned[cleaned.length - 1];
    const opening = CLOSING_TO_OPENING[last];
    if (opening && countChar(cleaned, last) > countChar(cleaned, opening)) {
      cleaned = cleaned.slice(0, -1);
      continue;
    }
    break;
  }
  return cleaned;
}

function isValidHttpUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function splitTextWithLinks(text: string): TextSegment[] {
  if (!text) return [];
  const segments: TextSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const cleaned = trimTrailingUrlPunctuation(raw);
    if (!isValidHttpUrl(cleaned)) continue;

    if (start > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, start) });
    }
    segments.push({ type: "link", value: cleaned, href: cleaned });
    lastIndex = start + cleaned.length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments;
}

export function extractUniqueLinks(text: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const segment of splitTextWithLinks(text)) {
    if (segment.type === "link" && segment.href && !seen.has(segment.href)) {
      seen.add(segment.href);
      links.push(segment.href);
    }
  }
  return links;
}

export function findLinkAtOffset(text: string, offset: number): string | null {
  if (offset < 0 || offset > text.length) return null;
  let cursor = 0;
  for (const segment of splitTextWithLinks(text)) {
    const end = cursor + segment.value.length;
    if (segment.type === "link" && segment.href && offset >= cursor && offset <= end) {
      return segment.href;
    }
    cursor = end;
  }
  return null;
}

export function formatLinkLabel(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}
