/**
 * 手机端页面主题（对齐 TieZ web_ui.rs 的 mica 简约圆润变体）。
 * 色深模式：light / dark / system 跟随宿主；页面底色纯白，细线分隔，无黑色粗描边。
 */

const MICA_LIGHT = `--bg-body: #f3f4f6;
--bg-solid: #ffffff;
--bg-panel: rgba(255, 255, 255, 0.9);
--bg-input: #f7f8fa;
--bg-button: rgba(255, 255, 255, 0.46);
--border-dark: rgba(128, 128, 128, 0.18);
--text-primary: #1a2435;
--text-secondary: #607188;
--accent-color: #4f7dff;
--shadow-color: rgba(15, 23, 42, 0.1);
--font-mono: system-ui, -apple-system, sans-serif;
--radius: 12px;
--bubble-received-bg: rgba(255, 255, 255, 0.96);
--hairline: rgba(0, 0, 0, 0.06);
--muted-btn-bg: #f2f3f5;
--muted-btn-color: #b0b3b8;
--card-shadow: 0 2px 10px rgba(15, 23, 42, 0.06);
--send-button-background: #4f7dff;
--send-button-color: #ffffff;`

const MICA_DARK = `--bg-body: #1a1a1a;
--bg-solid: #242427;
--bg-panel: rgba(36, 36, 36, 0.92);
--bg-input: rgba(255, 255, 255, 0.08);
--bg-button: rgba(255, 255, 255, 0.05);
--border-dark: rgba(255, 255, 255, 0.08);
--text-primary: #e8e8e8;
--text-secondary: #a8a8a8;
--accent-color: #4f7dff;
--shadow-color: rgba(0, 0, 0, 0.3);
--font-mono: system-ui, -apple-system, sans-serif;
--radius: 12px;
--bubble-received-bg: rgba(40, 40, 40, 0.92);
--hairline: rgba(255, 255, 255, 0.08);
--muted-btn-bg: #2a2a2e;
--muted-btn-color: #8a8d95;
--card-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
--send-button-background: #4f7dff;
--send-button-color: #ffffff;`

/** color_mode: 'light' | 'dark' | 'system'（移植 file_transfer_theme_css） */
export function buildThemeCss(colorMode: string): string {
  const darkCss =
    colorMode === 'dark'
      ? `:root {${MICA_DARK}}`
      : colorMode === 'system'
        ? `@media (prefers-color-scheme: dark) { :root {${MICA_DARK}} }`
        : ''
  return `:root {${MICA_LIGHT}}\n${darkCss}`
}

export function modeClass(colorMode: string): string {
  if (colorMode === 'dark') return 'dark-mode'
  if (colorMode === 'light') return 'light-mode'
  return ''
}
