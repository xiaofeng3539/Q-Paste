import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { MainWindow } from "./MainWindow";

describe("花笺标题栏", () => {
  test("右侧按钮组可接收鼠标点击", () => {
    const markup = renderToStaticMarkup(<MainWindow />);
    expect(markup).toContain('class="flex items-center electron-no-drag"><button');
  });
});
