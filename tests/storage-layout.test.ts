import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getStorageLayout, isPathInside } from '../src/main/storage-layout'

describe('统一存储布局', () => {
  it('将每种数据放入固定子目录', () => {
    const root = path.resolve('D:\\Q-Paste 数据')
    const layout = getStorageLayout(root)

    expect(layout.dbPath).toBe(path.join(root, 'database', 'q-paste.db'))
    expect(layout.backupsDir).toBe(path.join(root, 'database', 'backups'))
    expect(layout.imagesDir).toBe(path.join(root, 'images'))
    expect(layout.textsDir).toBe(path.join(root, 'texts'))
    expect(layout.transfersDir).toBe(path.join(root, 'transfers'))
    expect(layout.exportsDir).toBe(path.join(root, 'exports'))
    expect(layout.logsDir).toBe(path.join(root, 'logs'))
    expect(layout.syncStatePath).toBe(path.join(root, 'sync', 'cloud-sync-state.json'))
    expect(layout.tempDir).toBe(path.join(root, 'temp'))
    expect(layout.configPath).toBe(path.join(root, 'config', 'q-paste-config.json'))
  })

  it('仅接受目录内部的路径', () => {
    const root = path.resolve('D:\\Q-Paste 数据', 'temp')
    expect(isPathInside(root, path.join(root, 'upload-a'))).toBe(true)
    expect(isPathInside(root, path.resolve(root, '..', 'outside.txt'))).toBe(false)
  })
})
