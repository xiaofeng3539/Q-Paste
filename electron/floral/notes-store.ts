import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export interface FloralNoteMetadata {
  id: string; title: string; fileName: string; category: string
  createdAt: string; updatedAt: string; wordCount: number; preview: string
  sortOrder?: number
}
export interface FloralNote extends FloralNoteMetadata { content: string }
export interface SaveNoteRequest { title: string; content: string; category: string }
type FloralConfig = Record<string, unknown> & { locale: string; dataDir: string; globalShortcut: string }
type NoteFile = Pick<FloralNoteMetadata, 'id' | 'updatedAt' | 'category' | 'fileName'>
type PendingNoteWrite = { next: NoteFile; previous?: NoteFile; previousBody?: string }

const defaultConfig: FloralConfig = {
  locale: 'zh-CN', dataDir: '', globalShortcut: 'Alt+N', closeToTray: true, autostart: false,
  defaultViewMode: 'split', noteAutoSave: true, noteSurfaceAutoSave: true, tileColor: '#f7e7a8',
  tileColorMode: 'system', theme: 'system', fontSize: 16, surfaceFontSize: 16, tabIndentSize: 2,
  externalFileAutoSave: true, backgroundImagePath: '', backgroundFit: 'cover', backgroundDim: 0,
  backgroundBlur: 0, backgroundScale: 1, backgroundPositionX: 50, backgroundPositionY: 50,
  rememberSurfaceSize: true, tileCtrlClose: true, tileDoubleClickToEdit: false, tileSaveReturnsToPin: false,
  tileRenderMarkdown: false, renderHtmlMarkdown: false, splitScrollSync: true,
  toggleVisibilityShortcut: 'Alt+Shift+N', openAtCursor: false,
}

export class FloralNotesStore {
  private pending = Promise.resolve()
  private recoveryNeeded = true

