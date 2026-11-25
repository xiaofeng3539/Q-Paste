import { describe, expect, it } from "vitest";
import {
  buildPreview,
  CATEGORY_TONE_COUNT,
  countNoteChars,
  filterNotes,
  getCategoryToneClass,
  getDisplayTitle,
  groupNotesByCategory,
  mergeNoteMetadata,
} from "./noteUtils";
import type { NoteMetadata } from "./types";

const notes: NoteMetadata[] = [
  {
    id: "1",
    title: "读书笔记",
    fileName: "1.md",
    category: "",
    createdAt: "2026-04-28T01:00:00Z",
    updatedAt: "2026-04-28T01:00:00Z",
    wordCount: 20,
    preview: "关于月亮与六便士",
  },
  {
    id: "2",
    title: "",
    fileName: "2.md",
    category: "日常",
    createdAt: "2026-04-28T02:00:00Z",
    updatedAt: "2026-04-28T02:00:00Z",
    wordCount: 12,
    preview: "周末采购清单",
  },
];

describe("note utilities", () => {
  it("merges only the saved note and ignores an older save response", () => {
    const saved = { ...notes[0], updatedAt: "2026-04-28T03:00:00Z", preview: "新摘要" };
    const next = mergeNoteMetadata(notes, saved);
    expect(next).toEqual([saved, notes[1]]);
    expect(next[1]).toBe(notes[1]);
    expect(mergeNoteMetadata(next, notes[0])).toBe(next);
  });

  it("uses title, preview, then untitled fallback for display title", () => {
    expect(getDisplayTitle(notes[0])).toBe("读书笔记");
    expect(getDisplayTitle(notes[1])).toBe("周末采购清单");
    expect(getDisplayTitle({ ...notes[1], preview: "" })).toBe("无标题笔记");
  });

  it("builds compact previews and counts non-whitespace characters", () => {
    const content = "# 标题\n\n正文 第一行\n第二行";

    expect(buildPreview(content)).toBe("# 标题 正文 第一行 第二行");
    expect(countNoteChars(content)).toBe(11);
  });

  it("filters notes by title, preview, or file name without case sensitivity", () => {
    expect(filterNotes(notes, "读书").map((note) => note.id)).toEqual(["1"]);
    expect(filterNotes(notes, "采购").map((note) => note.id)).toEqual(["2"]);
    expect(filterNotes(notes, "2.MD").map((note) => note.id)).toEqual(["2"]);
    expect(filterNotes(notes, "   ").map((note) => note.id)).toEqual(["1", "2"]);
  });

  it("includes empty categories from allCategories list", () => {
    const groups = groupNotesByCategory(notes, ["日常", "工作"]);
    const categoryNames = groups.map((g) => g.category);
    expect(categoryNames).toContain("工作");
    const workGroup = groups.find((g) => g.category === "工作");
    expect(workGroup?.notes).toEqual([]);
  });

  it("keeps manual order ahead of update time and places new notes at the top", () => {
    const first = { ...notes[0], category: "日常", sortOrder: 0 };
    const second = { ...notes[1], sortOrder: 1, updatedAt: "2027-01-01T00:00:00Z" };
    expect(groupNotesByCategory([second, first])[0].notes.map((note) => note.id)).toEqual(["1", "2"]);
    expect(groupNotesByCategory([second, first, { ...notes[1], id: "3" }])[0].notes.map((note) => note.id))
      .toEqual(["3", "1", "2"]);
  });

  it("assigns distinct category tone classes to consecutive categories and cycles cleanly", () => {
    const tones = Array.from({ length: CATEGORY_TONE_COUNT }, (_, i) => getCategoryToneClass(i));
    expect(new Set(tones).size).toBe(CATEGORY_TONE_COUNT);
    expect(getCategoryToneClass(CATEGORY_TONE_COUNT)).toBe(tones[0]);
    expect(getCategoryToneClass(-1)).toBe(tones[CATEGORY_TONE_COUNT - 1]);
  });
});
