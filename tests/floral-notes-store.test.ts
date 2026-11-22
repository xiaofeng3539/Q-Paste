import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FloralNotesStore } from '../electron/floral/notes-store'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })))

describe('FloralNotesStore', () => {
  it('persists both updates when two windows save concurrently', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'floral-concurrent-'))
    roots.push(root)
    const store = new FloralNotesStore(root)
    const [first, second] = await Promise.all([
      store.createNote({ title: '甲', content: '旧甲', category: '' }),
      store.createNote({ title: '乙', content: '旧乙', category: '' }),
    ])
    await Promise.all([
      store.updateNote(first.id, { title: '甲', content: '新甲', category: '' }),
      store.updateNote(second.id, { title: '乙', content: '新乙', category: '' }),
    ])
    const reopened = new FloralNotesStore(root)
    expect((await reopened.listNotes()).map(note => note.preview).sort()).toEqual(['新乙', '新甲'].sort())
    expect((await reopened.getNote(first.id)).content).toBe('新甲')
    expect((await reopened.getNote(second.id)).content).toBe('新乙')
  })

  it('preserves the previous markdown if the replacement fails and accepts a retry', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'floral-atomic-'))
    roots.push(root)
    const store = new FloralNotesStore(root)
    const note = await store.createNote({ title: '甲', content: '旧正文', category: '' })
    const rename = fs.promises.rename
    const replacement = vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (String(to).endsWith(note.fileName)) throw new Error('replace failed')
      return rename(from, to)
    })
    const request = { title: '甲', content: '新正文', category: '' }
    try {
      await expect(store.updateNote(note.id, request)).rejects.toThrow('replace failed')
      expect(await store.getNote(note.id)).toMatchObject({ content: '旧正文', preview: '旧正文' })
      expect(await fs.promises.readdir(path.join(root, 'notes'))).toEqual([note.fileName])
    } finally {
      replacement.mockRestore()
    }
    await expect(store.updateNote(note.id, request)).resolves.toMatchObject({ content: '新正文' })
  })

  it('restores the markdown when the index replacement fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'floral-index-failure-'))
    roots.push(root)
    const store = new FloralNotesStore(root)
    const note = await store.createNote({ title: '甲', content: '旧正文', category: '' })
    const rename = fs.promises.rename
    const replacement = vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (String(to).endsWith('metadata.json')) throw new Error('index replace failed')
      return rename(from, to)
    })
    try {
      await expect(store.updateNote(note.id, { title: '甲', content: '新正文' })).rejects.toThrow('index replace failed')
      expect(await new FloralNotesStore(root).getNote(note.id)).toMatchObject({ content: '旧正文', preview: '旧正文' })
    } finally {
      replacement.mockRestore()
    }
  })

  it('recovers an interrupted body replacement before reopening the note', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'floral-reopen-'))
    roots.push(root)
    const store = new FloralNotesStore(root)
    const note = await store.createNote({ title: '甲', content: '旧正文', category: '' })
    const file = path.join(root, 'notes', note.fileName)
    const pending = path.join(root, '.pending-note-write.json')
    await fs.promises.writeFile(pending, JSON.stringify({
      next: { ...note, updatedAt: new Date(Date.parse(note.updatedAt) + 1).toISOString() },
      previous: note, previousBody: '旧正文',
    }))
    await fs.promises.writeFile(file, '换完正文后进程退出')
    expect(await new FloralNotesStore(root).getNote(note.id)).toMatchObject({ content: '旧正文', preview: '旧正文' })
    expect(fs.existsSync(pending)).toBe(false)
  })

  it('keeps the committed category when another window saves only the body', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'floral-move-save-'))
    roots.push(root)
    const store = new FloralNotesStore(root)
    const note = await store.createNote({ title: '甲', content: '旧正文', category: '旧分类' })
    await Promise.all([
      store.moveCategory(note.id, '新分类'),
      store.updateNote(note.id, { title: '甲', content: '新正文' }),
    ])
    expect(await store.getNote(note.id)).toMatchObject({ category: '新分类', content: '新正文' })
  })

  it('persists notes as markdown with metadata and isolates categories', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'floral-store-'))
    roots.push(root)
    const store = new FloralNotesStore(root)
    const created = await store.createNote({ title: '第一篇', content: '# 内容', category: '工作' })
    expect((await store.listNotes()).map(({ id }) => id)).toContain(created.id)
    expect(await fs.promises.readFile(path.join(root, 'notes', '工作', created.fileName), 'utf8')).toBe('# 内容')
    expect((await store.getNote(created.id)).content).toBe('# 内容')
    const updated = await store.updateNote(created.id, { title: '更新', content: '已保存', category: '' })
    expect(updated.title).toBe('更新')
    await store.deleteNote(created.id)
    expect(await store.listNotes()).toEqual([])
  })

  it('keeps a reordered category after reopening and editing, without changing other categories', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'floral-order-'))
    roots.push(root)
    const store = new FloralNotesStore(root)
    const first = await store.createNote({ title: '甲', content: '甲', category: '工作' })
    const second = await store.createNote({ title: '乙', content: '乙', category: '工作' })
    const other = await store.createNote({ title: '丙', content: '丙', category: '日常' })
    await store.reorderNotes('工作', [first.id, second.id])
    await store.updateNote(first.id, { title: '甲', content: '已编辑', category: '工作' })
    const reopened = new FloralNotesStore(root)
    expect((await reopened.getNote(first.id)).sortOrder).toBe(0)
    expect((await reopened.getNote(second.id)).sortOrder).toBe(1)
    expect((await reopened.getNote(other.id)).sortOrder).toBeUndefined()
    await expect(reopened.reorderNotes('工作', [first.id, other.id])).rejects.toThrow()
    expect((await reopened.getNote(second.id)).sortOrder).toBe(1)
  })
})
