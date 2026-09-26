import { beforeEach, describe, expect, test, vi } from "vitest";
import { resolveMarkdownImageSrc } from "./imageSrc";

describe("resolveMarkdownImageSrc", () => {
  const convertFileSrc = vi.fn(async (path: string) => `asset://${path}`);

  beforeEach(() => {
    convertFileSrc.mockClear();
  });

  test("resolves note image paths under the images directory", async () => {
    await expect(resolveMarkdownImageSrc("images/photo.png", "/notes/note-1", convertFileSrc)).resolves.toBe(
      "asset:///notes/note-1/images/photo.png",
    );
    expect(convertFileSrc).toHaveBeenCalledWith("/notes/note-1/images/photo.png");
  });

  test("normalizes Windows-style separators before resolving note images", async () => {
    await expect(resolveMarkdownImageSrc("images\\photo.png", "C:/notes/note-1", convertFileSrc)).resolves.toBe(
      "asset://C:/notes/note-1/images/photo.png",
    );
    expect(convertFileSrc).toHaveBeenCalledWith("C:/notes/note-1/images/photo.png");
  });

  test("keeps non-note image paths unchanged", async () => {
    await expect(
      resolveMarkdownImageSrc("https://example.com/photo.png", "/notes/note-1", convertFileSrc),
    ).resolves.toBe("https://example.com/photo.png");
    await expect(resolveMarkdownImageSrc("./photo.png", "/notes/note-1", convertFileSrc)).resolves.toBe(
      "./photo.png",
    );
    expect(convertFileSrc).not.toHaveBeenCalled();
  });

  test("keeps image paths unchanged when the base directory is unavailable", async () => {
    await expect(resolveMarkdownImageSrc("images/photo.png", undefined, convertFileSrc)).resolves.toBe(
      "images/photo.png",
    );
    expect(convertFileSrc).not.toHaveBeenCalled();
  });

  test("returns an empty string for missing sources", async () => {
    await expect(resolveMarkdownImageSrc(undefined, "/notes/note-1", convertFileSrc)).resolves.toBe("");
  });
});
