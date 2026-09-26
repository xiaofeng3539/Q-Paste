export interface OcrConfig {
  langPath: string
  workerPath: string
  corePath: string
}

export interface OcrRegion {
  x: number
  y: number
  width: number
  height: number
}

export function openOcrSelection(): { selecting: true; lightboxOpen: true } {
  return { selecting: true, lightboxOpen: true }
}

export function mapViewportOcrRegionToImage(
  region: OcrRegion,
  imageSize: { width: number; height: number },
  displayedSize: { width: number; height: number },
  scale: number,
  position: { x: number; y: number },
): OcrRegion {
  const sourceX = imageSize.width / 2 + (region.x - imageSize.width / 2 - position.x * imageSize.width / displayedSize.width) / scale
  const sourceY = imageSize.height / 2 + (region.y - imageSize.height / 2 - position.y * imageSize.height / displayedSize.height) / scale
  const x = Math.max(0, Math.min(imageSize.width, Math.round(sourceX)))
  const y = Math.max(0, Math.min(imageSize.height, Math.round(sourceY)))
  return {
    x,
    y,
    width: Math.max(0, Math.min(imageSize.width - x, Math.round(region.width / scale))),
    height: Math.max(0, Math.min(imageSize.height - y, Math.round(region.height / scale))),
  }
}

export function validateOcrConfig(config: OcrConfig): string | null {
  if (!config.langPath) return '缺少 OCR 语言模型'
  if (!config.workerPath) return '缺少 OCR 工作线程'
  if (!config.corePath) return '缺少 OCR 核心文件'
  return null
}

export function isValidOcrRegion(region: OcrRegion): boolean {
  return Number.isFinite(region.x) && Number.isFinite(region.y)
    && region.width >= 8 && region.height >= 8
}

export function fitOcrCanvas(width: number, height: number, maxPixels = 4_000_000): { width: number; height: number } {
  if (width * height <= maxPixels) return { width, height }
  const scale = Math.sqrt(maxPixels / (width * height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

export function normalizeOcrText(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

export function canSaveOcrResult(text: string): boolean {
  return normalizeOcrText(text).length > 0
}

export function ocrErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/ENOENT|traineddata|worker|wasm/i.test(message)) return 'OCR 本地模型缺失，请重新安装应用后重试'
  return '识别失败，请调整选区后重试'
}

export function shouldApplyOcrResult(input: {
  startedItemId: number
  currentItemId: number
  startedTaskId: number
  currentTaskId: number
}): boolean {
  return input.startedItemId === input.currentItemId && input.startedTaskId === input.currentTaskId
}

export function invalidateOcrTask(currentTaskId: number): number {
  return currentTaskId + 1
}

export function ocrActionErrorMessage(action: 'copy' | 'save'): string {
  return action === 'copy' ? '复制失败，请重试' : '保存失败，请重试'
}

export async function cropImageForOcr(source: string, region: OcrRegion): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new Error('无法读取图片'))
    element.src = source
  })
  const width = Math.min(region.width, image.naturalWidth - region.x)
  const height = Math.min(region.height, image.naturalHeight - region.y)
  if (!isValidOcrRegion({ ...region, width, height })) throw new Error('请框选需要识别的文字区域')
  const size = fitOcrCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建 OCR 图像')
  context.drawImage(image, region.x, region.y, width, height, 0, 0, size.width, size.height)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法处理 OCR 图像')), 'image/png')
  })
}
