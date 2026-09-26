import { describe, expect, test } from "vitest";
import {
  canStartNoteDrag,
  isNoteSelectedInList,
  selectNoteFromList,
} from "../vendor/floral-notepaper/src/features/notes/noteSelection";

describe("花笺笔记栏选择交互", () => {
  test("普通单击后立即 Shift 单击仍完整选择锚点范围", () => {
    const ids = ["a", "b", "c", "d"];
    const singleClick = selectNoteFromList(ids, new Set(), null, "b", {
      ctrlKey: false,
      shiftKey: false,
    });
    const shiftClick = selectNoteFromList(ids, singleClick.selectedIds, singleClick.anchorId, "d", {
      ctrlKey: false,
      shiftKey: true,
    });

    expect([...shiftClick.selectedIds]).toEqual(["b", "c", "d"]);
  });

  test("从列表底部向上 Shift 连选时也包含完整范围", () => {
    const result = selectNoteFromList(["a", "b", "c", "d"], new Set(), "d", "b", {
      ctrlKey: false,
      shiftKey: true,
    });

    expect([...result.selectedIds]).toEqual(["b", "c", "d"]);
  });

  test("按住选择修饰键时不启动笔记拖拽", () => {
    expect(canStartNoteDrag({ ctrlKey: false, metaKey: false, shiftKey: true })).toBe(false);
    expect(canStartNoteDrag({ ctrlKey: true, metaKey: false, shiftKey: false })).toBe(false);
    expect(canStartNoteDrag({ ctrlKey: false, metaKey: true, shiftKey: false })).toBe(false);
    expect(canStartNoteDrag({ ctrlKey: false, metaKey: false, shiftKey: false })).toBe(true);
  });

  test("多选时只高亮选中集合中的笔记，不额外高亮编辑器当前笔记", () => {
    const selected = new Set(["b", "c"]);

    expect(isNoteSelectedInList("a", "a", selected)).toBe(false);
    expect(isNoteSelectedInList("b", "a", selected)).toBe(true);
  });

  test("笔记加载期间优先即时高亮刚单击的笔记", () => {
    expect(isNoteSelectedInList("b", "a", new Set(), "b")).toBe(true);
    expect(isNoteSelectedInList("a", "a", new Set(), "b")).toBe(false);
  });
});
