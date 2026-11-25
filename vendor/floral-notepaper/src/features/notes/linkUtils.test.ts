import { describe, expect, test } from "vitest";
import {
  extractUniqueLinks,
  findLinkAtOffset,
  formatLinkLabel,
  splitTextWithLinks,
} from "./linkUtils";

describe("linkUtils", () => {
  test("识别正文中的 http/https 链接并在中文括号与标点前截断", () => {
    const sample =
      "维修教程-EPT:\nhttps://m9ah2ex4b1.feishu.cn/docx/U2aRdL9G0ochtSxGleEcZlZZnhf?from=from_copylink （网址请不要在微信中打开）";
    const segments = splitTextWithLinks(sample);

    expect(segments).toEqual([
      { type: "text", value: "维修教程-EPT:\n" },
      {
        type: "link",
        value: "https://m9ah2ex4b1.feishu.cn/docx/U2aRdL9G0ochtSxGleEcZlZZnhf?from=from_copylink",
        href: "https://m9ah2ex4b1.feishu.cn/docx/U2aRdL9G0ochtSxGleEcZlZZnhf?from=from_copylink",
      },
      { type: "text", value: " （网址请不要在微信中打开）" },
    ]);
    expect(segments.map((item) => item.value).join("")).toBe(sample);
  });

  test("剥离末尾多余标点并保留成对括号", () => {
    const text =
      "参考 [维基](https://en.wikipedia.org/wiki/Foo_(bar))，以及 http://example.com/a?x=1。";
    expect(extractUniqueLinks(text)).toEqual([
      "https://en.wikipedia.org/wiki/Foo_(bar)",
      "http://example.com/a?x=1",
    ]);
  });

  test("去重提取链接并保持出现顺序", () => {
    const text = "https://a.com/1 与 https://b.com/2 与 https://a.com/1";
    expect(extractUniqueLinks(text)).toEqual(["https://a.com/1", "https://b.com/2"]);
  });

  test("按光标偏移精准命中链接", () => {
    const text = "打开 https://example.com/docs 查看";
    expect(findLinkAtOffset(text, 0)).toBeNull();
    expect(findLinkAtOffset(text, 3)).toBe("https://example.com/docs");
    expect(findLinkAtOffset(text, 15)).toBe("https://example.com/docs");
    expect(findLinkAtOffset(text, text.length)).toBeNull();
  });

  test("格式化链接标签移除协议与尾斜杠", () => {
    expect(formatLinkLabel("https://example.com/path/")).toBe("example.com/path");
    expect(formatLinkLabel("http://localhost:3000/")).toBe("localhost:3000");
  });
});
