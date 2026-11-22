import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { copyExistingFloralData, FloralMigrationGate } from '../electron/floral/data-migration'

const roots: string[] = []
async function tempRoot() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qpaste-floral-')); roots.push(root); return root }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })

describe('copyExistingFloralData', () => {
  it('drains earlier writes and sends later writes to the new store', async () => {
    const gate = new FloralMigrationGate()
    const calls: string[] = []
    let release!: () => void
    let store = 'old'
    const save = gate.run(async () => {
      await new Promise<void>(resolve => { release = resolve })
      calls.push(`save:${store}`)
    })
    const migration = gate.migrate(async () => { calls.push('copy'); store = 'new' })
    const later = gate.run(async () => { calls.push(`save:${store}`) })
    expect(calls).toEqual([])
    release()
    await Promise.all([save, migration, later])
    expect(calls).toEqual(['save:old', 'copy', 'save:new'])
  })
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

  it('does not publish a copied vault with a damaged attachment', async () => {
    const root = await tempRoot(), source = path.join(root, 'old'), destination = path.join(root, 'new')
    await fs.mkdir(path.join(source, 'notes'), { recursive: true })
    await fs.mkdir(path.join(source, 'images'), { recursive: true })
    await fs.writeFile(path.join(source, 'metadata.json'), '{"notes":[]}')
    await fs.writeFile(path.join(source, 'images', 'attachment.png'), 'original')
    const copy = fs.cp
    const injection = vi.spyOn(fs, 'cp').mockImplementation(async (from, to, options) => {
      await copy(from, to, options)
      if (from === source) await fs.writeFile(path.join(String(to), 'images', 'attachment.png'), 'modified')
    })
    try {
      await expect(copyExistingFloralData(source, destination)).rejects.toThrow()
      await expect(fs.access(destination)).rejects.toThrow()
      await expect(fs.readFile(path.join(source, 'images', 'attachment.png'), 'utf8')).resolves.toBe('original')
    } finally { injection.mockRestore() }
  })
})
