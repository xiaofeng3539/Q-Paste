import type { WindowBounds } from "./api";

export type NoteSurfaceMode = "pad" | "tile";

export const NOTE_SURFACE_MODE_EVENT = "floral-notepaper:surface-mode";

export const SURFACE_WINDOW_SIZES: Record<
  NoteSurfaceMode,
  Pick<WindowBounds, "width" | "height">
> = {
  pad: { width: 360, height: 440 },
  tile: { width: 220, height: 220 },
};

export function isNoteSurfaceMode(value: unknown): value is NoteSurfaceMode {
  return value === "pad" || value === "tile";
}

export function getSurfaceTargetBounds(
  mode: NoteSurfaceMode,
  current: WindowBounds,
): WindowBounds {
  if (mode !== 'pad') return current;
  return {
    ...current,
    width: Math.max(current.width, SURFACE_WINDOW_SIZES.pad.width),
    height: Math.max(current.height, SURFACE_WINDOW_SIZES.pad.height),
  };
}

export function requestSurfaceMode(mode: NoteSurfaceMode): void {
  window.dispatchEvent(new CustomEvent(NOTE_SURFACE_MODE_EVENT, { detail: { mode } }));
}

export function surfaceModeFromEvent(event: Event): NoteSurfaceMode | null {
  if (!(event instanceof CustomEvent)) return null;
  const mode = (event.detail as { mode?: unknown } | null)?.mode;
  return isNoteSurfaceMode(mode) ? mode : null;
}
