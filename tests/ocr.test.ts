import { describe, expect, it } from 'vitest'
import { canSaveOcrResult, fitOcrCanvas, invalidateOcrTask, isValidOcrRegion, mapViewportOcrRegionToImage, normalizeOcrText, ocrActionErrorMessage, ocrErrorMessage, openOcrSelection, shouldApplyOcrResult, validateOcrConfig } from '../src/lib/ocr'

describe('OCR 本地资源配置', () => {
  it('缺少本地语言模型时返回可读错误', () => {
    expect(validateOcrConfig({ langPath: '', workerPath: 'worker.js', corePath: 'core.wasm.js' }))
      .toBe('缺少 OCR 语言模型')
  })
})

describe('OCR 选区', () => {
  it('开始框选时会同时打开图片放大视图', () => {
    expect(openOcrSelection()).toEqual({ selecting: true, lightboxOpen: true })
  })

  it('固定选框会按缩放和平移反算为原图坐标', () => {
    expect(mapViewportOcrRegionToImage(
      { x: 200, y: 100, width: 200, height: 100 },
      { width: 1000, height: 500 },
      { width: 500, height: 250 },
      2,
      { x: 20, y: -10 },
    )).toEqual({ x: 330, y: 185, width: 100, height: 50 })
  })

  it('拒绝宽度或高度不足 8 像素的选区', () => {
    expect(isValidOcrRegion({ x: 0, y: 0, width: 7, height: 120 })).toBe(false)
    expect(isValidOcrRegion({ x: 0, y: 0, width: 120, height: 8 })).toBe(true)
  })

  it('对超大选区等比缩小到像素上限内', () => {
    expect(fitOcrCanvas(4000, 4000, 4_000_000)).toEqual({ width: 2000, height: 2000 })
  })
})

describe('OCR 结果处理', () => {
  it('合并三行以上空行并去除首尾空白', () => {
    expect(normalizeOcrText('\n  编号 42\n\n\n\n  \n')).toBe('编号 42')
  })

  it('仅允许当前图片的当前识别任务更新结果', () => {
    expect(shouldApplyOcrResult({ startedItemId: 1, currentItemId: 2, startedTaskId: 3, currentTaskId: 3 })).toBe(false)
    expect(shouldApplyOcrResult({ startedItemId: 1, currentItemId: 1, startedTaskId: 3, currentTaskId: 3 })).toBe(true)
  })

  it('切换图片会使正在进行的识别任务失效', () => {
    const currentTaskId = invalidateOcrTask(3)
    expect(shouldApplyOcrResult({ startedItemId: 1, currentItemId: 2, startedTaskId: 3, currentTaskId })).toBe(false)
    expect(shouldApplyOcrResult({ startedItemId: 1, currentItemId: 1, startedTaskId: 3, currentTaskId })).toBe(false)
  })

  it('不允许将空白 OCR 结果保存到历史记录', () => {
    expect(canSaveOcrResult('  \n ')).toBe(false)
    expect(canSaveOcrResult('订单号 A-1024')).toBe(true)
  })

  it('将初始化失败转换为可重试的中文提示', () => {
    expect(ocrErrorMessage(new Error('ENOENT: chi_sim.traineddata.gz')))
      .toBe('OCR 本地模型缺失，请重新安装应用后重试')
  })

  it('将复制和保存失败转换为可读提示', () => {
    expect(ocrActionErrorMessage('copy')).toBe('复制失败，请重试')
    expect(ocrActionErrorMessage('save')).toBe('保存失败，请重试')
  })
})
