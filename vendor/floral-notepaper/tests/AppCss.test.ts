import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

function extractThemeToken(css: string, blockPattern: RegExp, tokenName: string): string {
  const blockMatch = css.match(blockPattern);
  expect(blockMatch).not.toBeNull();
  const tokenMatch = blockMatch![1].match(new RegExp(`${tokenName}:\\s*(#[0-9a-fA-F]{6});`));
  expect(tokenMatch).not.toBeNull();
  return tokenMatch![1].toLowerCase();
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("app font stacks", () => {
  test("uses a system CJK fallback without bundling HarmonyOS Sans SC", () => {
    const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");

    expect(css).toMatch(/--font-mono:[^;]*"Consolas", "Microsoft YaHei", monospace;/);
    expect(css).not.toContain("HarmonyOS_Sans_SC.ttf");
  });
});

describe("theme readability", () => {
  test("light theme avoids glaring pure white surfaces and preserves readable text contrast", () => {
    const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
    const lightBlock = /@theme\s*\{([\s\S]*?)\}/;
    const cloud = extractThemeToken(css, lightBlock, "--color-cloud");
    const paper = extractThemeToken(css, lightBlock, "--color-paper");
    const ink = extractThemeToken(css, lightBlock, "--color-ink");
    const inkFaint = extractThemeToken(css, lightBlock, "--color-ink-faint");
    const inkGhost = extractThemeToken(css, lightBlock, "--color-ink-ghost");

    expect(cloud).not.toBe("#ffffff");
    expect(contrastRatio(ink, cloud)).toBeGreaterThanOrEqual(12);
    expect(contrastRatio(inkFaint, cloud)).toBeGreaterThanOrEqual(6);
    expect(contrastRatio(inkFaint, paper)).toBeGreaterThanOrEqual(5.5);
    expect(contrastRatio(inkGhost, cloud)).toBeGreaterThanOrEqual(4.5);
  });

  test("dark theme avoids pitch-black flatness and keeps readable contrast and raised segment thumb", () => {
    const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
    const darkBlock = /:root\[data-theme="dark"\]\s*\{([\s\S]*?)\}/;
    const cloud = extractThemeToken(css, darkBlock, "--color-cloud");
    const paper = extractThemeToken(css, darkBlock, "--color-paper");
    const ink = extractThemeToken(css, darkBlock, "--color-ink");
    const inkFaint = extractThemeToken(css, darkBlock, "--color-ink-faint");
    const inkGhost = extractThemeToken(css, darkBlock, "--color-ink-ghost");
    const segTrack = extractThemeToken(css, darkBlock, "--color-segment-track");
    const segThumb = extractThemeToken(css, darkBlock, "--color-segment-thumb");

    expect(relativeLuminance(cloud)).toBeGreaterThan(0.014);
    expect(relativeLuminance(paper)).toBeGreaterThan(relativeLuminance(cloud));
    expect(relativeLuminance(segThumb)).toBeGreaterThan(relativeLuminance(segTrack));
    expect(contrastRatio(ink, cloud)).toBeGreaterThanOrEqual(12);
    expect(contrastRatio(inkFaint, cloud)).toBeGreaterThanOrEqual(5.5);
    expect(contrastRatio(inkFaint, paper)).toBeGreaterThanOrEqual(4.8);
    expect(contrastRatio(inkGhost, cloud)).toBeGreaterThanOrEqual(4.4);
  });

  test("category folder palettes provide 6 distinct tones with readable header contrast in light and dark themes", () => {
    const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
    const lightAccents = new Set<string>();
    const darkAccents = new Set<string>();

    for (let i = 0; i < 6; i++) {
      const lightBlock = new RegExp(`\\.floral-cat-tone-${i}\\s*\\{([\\s\\S]*?)\\}`);
      const darkBlock = new RegExp(`:root\\[data-theme="dark"\\]\\s*\\.floral-cat-tone-${i}\\s*\\{([\\s\\S]*?)\\}`);

      const lightAccent = extractThemeToken(css, lightBlock, "--cat-accent");
      const lightHeader = extractThemeToken(css, lightBlock, "--cat-header-bg");
      lightAccents.add(lightAccent);
      expect(contrastRatio(lightAccent, lightHeader)).toBeGreaterThanOrEqual(4.2);

      const darkAccent = extractThemeToken(css, darkBlock, "--cat-accent");
      const darkHeader = extractThemeToken(css, darkBlock, "--cat-header-bg");
      darkAccents.add(darkAccent);
      expect(contrastRatio(darkAccent, darkHeader)).toBeGreaterThanOrEqual(4.5);
    }

    expect(lightAccents.size).toBe(6);
    expect(darkAccents.size).toBe(6);
    expect(css).toContain(".floral-cat-card");
    expect(css).toContain(".floral-cat-header");
    expect(css).toContain(".floral-cat-body-surface");
    expect(css).toContain(".floral-cat-note-item");
    expect(css).toContain(".floral-cat-note-item.is-selected");
    expect(css).not.toContain(".floral-cat-rail");
    expect(css).toContain(".floral-uncat-note-card");
    expect(css).toMatch(/\.category-body\s*>\s*\.category-body-inner\s*\{[^}]*min-height:\s*0;/);
    const mainWindow = readFileSync(new URL("../src/components/MainWindow.tsx", import.meta.url), "utf8");
    expect(mainWindow).not.toMatch(/category-body-inner[^"]*p[xytrbl]?-/);
  });
});
