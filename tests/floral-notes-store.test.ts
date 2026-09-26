import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FloralNotesStore } from '../electron/floral/notes-store'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })))

describe('FloralNotesStore', () => {
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
