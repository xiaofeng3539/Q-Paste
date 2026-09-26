import { describe, expect, it, vi } from "vitest";
import { saveBeforeModeSwitch } from "./modeSwitch";

describe("saveBeforeModeSwitch", () => {
  it("保存未提交的笔记后才允许切换", async () => {
    let state = "dirty";
    const save = vi.fn(async () => { state = "saved"; return true; });
    expect(await saveBeforeModeSwitch(save, () => state)).toBe(true);
    expect(save).toHaveBeenCalledWith(false);
  });

  it("保存失败或保存期间再次编辑时阻止切换", async () => {
    let state = "dirty";
    const failed = vi.fn(async () => { state = "error"; return false; });
    expect(await saveBeforeModeSwitch(failed, () => state)).toBe(false);
    state = "saving";
    const edited = vi.fn(async () => { state = "dirty"; return true; });
    expect(await saveBeforeModeSwitch(edited, () => state)).toBe(false);
  });

  it("上次保存出错时强制重试", async () => {
    let state = "error";
    const save = vi.fn(async () => { state = "saved"; return true; });
    expect(await saveBeforeModeSwitch(save, () => state)).toBe(true);
    expect(save).toHaveBeenCalledWith(true);
  });
});
