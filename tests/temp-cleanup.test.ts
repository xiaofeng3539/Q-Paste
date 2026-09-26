import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupStaleTempFiles } from '../src/main/temp-cleanup'

const roots: string[] = []
function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'q-paste-temp-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('临时文件清理', () => {
  it('仅清理 temp 中过期且匹配 Q-Paste 命名的文件', () => {
    const root = makeRoot()
    const temp = path.join(root, 'temp')
    const outside = path.join(root, 'outside.tmp')
    fs.mkdirSync(temp)
    const stale = path.join(temp, 'upload-old')
    const keep = path.join(temp, 'notes.txt')
    fs.writeFileSync(stale, 'old')
    fs.writeFileSync(keep, 'keep')
    fs.writeFileSync(outside, 'outside')
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
    fs.utimesSync(stale, old, old)

    expect(cleanupStaleTempFiles(temp, Date.now())).toBe(1)
    expect(fs.existsSync(stale)).toBe(false)
    expect(fs.existsSync(keep)).toBe(true)
    expect(fs.existsSync(outside)).toBe(true)
  })
})
