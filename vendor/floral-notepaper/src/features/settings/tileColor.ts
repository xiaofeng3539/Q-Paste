import type { TileColorMode } from "./types";

export const DEFAULT_TILE_COLOR = "#f6f3ec";
export const SYSTEM_TILE_COLOR_LIGHT = "#f6f3ec";
export const SYSTEM_TILE_COLOR_DARK = "#191919";

const FULL_HEX_COLOR = /^#?([0-9a-fA-F]{6})$/;
const SHORT_HEX_COLOR = /^#?([0-9a-fA-F]{3})$/;

export function normalizeTileColor(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  const fullMatch = trimmed.match(FULL_HEX_COLOR);
  if (fullMatch) {
    return `#${fullMatch[1].toLowerCase()}`;
  }

  const shortMatch = trimmed.match(SHORT_HEX_COLOR);
  if (shortMatch) {
    return `#${shortMatch[1]
      .split("")
      .map((character) => character + character)
      .join("")
      .toLowerCase()}`;
  }

  return DEFAULT_TILE_COLOR;
}

export function resolveSystemTileColor(): string {
  if (typeof document === "undefined") return SYSTEM_TILE_COLOR_LIGHT;
  const theme = document.documentElement.getAttribute("data-theme");
  return theme === "dark" ? SYSTEM_TILE_COLOR_DARK : SYSTEM_TILE_COLOR_LIGHT;
}

export function resolveTileColor(mode: TileColorMode, customColor: string): string {
  return mode === "system" ? resolveSystemTileColor() : normalizeTileColor(customColor);
}

/** Opaque black/white text: choose the higher WCAG contrast for any custom color. */
export function getTileTextColor(background: string): string {
  const hex = normalizeTileColor(background);
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}
