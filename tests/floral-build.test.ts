import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const floralRoot = path.resolve(process.cwd(), 'vendor/floral-notepaper')

describe('花笺上游源码快照', () => {
  it('记录固定的上游仓库与 commit', () => {
    const upstream = fs.readFileSync(path.join(floralRoot, 'UPSTREAM.md'), 'utf8')
    expect(upstream).toContain('Achilng/floral-notepaper')
    expect(upstream).toContain('69a43aef87d2d8fa90c7a7d929cd113941f1fde3')
  })

  it('保留上游 MIT 许可证及版权声明', () => {
    const license = fs.readFileSync(path.join(floralRoot, 'LICENSE'), 'utf8')
    expect(license).toContain('MIT License')
    expect(license).toContain('Copyright (c) 2026 Achilng')
  })

  it('包含原始入口和桌面功能源代码', () => {
    expect(fs.existsSync(path.join(floralRoot, 'src/main.tsx'))).toBe(true)
    expect(fs.existsSync(path.join(floralRoot, 'src/components/MainWindow.tsx'))).toBe(true)
    expect(fs.existsSync(path.join(floralRoot, 'src-tauri/src/lib.rs'))).toBe(true)
  })
})
