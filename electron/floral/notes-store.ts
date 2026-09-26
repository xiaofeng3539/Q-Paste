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
  constructor(readonly root: string) {}

  private get notesDir() { return path.join(this.root, 'notes') }
  private get metadataPath() { return path.join(this.root, 'metadata.json') }
  private get configPath() { return path.join(this.root, 'config.json') }
  private async ensure() {
    await fs.mkdir(this.notesDir, { recursive: true })
    if (!(await exists(this.metadataPath))) await this.writeMetadata([])
  }
  private async metadata(): Promise<FloralNoteMetadata[]> {
    await this.ensure()
    try {
      const parsed = JSON.parse(await fs.readFile(this.metadataPath, 'utf8')) as { notes?: FloralNoteMetadata[] }
      return Array.isArray(parsed.notes) ? parsed.notes : []
    } catch { return [] }
  }
  private async writeMetadata(notes: FloralNoteMetadata[]) {
    await fs.mkdir(this.root, { recursive: true })
    const temp = `${this.metadataPath}.${randomUUID()}.tmp`
    await fs.writeFile(temp, JSON.stringify({ notes }, null, 2), 'utf8')
    await fs.rename(temp, this.metadataPath)
  }
  private filePath(note: Pick<FloralNoteMetadata, 'category' | 'fileName'>) {
    return path.join(this.notesDir, note.category, note.fileName)
  }
  async listNotes(): Promise<FloralNoteMetadata[]> {
    const notes = await this.metadata()
    const available = await Promise.all(notes.map(async (note) => (await exists(this.filePath(note))) ? note : null))
    return available.filter((note): note is FloralNoteMetadata => note !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  async getNote(id: string): Promise<FloralNote> {
    const item = (await this.metadata()).find((note) => note.id === id)
    if (!item) throw appError('noteNotFound', `Note ${id} was not found`)
    return { ...item, content: await fs.readFile(this.filePath(item), 'utf8') }
  }
  async createNote(request: SaveNoteRequest): Promise<FloralNote> {
    await this.ensure()
    const id = randomUUID(), now = new Date().toISOString()
    const fileName = makeFileName(id, request.title)
    const item = { id, title: request.title, fileName, category: safeCategory(request.category), createdAt: now, updatedAt: now, wordCount: wordCount(request.content), preview: preview(request.content) }
    await fs.mkdir(path.dirname(this.filePath(item)), { recursive: true })
    await fs.writeFile(this.filePath(item), request.content, 'utf8')
    await this.writeMetadata([...(await this.metadata()), item])
    return { ...item, content: request.content }
  }
  async updateNote(id: string, request: SaveNoteRequest): Promise<FloralNote> {
    const notes = await this.metadata(), index = notes.findIndex((note) => note.id === id)
    if (index < 0) throw appError('noteNotFound', `Note ${id} was not found`)
    const previous = notes[index], now = new Date().toISOString()
    const item = { ...previous, title: request.title, fileName: makeFileName(id, request.title), category: safeCategory(request.category), updatedAt: now, wordCount: wordCount(request.content), preview: preview(request.content) }
    await fs.mkdir(path.dirname(this.filePath(item)), { recursive: true })
    await fs.writeFile(this.filePath(item), request.content, 'utf8')
    notes[index] = item
    await this.writeMetadata(notes)
    if (this.filePath(previous) !== this.filePath(item)) await fs.rm(this.filePath(previous), { force: true })
    return { ...item, content: request.content }
  }
  async deleteNote(id: string): Promise<void> {
    const notes = await this.metadata(), index = notes.findIndex((note) => note.id === id)
    if (index < 0) throw appError('noteNotFound', `Note ${id} was not found`)
    await fs.rm(this.filePath(notes[index]), { force: true })
    await fs.rm(path.join(this.root, 'images', id), { recursive: true, force: true })
    notes.splice(index, 1); await this.writeMetadata(notes)
  }
  async moveCategory(id: string, category: string): Promise<FloralNoteMetadata> {
    const notes = await this.metadata(), note = notes.find((item) => item.id === id)
    if (!note) throw appError('noteNotFound', `Note ${id} was not found`)
    const updated = { ...note, category: safeCategory(category), sortOrder: undefined, updatedAt: new Date().toISOString() }
    await fs.mkdir(path.dirname(this.filePath(updated)), { recursive: true })
    await fs.rename(this.filePath(note), this.filePath(updated))
    notes[notes.indexOf(note)] = updated; await this.writeMetadata(notes); return updated
  }
  async reorderNotes(category: string, orderedIds: string[]): Promise<void> {
    const notes = await this.metadata()
    const inCategory = notes.filter((note) => note.category === category)
    if (orderedIds.length !== inCategory.length || new Set(orderedIds).size !== inCategory.length ||
        inCategory.some((note) => !orderedIds.includes(note.id))) throw new Error('Invalid Floral note order')
    const order = new Map(orderedIds.map((id, index) => [id, index]))
    await this.writeMetadata(notes.map((note) => note.category === category
      ? { ...note, sortOrder: order.get(note.id) } : note))
  }
  async listCategories(): Promise<string[]> {
    await this.ensure()
    return (await fs.readdir(this.notesDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  }
  async createCategory(name: string): Promise<void> { await fs.mkdir(path.join(this.notesDir, safeCategory(name)), { recursive: true }) }
  async renameCategory(oldName: string, newName: string): Promise<void> {
    const oldPath = path.join(this.notesDir, safeCategory(oldName)), newPath = path.join(this.notesDir, safeCategory(newName))
    if (!(await exists(oldPath))) throw appError('categoryNotFound', `分类「${oldName}」不存在`)
    if (await exists(newPath)) throw appError('categoryAlreadyExists', `分类「${newName}」已存在`)
    await fs.rename(oldPath, newPath)
    await this.writeMetadata((await this.metadata()).map((note) => note.category === oldName ? { ...note, category: newName } : note))
  }
  async deleteCategory(name: string): Promise<void> {
    const category = safeCategory(name), dir = path.join(this.notesDir, category)
    if (!(await exists(dir))) throw appError('categoryNotFound', `分类「${name}」不存在`)
    const notes = await this.metadata()
    for (const note of notes.filter((item) => item.category === category)) {
      const moved = { ...note, category: '', sortOrder: undefined }
      await fs.rename(this.filePath(note), this.filePath(moved)); notes[notes.indexOf(note)] = moved
    }
    await fs.rm(dir, { recursive: true, force: true }); await this.writeMetadata(notes)
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
  async saveImage(id: string, data: Uint8Array, extension: string): Promise<string> {
    if (!(await this.metadata()).some((note) => note.id === id)) throw appError('noteNotFound', `Note ${id} was not found`)
    const ext = extension.toLowerCase().replace(/^\./, '')
    if (!['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) throw appError('unsupportedImageFormat', `不支持的图片格式: ${ext}`)
    const name = `${randomUUID()}.${ext}`, dir = path.join(this.root, 'images', id)
    await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, name), data)
    return `images/${id}/${name}`
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
async function exists(file: string): Promise<boolean> { try { await fs.access(file); return true } catch { return false } }
function appError(code: string, message: string) { return Object.assign(new Error(message), { code, details: {} }) }
