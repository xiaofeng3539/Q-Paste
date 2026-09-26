import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('花笺桌面页面', () => {
  it('从本地文件加载时能找到入口脚本和样式', () => {
    const htmlPath = path.resolve('dist/floral/index.html')
    const html = fs.readFileSync(htmlPath, 'utf8')
    const references = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1])

    expect(references.length).toBeGreaterThan(0)
    for (const reference of references) {
      const assetPath = fileURLToPath(new URL(reference, `file:///${htmlPath.replace(/\\/g, '/')}`))
      expect(fs.existsSync(assetPath), `${reference} 应指向花笺构建目录中的文件`).toBe(true)
    }
  })
})
