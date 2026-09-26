import fs from 'node:fs'
import path from 'node:path'
import { isPathInside } from './storage-layout'

const TEMP_FILE = /^(?:upload-.+|\.tmp_.+)$/

export function cleanupStaleTempFiles(tempDir: string, now = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000): number {
  if (!fs.existsSync(tempDir)) return 0
  let removed = 0
  for (const entry of fs.readdirSync(tempDir, { withFileTypes: true })) {
    if (!entry.isFile() || !TEMP_FILE.test(entry.name)) continue
    const candidate = path.join(tempDir, entry.name)
    if (!isPathInside(tempDir, candidate)) continue
    try {
      if (now - fs.statSync(candidate).mtimeMs < maxAgeMs) continue
      fs.unlinkSync(candidate)
      removed += 1
    } catch {}
  }
  return removed
}
