export type FileSrcConverter = (path: string) => Promise<string>;

const NOTE_IMAGE_PREFIX = "images/";

export function resolveMarkdownImageSrc(
  src: string | undefined,
  imageBaseDir: string | undefined,
  convertFileSrc: FileSrcConverter,
): Promise<string> {
  if (!src) {
    return Promise.resolve("");
  }

  const normalizedSrc = src.replace(/\\/g, "/");
  if (!imageBaseDir || !normalizedSrc.startsWith(NOTE_IMAGE_PREFIX)) {
    return Promise.resolve(src);
  }

  return convertFileSrc(`${imageBaseDir}/${normalizedSrc}`);
}
