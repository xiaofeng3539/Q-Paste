import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("app font stacks", () => {
  test("uses a system CJK fallback without bundling HarmonyOS Sans SC", () => {
    const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");

    expect(css).toMatch(/--font-mono:[^;]*"Consolas", "Microsoft YaHei", monospace;/);
    expect(css).not.toContain("HarmonyOS_Sans_SC.ttf");
  });
});
