import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getStorageLayout } from '../src/main/storage-layout'
import { migrateLegacyStorage, readStorageRootPointer, writeStorageRootPointer } from '../src/main/storage-migration'

const roots: string[] = []
function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'q-paste-storage-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('旧版存储迁移', () => {
  it('复制旧数据而不删除源文件', () => {
    const sandbox = tempRoot()
    const legacyRoot = path.join(sandbox, 'legacy')
    const legacyUserData = path.join(sandbox, 'user-data')
    const layout = getStorageLayout(path.join(sandbox, 'unified'))
    fs.mkdirSync(path.join(legacyRoot, 'images'), { recursive: true })
    fs.mkdirSync(path.join(legacyUserData, 'logs'), { recursive: true })
    fs.writeFileSync(path.join(legacyRoot, 'q-paste.db'), 'database')
    fs.writeFileSync(path.join(legacyRoot, 'images', 'a.png'), 'image')
    fs.writeFileSync(path.join(legacyUserData, 'q-paste-config.json'), '{"storagePath":"legacy"}')
    fs.writeFileSync(path.join(legacyUserData, 'logs', 'main.log'), 'log')
    fs.writeFileSync(path.join(legacyUserData, 'cloud-sync-state.json'), '{"cursor":1}')

    migrateLegacyStorage({ legacyRoot, legacyUserData, layout })

    expect(fs.readFileSync(layout.dbPath, 'utf8')).toBe('database')
    expect(fs.readFileSync(path.join(layout.imagesDir, 'a.png'), 'utf8')).toBe('image')
    expect(fs.readFileSync(layout.configPath, 'utf8')).toContain('storagePath')
    expect(fs.readFileSync(path.join(layout.logsDir, 'main.log'), 'utf8')).toBe('log')
    expect(fs.readFileSync(layout.syncStatePath, 'utf8')).toContain('cursor')
    expect(fs.existsSync(path.join(legacyRoot, 'q-paste.db'))).toBe(true)
    expect(fs.existsSync(path.join(legacyRoot, 'images', 'a.png'))).toBe(true)
  })

  it('只读取有效的绝对路径指针并以原子方式保存', () => {
    const sandbox = tempRoot()
    const root = path.join(sandbox, 'root')
    const pointer = path.join(sandbox, 'q-paste-storage-root.json')
    fs.mkdirSync(root)

    writeStorageRootPointer(pointer, root)
    expect(readStorageRootPointer(pointer)).toBe(root)
    fs.writeFileSync(pointer, '{"rootPath":"relative"}')
    expect(readStorageRootPointer(pointer)).toBeNull()
  })
})
