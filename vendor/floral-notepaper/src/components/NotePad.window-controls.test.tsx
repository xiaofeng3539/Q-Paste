import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { NotePad } from "./NotePad";

describe("快捷便签窗口控件", () => {
  test("标题栏可拖动且标题栏按钮区域不参与拖动", () => {
    const markup = renderToStaticMarkup(<NotePad />);

    expect(markup).toContain(
      'class="flex items-center justify-between px-4 pt-3 pb-0 cursor-default electron-drag-region"',
    );
    expect(markup).toContain('class="flex items-center gap-0.5 electron-no-drag">');
    expect(markup).toContain('class="ml-auto flex items-center gap-1.5 electron-no-drag">');
  });

  test("固定磁贴使用原生拖动区域，关闭和缩放控件不触发拖动", () => {
    const markup = renderToStaticMarkup(<NotePad initialSurfaceMode="tile" />);

    expect(markup).toContain('h-full cursor-default electron-drag-region"');
    expect(markup).toContain('electron-no-drag"');
  });
});