  constructor(readonly root: string) {}

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation)
    this.pending = result.then(() => undefined, () => undefined)
    return result
  }

  private get notesDir() { return path.join(this.root, 'notes') }
  private get metadataPath() { return path.join(this.root, 'metadata.json') }
  private get configPath() { return path.join(this.root, 'config.json') }
  private get pendingNotePath() { return path.join(this.root, '.pending-note-write.json') }
  private async ensure() {
    await fs.mkdir(this.notesDir, { recursive: true })
    if (!(await exists(this.metadataPath))) await this.writeMetadata([])
  }
  private async metadata(): Promise<FloralNoteMetadata[]> {
    await this.ensure()
    const parsed = JSON.parse(await fs.readFile(this.metadataPath, 'utf8')) as { notes?: FloralNoteMetadata[] }
    if (!Array.isArray(parsed.notes)) throw new Error('Invalid Floral note index')
    if (this.recoveryNeeded) await this.recoverPendingNote(parsed.notes)
    return parsed.notes
  }
  private async writeMetadata(notes: FloralNoteMetadata[]) {
    await fs.mkdir(this.root, { recursive: true })
    await replaceFile(this.metadataPath, JSON.stringify({ notes }, null, 2))
  }
  private filePath(note: Pick<FloralNoteMetadata, 'category' | 'fileName'>) {
    return path.join(this.notesDir, note.category, note.fileName)
  }

  private async recoverPendingNote(notes: FloralNoteMetadata[]): Promise<void> {
    const data = await fs.readFile(this.pendingNotePath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return null
    })
    if (data === null) {
      this.recoveryNeeded = false
      return
    }
    const pending = JSON.parse(data) as PendingNoteWrite
    await this.finishNoteWrite(pending, notes.some((note) => note.id === pending.next.id && note.updatedAt === pending.next.updatedAt))
  }

  private async finishNoteWrite(pending: PendingNoteWrite, committed: boolean): Promise<void> {
    const fileFor = (note: NoteFile) => {
      safeCategory(note.category)
      if (!note.fileName.endsWith('.md') || /[/\\:]/.test(note.fileName)) throw new Error('Invalid pending Floral note path')
      return this.filePath(note)
    }
    const target = fileFor(pending.next)
    const previous = pending.previous ? fileFor(pending.previous) : undefined
    if (!committed) {
      if (pending.previousBody !== undefined && previous) await replaceFile(previous, pending.previousBody)
      else await fs.rm(target, { force: true })
    } else if (previous && !sameNotePath(previous, target)) {
      await fs.rm(previous, { force: true }).catch((error) => {
        console.warn('Could not remove the previous Floral note file:', error)
      })
    }
    await fs.rm(this.pendingNotePath, { force: true })
    this.recoveryNeeded = false
  }

  private async commitNoteWrite(note: FloralNoteMetadata, content: string, notes: FloralNoteMetadata[], previous?: FloralNoteMetadata) {
    const target = this.filePath(note)
    const previousFile = previous && this.filePath(previous)
    const previousBody = previousFile && sameNotePath(previousFile, target)
      ? await fs.readFile(previousFile, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
        return undefined
      }) : undefined
    const pending = { next: note, previous, previousBody }
    await fs.mkdir(path.dirname(target), { recursive: true })
    await replaceFile(this.pendingNotePath, JSON.stringify(pending))
    this.recoveryNeeded = true
    let bodyWritten = false
    try {
      await replaceFile(target, content)
      bodyWritten = true
      await this.writeMetadata(notes)
    } catch (error) {
      if (bodyWritten) await this.finishNoteWrite(pending, false)
      else await fs.rm(this.pendingNotePath, { force: true })
      throw error
    }
    await this.finishNoteWrite(pending, true).catch((error) => {
      console.warn('Could not finish Floral note cleanup:', error)
    })
  }
  listNotes(): Promise<FloralNoteMetadata[]> {
    return this.run(async () => {
      const notes = await this.metadata()
      const available = await Promise.all(notes.map(async (note) => (await exists(this.filePath(note))) ? note : null))
      return available.filter((note): note is FloralNoteMetadata => note !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    })
  }
  getNote(id: string): Promise<FloralNote> {
    return this.run(async () => {
      const item = (await this.metadata()).find((note) => note.id === id)
      if (!item) throw appError('noteNotFound', `Note ${id} was not found`)
      return { ...item, content: await fs.readFile(this.filePath(item), 'utf8') }
    })
  }
  createNote(request: SaveNoteRequest): Promise<FloralNote> {
    return this.run(async () => {
      const notes = await this.metadata()
      const id = randomUUID(), now = new Date().toISOString()
      const fileName = makeFileName(id, request.title)
      const item = { id, title: request.title, fileName, category: safeCategory(request.category), createdAt: now, updatedAt: now, wordCount: wordCount(request.content), preview: preview(request.content) }
      await this.commitNoteWrite(item, request.content, [...notes, item])
      return { ...item, content: request.content }
    })
  }
  updateNote(id: string, request: Omit<SaveNoteRequest, 'category'> & { category?: string }): Promise<FloralNote> {
    return this.run(async () => {
      const notes = await this.metadata(), index = notes.findIndex((note) => note.id === id)
      if (index < 0) throw appError('noteNotFound', `Note ${id} was not found`)
      const previous = notes[index]
      const previousTime = Date.parse(previous.updatedAt) || 0
      const now = new Date(Math.max(Date.now(), previousTime + 1)).toISOString()
      const category = request.category === undefined ? previous.category : safeCategory(request.category)
      const item = { ...previous, title: request.title, fileName: makeFileName(id, request.title), category, updatedAt: now, wordCount: wordCount(request.content), preview: preview(request.content) }
      notes[index] = item
      await this.commitNoteWrite(item, request.content, notes, previous)
      return { ...item, content: request.content }
    })
  }
  deleteNote(id: string): Promise<void> {
    return this.run(async () => {
      const notes = await this.metadata(), index = notes.findIndex((note) => note.id === id)
      if (index < 0) throw appError('noteNotFound', `Note ${id} was not found`)
      await fs.rm(this.filePath(notes[index]), { force: true })
      await fs.rm(path.join(this.root, 'images', id), { recursive: true, force: true })
      notes.splice(index, 1); await this.writeMetadata(notes)
    })
  }
  moveCategory(id: string, category: string): Promise<FloralNoteMetadata> {
    return this.run(async () => {
      const notes = await this.metadata(), note = notes.find((item) => item.id === id)
      if (!note) throw appError('noteNotFound', `Note ${id} was not found`)
      const updated = { ...note, category: safeCategory(category), sortOrder: undefined, updatedAt: new Date().toISOString() }
      await fs.mkdir(path.dirname(this.filePath(updated)), { recursive: true })
      await fs.rename(this.filePath(note), this.filePath(updated))
      notes[notes.indexOf(note)] = updated; await this.writeMetadata(notes); return updated
    })
  }
  reorderNotes(category: string, orderedIds: string[]): Promise<void> {
    return this.run(async () => {
      const notes = await this.metadata()
      const inCategory = notes.filter((note) => note.category === category)
      if (orderedIds.length !== inCategory.length || new Set(orderedIds).size !== inCategory.length ||
          inCategory.some((note) => !orderedIds.includes(note.id))) throw new Error('Invalid Floral note order')
      const order = new Map(orderedIds.map((id, index) => [id, index]))
      await this.writeMetadata(notes.map((note) => note.category === category
        ? { ...note, sortOrder: order.get(note.id) } : note))
    })
  }
  listCategories(): Promise<string[]> {
    return this.run(async () => {
      await this.ensure()
      return (await fs.readdir(this.notesDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    })
  }
  createCategory(name: string): Promise<void> {
    return this.run(async () => {
      await fs.mkdir(path.join(this.notesDir, safeCategory(name)), { recursive: true })
    })
  }
  renameCategory(oldName: string, newName: string): Promise<void> {
    return this.run(async () => {
      const oldPath = path.join(this.notesDir, safeCategory(oldName)), newPath = path.join(this.notesDir, safeCategory(newName))
      if (!(await exists(oldPath))) throw appError('categoryNotFound', `分类「${oldName}」不存在`)
      if (await exists(newPath)) throw appError('categoryAlreadyExists', `分类「${newName}」已存在`)
      await fs.rename(oldPath, newPath)
      await this.writeMetadata((await this.metadata()).map((note) => note.category === oldName ? { ...note, category: newName } : note))
    })
  }
  deleteCategory(name: string): Promise<void> {
    return this.run(async () => {
      const category = safeCategory(name), dir = path.join(this.notesDir, category)
      if (!(await exists(dir))) throw appError('categoryNotFound', `分类「${name}」不存在`)
      const notes = await this.metadata()
      for (const note of notes.filter((item) => item.category === category)) {
        const moved = { ...note, category: '', sortOrder: undefined }
        await fs.rename(this.filePath(note), this.filePath(moved)); notes[notes.indexOf(note)] = moved
      }
      await fs.rm(dir, { recursive: true, force: true }); await this.writeMetadata(notes)
    })
  }
  async importMarkdown(file: string, category = ''): Promise<FloralNote> {
    if (path.extname(file).toLowerCase() !== '.md') throw appError('unsupportedFile', '只支持导入 .md 文件')
    const content = await fs.readFile(file, 'utf8'), firstHeading = content.match(/^#\s+(.+)$/m)?.[1]
    return this.createNote({ title: firstHeading || path.basename(file, '.md'), content, category })
  }
  async exportMarkdown(id: string, file: string): Promise<void> {
    const note = await this.getNote(id); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, note.content, 'utf8')
  }
  async getConfig(): Promise<FloralConfig> {
    await fs.mkdir(this.root, { recursive: true })
    try { return { ...defaultConfig, ...JSON.parse(await fs.readFile(this.configPath, 'utf8')), dataDir: this.root } }
    catch { return { ...defaultConfig, dataDir: this.root } }
  }
  async saveConfig(config: Partial<FloralConfig>): Promise<FloralConfig> {
    const saved = { ...(await this.getConfig()), ...config, dataDir: this.root }
    const temp = `${this.configPath}.${randomUUID()}.tmp`
    await fs.writeFile(temp, JSON.stringify(saved, null, 2), 'utf8'); await fs.rename(temp, this.configPath)
    return saved
  }
  saveImage(id: string, data: Uint8Array, extension: string): Promise<string> {
    return this.run(async () => {
      if (!(await this.metadata()).some((note) => note.id === id)) throw appError('noteNotFound', `Note ${id} was not found`)
      const ext = extension.toLowerCase().replace(/^\./, '')
      if (!['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) throw appError('unsupportedImageFormat', `不支持的图片格式: ${ext}`)
      const name = `${randomUUID()}.${ext}`, dir = path.join(this.root, 'images', id)
      await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, name), data)
      return `images/${id}/${name}`
    })
  }
}

function safeCategory(value: string): string {
  const name = (value || '').trim()
  if (name.includes('/') || name.includes('\\') || name.includes(':') || name.includes('..')) throw appError('categoryNameInvalidChars', '分类名不能包含特殊字符')
  return name
}
function makeFileName(id: string, title: string): string {
  const stem = title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)
  return `${id}${stem ? `_${stem}` : ''}.md`
}
function wordCount(content: string): number { return Array.from(content.matchAll(/[\p{L}\p{N}]+/gu)).length }
function preview(content: string): string { return content.replace(/[#>*_`~-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160) }
function sameNotePath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}
export async function replaceFile(file: string, content: string): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temp, content, { encoding: 'utf8', flush: true })
    await fs.rename(temp, file)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}
async function exists(file: string): Promise<boolean> { try { await fs.access(file); return true } catch { return false } }
function appError(code: string, message: string) { return Object.assign(new Error(message), { code, details: {} }) }
