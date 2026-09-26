import { describe, expect, test } from "vitest";
import { getNoteDeleteTargets, selectAllNotes, selectNoteFromList } from "./noteSelection";

describe("笔记栏多选", () => {
  const noteIds = ["a", "b", "c", "d"];

  test("Ctrl 单击切换单篇选择并更新范围锚点", () => {
    const selected = new Set(["a"]);
    const result = selectNoteFromList(noteIds, selected, "a", "c", {
      ctrlKey: true,
      shiftKey: false,
    });

    expect([...result.selectedIds]).toEqual(["a", "c"]);
    expect(result.anchorId).toBe("c");
  });

  test("Ctrl 单击已选笔记会取消该项", () => {
    const result = selectNoteFromList(noteIds, new Set(["b", "c"]), "b", "b", {
      ctrlKey: true,
      shiftKey: false,
    });

    expect([...result.selectedIds]).toEqual(["c"]);
  });

  test("Shift 单击选择锚点与目标之间的连续范围", () => {
    const result = selectNoteFromList(noteIds, new Set(["a"]), "a", "c", {
      ctrlKey: false,
      shiftKey: true,
    });

    expect([...result.selectedIds]).toEqual(["a", "b", "c"]);
  });


  test("Ctrl+Shift 将连续范围加入已有选择", () => {
    const result = selectNoteFromList(noteIds, new Set(["d"]), "a", "c", {
      ctrlKey: true,
      shiftKey: true,
    });

    expect([...result.selectedIds]).toEqual(["d", "a", "b", "c"]);
  });

  test("普通单击清除多选并设为下一次范围选择的锚点", () => {
    const result = selectNoteFromList(noteIds, new Set(["a", "b"]), "a", "d", {
      ctrlKey: false,
      shiftKey: false,
    });

    expect([...result.selectedIds]).toEqual([]);
    expect(result.anchorId).toBe("d");
  });

  test("Ctrl+A 选择当前可见笔记且不重复", () => {
    expect([...selectAllNotes(["a", "b", "a"])]).toEqual(["a", "b"]);
  });

  test("右键删除已选笔记时按列表顺序返回整组选中项", () => {
    expect([...getNoteDeleteTargets("c", new Set(["d", "c"]), noteIds)]).toEqual([
      "c",
      "d",
    ]);
  });

  test("右键删除未选笔记时只返回该笔记", () => {
    expect([...getNoteDeleteTargets("b", new Set(["a", "c"]), noteIds)]).toEqual(["b"]);
  });
});
