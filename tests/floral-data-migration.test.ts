import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { copyExistingFloralData } from '../electron/floral/data-migration'

const roots: string[] = []
async function tempRoot() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qpaste-floral-')); roots.push(root); return root }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })

describe('copyExistingFloralData', () => {
  it('copies existing Floral notes and leaves the source intact', async () => {
    const root = await tempRoot(), source = path.join(root, 'old'), destination = path.join(root, 'new', 'floral')
    await fs.mkdir(path.join(source, 'notes'), { recursive: true })
    await fs.writeFile(path.join(source, 'metadata.json'), JSON.stringify({ notes: [{ id: 'a' }] }))
    await fs.writeFile(path.join(source, 'notes', 'a.md'), 'note')
    await expect(copyExistingFloralData(source, destination)).resolves.toBe(true)
    await expect(fs.readFile(path.join(destination, 'notes', 'a.md'), 'utf8')).resolves.toBe('note')
    await expect(fs.readFile(path.join(source, 'notes', 'a.md'), 'utf8')).resolves.toBe('note')
  })
  it('does not overwrite a destination', async () => {
    const root = await tempRoot(), source = path.join(root, 'old'), destination = path.join(root, 'new')
    await fs.mkdir(path.join(source, 'notes'), { recursive: true }); await fs.writeFile(path.join(source, 'metadata.json'), '{"notes":[]}')
    await fs.mkdir(destination); await fs.writeFile(path.join(destination, 'keep'), 'yes')
    await expect(copyExistingFloralData(source, destination)).resolves.toBe(false)
    await expect(fs.readFile(path.join(destination, 'keep'), 'utf8')).resolves.toBe('yes')
  })
})
