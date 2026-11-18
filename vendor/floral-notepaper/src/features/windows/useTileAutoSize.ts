import { useEffect, type RefObject } from 'react';
import { measureTileContent } from './tileAutoSize';

export function useTileAutoSize(
  container: RefObject<HTMLDivElement | null>, enabled: boolean,
  title: string, content: string, fontSize: number, renderMarkdown: boolean,
): void {
  useEffect(() => {
    if (!enabled) return;
    const body = container.current?.querySelector<HTMLElement>('[data-tile-body]');
    if (!body) return;
    let cancelled = false;
    let frame = 0;
    let lastSize = '';
    let workAreaWidth = 0;
    const fit = () => {
      frame = 0;
      if (cancelled || !workAreaWidth) return;
      const size = measureTileContent(body, workAreaWidth);
      const key = `${size.width}:${size.height}`;
      if (key === lastSize) return;
      lastSize = key;
      void window.electronAPI!.floralWindow('fitTileContent', size).catch(() => { lastSize = ''; });
    };
    const schedule = () => {
      if (!cancelled && !frame) frame = requestAnimationFrame(fit);
    };
    void window.electronAPI!.floralWindow('getWorkArea').then((area) => {
      if (cancelled) return;
      workAreaWidth = area.width;
      schedule();
    });
    // Lazy markdown and images may arrive after the first paint. Do not observe
    // viewport resizing: a user dragging the window edge must keep their size.
    const observer = new MutationObserver(schedule);
    observer.observe(body, { subtree: true, childList: true, characterData: true });
    body.addEventListener('load', schedule, true);
    void document.fonts.ready.then(schedule);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      body.removeEventListener('load', schedule, true);
    };
  }, [container, enabled, title, content, fontSize, renderMarkdown]);
}
