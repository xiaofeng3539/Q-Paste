export function preferredTileWidth(longestLineWidth: number, workAreaWidth: number): number {
  return Math.min(Math.max(1, workAreaWidth - 32), 560, Math.max(240, Math.ceil(longestLineWidth + 52)));
}

/** Measure real layout at the chosen width, including padding, markdown and wrapping. */
export function measureTileContent(body: HTMLElement, workAreaWidth: number): { width: number; height: number } {
  const style = getComputedStyle(body);
  const context = document.createElement('canvas').getContext('2d');
  let longestLine = 0;
  if (context) {
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    for (const line of body.innerText.split('\n')) longestLine = Math.max(longestLine, context.measureText(line).width);
  }
  const width = preferredTileWidth(longestLine, workAreaWidth);
  const probe = body.cloneNode(true) as HTMLElement;
  Object.assign(probe.style, {
    position: 'fixed', left: '-10000px', top: '0', visibility: 'hidden',
    width: `${width - 2}px`, height: 'auto', maxHeight: 'none',
    overflow: 'visible', pointerEvents: 'none', boxSizing: 'border-box',
  });
  document.body.appendChild(probe);
  try {
    return { width, height: Math.ceil(probe.getBoundingClientRect().height) + 4 };
  } finally {
    probe.remove();
  }
}
