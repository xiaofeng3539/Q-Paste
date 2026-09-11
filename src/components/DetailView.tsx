import { useState, useEffect, useRef, useCallback } from 'react'
import { ClipboardItem } from '../types'
import { formatStorageSize, getTypeLabel, maskSensitive, parseFilePaths, basename } from '../lib/utils'
import { ShortcutAction } from '../lib/shortcuts'
import { FileText, Link, Image, Copy, Trash2, Monitor, X, ZoomIn, RotateCcw, Pin, Eye, EyeOff, Shield, Plus, ExternalLink, FolderOpen, FileCode2, QrCode, ScanText, FileDown, Loader2, Check } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import { tr } from '../i18n'

interface DetailViewProps {
  item: ClipboardItem | null
  density?: 'comfortable' | 'compact'
  onCopy: (item: ClipboardItem) => void
  onDelete: (id: number) => void
  onUpdate: (id: number, content: string) => void
  onTogglePin: (id: number) => void
  onUpdateAlias: (id: number, alias: string) => void
  onUpdateTags: (id: number, tags: string[]) => void
  onToggleSensitive: (id: number) => void
  onOpenUrl: (url: string) => void
  onOpenFile: (filePath: string) => void
  /** 收藏项删除确认态：为 true 时删除按钮变为"确认删除"高亮 */
  confirmingDelete: boolean
  /** 本地快捷键配置（用于按钮上的键位提示） */
  shortcuts: Record<ShortcutAction, string>
  /** 轻提示（复用主界面 Toast） */
  onToast?: (msg: string) => void
  monospace: boolean
}

function typeIcon(type: string, size = 'w-4 h-4') {
  switch (type) {
    case 'url':
      return <Link className={`${size} text-blue-500 dark:text-blue-400`} />
    case 'image':
      return <Image className={`${size} text-green-500 dark:text-green-400`} />
    case 'html':
      return <FileCode2 className={`${size} text-purple-500 dark:text-purple-400`} />
    case 'files':
      return <FolderOpen className={`${size} text-amber-500 dark:text-amber-400`} />
    default:
      return <FileText className={`${size} text-zinc-400 dark:text-zinc-400`} />
  }
}

const MIN_SCALE = 0.1
const MAX_SCALE = 10
const ZOOM_STEP = 0.1

export const isElectron = typeof window !== 'undefined' && !!window.electronAPI

export default function DetailView({
  item,
  onCopy,
  onDelete,
  onUpdate,
  onTogglePin,
  onUpdateAlias,
  onUpdateTags,
  onToggleSensitive,
  onOpenUrl,
  onOpenFile,
  confirmingDelete,
  shortcuts,
  monospace,
  density = 'comfortable',
  onToast,
}: DetailViewProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const monoClass = monospace ? 'font-mono' : 'font-sans'
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef({ startX: 0, startY: 0, posX: 0, posY: 0 })

  // Edit mode for text
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Alias editing
  const [isEditingAlias, setIsEditingAlias] = useState(false)
  const [aliasDraft, setAliasDraft] = useState('')
  const aliasInputRef = useRef<HTMLInputElement>(null)

  // Tag input
  const [showTagInput, setShowTagInput] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const tagInputRef = useRef<HTMLInputElement>(null)

  // Sensitive visibility
  const [showSensitive, setShowSensitive] = useState(false)

  /** 图片完整内容（dataURL）：列表查询已置空图片 content，详情按 id 异步加载 */
  const [imageContent, setImageContent] = useState('')
  const [qrOpen, setQrOpen] = useState(false)
  const [ocrBusy, setOcrBusy] = useState(false)
  const [ocrStage, setOcrStage] = useState('')

  // 选中图片记录时加载完整图片内容
  useEffect(() => {
    setImageContent('')
    if (!item || item.type !== 'image') return
    if (typeof window === 'undefined' || !window.electronAPI) return
    let cancelled = false
    window.electronAPI.getItemContent(item.id).then((content) => {
      if (!cancelled && content) setImageContent(content)
    })
    return () => { cancelled = true }
  }, [item?.id, item?.type])

  // Reset edit modes when item changes
  useEffect(() => {
    setIsEditing(false)
    setIsEditingAlias(false)
    setShowTagInput(false)
    setShowSensitive(false)
  }, [item?.id])

  // Auto-focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
    }
  }, [isEditing])

  // Auto-focus alias input
  useEffect(() => {
    if (isEditingAlias && aliasInputRef.current) {
      aliasInputRef.current.focus()
      aliasInputRef.current.select()
    }
  }, [isEditingAlias])

  // Auto-focus tag input
  useEffect(() => {
    if (showTagInput && tagInputRef.current) {
      tagInputRef.current.focus()
    }
  }, [showTagInput])

  function enterEditMode() {
    if (!item || item.type === 'image' || item.type === 'html' || item.type === 'files') return
    setEditContent(item.content)
    setIsEditing(true)
  }

  function saveEdit() {
    if (!item) return
    const trimmed = editContent.trim()
    if (trimmed && trimmed !== item.content) {
      onUpdate(item.id, trimmed)
    }
    setIsEditing(false)
  }

  function cancelEdit() {
    setIsEditing(false)
  }

  function startEditAlias() {
    if (!item) return
    setAliasDraft(item.alias || '')
    setIsEditingAlias(true)
  }

  function saveAlias() {
    if (!item) return
    const trimmed = aliasDraft.trim()
    if (trimmed !== (item.alias || '')) {
      onUpdateAlias(item.id, trimmed)
    }
    setIsEditingAlias(false)
  }

  function cancelAlias() {
    setIsEditingAlias(false)
  }

  function handleAddTag() {
    if (!item || !tagDraft.trim()) return
    const tag = tagDraft.trim()
    if (!item.tags.includes(tag)) {
      onUpdateTags(item.id, [...item.tags, tag])
    }
    setTagDraft('')
    setShowTagInput(false)
  }

  function handleRemoveTag(tag: string) {
    if (!item) return
    onUpdateTags(item.id, item.tags.filter((t) => t !== tag))
  }

  const openLightbox = useCallback(() => {
    setScale(1)
    setPos({ x: 0, y: 0 })
    setLightboxOpen(true)
  }, [])

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false)
  }, [])

  useEffect(() => {
    if (!lightboxOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeLightbox()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightboxOpen, closeLightbox])

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault()
    e.stopPropagation()
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale + delta))
    const rect = e.currentTarget.getBoundingClientRect()
    const cx = e.clientX - rect.left - rect.width / 2
    const cy = e.clientY - rect.top - rect.height / 2
    const ratio = newScale / scale
    setPos((prev) => ({
      x: cx - ratio * (cx - prev.x),
      y: cy - ratio * (cy - prev.y),
    }))
    setScale(newScale)
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return
    e.preventDefault()
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: pos.x,
      posY: pos.y,
    }
    setIsDragging(true)
  }

  useEffect(() => {
    if (!isDragging) return
    function onMouseMove(e: MouseEvent) {
      setPos({
        x: dragRef.current.posX + (e.clientX - dragRef.current.startX),
        y: dragRef.current.posY + (e.clientY - dragRef.current.startY),
      })
    }
    function onMouseUp() { setIsDragging(false) }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDragging])

  function handleImageDoubleClick() {
    setScale(1)
    setPos({ x: 0, y: 0 })
  }

  // ── 空状态 ──
  if (!item) {
    return (
      <div className="h-full flex items-center justify-center bg-transparent">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
            <FileText className="w-8 h-8 text-zinc-300 dark:text-zinc-700" />
          </div>
          <p className="text-sm text-zinc-400 dark:text-zinc-600">{tr('detail.empty')}</p>
          <div className="flex items-center gap-3 mt-2 justify-center text-[10px] text-zinc-300 dark:text-zinc-700">
            <span><kbd className="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded font-mono">{shortcuts.prev} {shortcuts.next}</kbd> {tr('detail.switch')}</span>
            <span><kbd className="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded font-mono">{shortcuts.copy}</kbd> {tr('detail.copy')}</span>
            <span><kbd className="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded font-mono">{shortcuts.delete}</kbd> {tr('detail.delete')}</span>
            <span><kbd className="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded font-mono">{shortcuts.pin}</kbd> {tr('detail.pin')}</span>
          </div>
        </div>
      </div>
    )
  }

  const isImage = item.type === 'image'
  const isHtml = item.type === 'html'
  const isFiles = item.type === 'files'
  const isSensitive = item.is_sensitive
  const displayContent = isSensitive && !showSensitive ? maskSensitive(item.content) : item.content
  const presetTags = tr('detail.presetTags').split(',').map((t) => t.trim())
  /** 富文本预览文档：注入主题化基础样式，覆盖源内容自带的颜色/背景（不改原始数据） */
  function buildHtmlPreviewDoc(content: string): string {
    const dark = document.documentElement.classList.contains('dark')
    let accent = '#4f7dff'
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      if (v) accent = v
    } catch {}
    const t = dark
      ? { text: '#e4e4e7', page: '#18181b', sub: '#27272a', border: '#3f3f46', sel: 'rgba(79,125,255,0.35)' }
      : { text: '#1f2937', page: '#ffffff', sub: '#f3f4f6', border: '#e5e7eb', sel: 'rgba(79,125,255,0.25)' }
    const css = [
      'html,body{background:' + t.page + ' !important;color:' + t.text + ' !important;}',
      '*,*::before,*::after{background-color:transparent !important;background-image:none !important;color:' + t.text + ' !important;border-color:' + t.border + ' !important;}',
      'a,a *{color:' + accent + ' !important;text-decoration-color:' + accent + ' !important;}',
      'pre,code,kbd,samp,blockquote{background:' + t.sub + ' !important;color:' + t.text + ' !important;border-color:' + t.border + ' !important;}',
      'table,th,td{border-color:' + t.border + ' !important;}',
      'hr{border:none;border-top:1px solid ' + t.border + ' !important;background:none !important;height:1px;}',
      'img,svg,video,canvas{background:none !important;}',
      '::selection{background:' + t.sel + ' !important;color:' + t.text + ' !important;}',
    ].join('\n')
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body>' + content + '</body></html>'
  }

  const plainText = isImage
    ? ''
    : isHtml
      ? displayContent.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : displayContent.trim()
  const filePaths = isFiles ? parseFilePaths(item.content) : []
  /** 图片 OCR 文字提取（tesseract.js 按需加载，中文+英文） */
  /** OCR 引擎按需加载：首次使用时从 CDN 拉取并缓存（不随安装包分发，减小体积） */
  async function loadTesseractEngine(): Promise<any> {
    const w = window as any
    if (w.Tesseract) return w.Tesseract
    await new Promise<void>((resolve, reject) => {
      const sc = document.createElement('script')
      sc.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
      sc.onload = () => resolve()
      sc.onerror = () => reject(new Error('OCR 引擎加载失败（首次使用需联网）'))
      document.head.appendChild(sc)
    })
    if (!w.Tesseract) throw new Error('OCR 引擎加载失败')
    return w.Tesseract
  }

  const runOcr = async () => {
    if (ocrBusy) return
    const src = imageContent || item.content
    if (!src) return
    setOcrBusy(true)
    try {
      setOcrStage(tr('detail.ocrLoading'))
      const Tesseract = await loadTesseractEngine()
      const worker = await Tesseract.createWorker(['chi_sim', 'eng'], 1, {
        logger: (m: { status?: string; progress?: number }) => {
          if (m.status === 'loading tesseract core') setOcrStage(tr('detail.ocrLoading'))
          else if ((m.progress ?? 0) > 0) setOcrStage(`${Math.round((m.progress ?? 0) * 100)}%`)
        },
      })
      const { data } = await worker.recognize(src)
      await worker.terminate()
      const text = (data.text ?? '').replace(/\n{3,}/g, '\n\n').trim()
      if (!text) {
        onToast?.(tr('detail.ocrEmpty'))
        return
      }
      const res = await window.electronAPI.insertItem({
        type: 'text', content: text,
        preview: [...text].slice(0, 100).join('') + ([...text].length > 100 ? '...' : ''),
        charCount: text.length, storageSize: new TextEncoder().encode(text).length,
        createdAt: new Date().toLocaleString('sv-SE').replace('T', ' ').slice(0, 19),
      })
      onToast?.(tr('detail.ocrDone'))
      void res
    } catch (err: any) {
      onToast?.(tr('detail.ocrFailed', { error: err?.message ?? String(err) }))
    } finally {
      setOcrBusy(false)
      setOcrStage('')
    }
  }

  /** 文本/链接转存为 .txt 文件写入剪贴板 */
  const saveAsFile = async () => {
    if (!plainText) return
    const name = (item.alias || item.preview || 'snippet').replace(/\.[a-z0-9]{1,5}$/i, '')
    const res = await window.electronAPI.writeTextAsFile(plainText, name)
    if (res.success) onToast?.(tr('detail.savedAsFile', { name: res.path?.split(/[/\\]/).pop() ?? '' }))
    else onToast?.(res.error || 'error')
  }


  return (
    <div className="h-full flex flex-col bg-transparent">
      {/* Top info bar */}
      <div className="flex-shrink-0 h-10 flex items-center px-4 gap-3">
        <div className="flex items-center gap-1.5">
          {typeIcon(item.type)}
          <span className="text-xs text-zinc-600 dark:text-zinc-400">{getTypeLabel(item.type)}</span>
        </div>

        {item.is_pinned && (
          <Pin className="w-3 h-3 text-amber-500 flex-shrink-0" />
        )}

        {!isImage && item.char_count > 0 && (
          <>
            <span className="text-zinc-300 dark:text-zinc-700 text-xs">·</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-500">{item.char_count} {tr('detail.chars')}</span>
          </>
        )}

        <span className="text-zinc-300 dark:text-zinc-700 text-xs">·</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-500">{formatStorageSize(item.storage_size)}</span>

        <span className="text-zinc-300 dark:text-zinc-700 text-xs">·</span>
        <div className="flex items-center gap-1">
          <Monitor className="w-3 h-3 text-zinc-400 dark:text-zinc-600" />
          <span className="text-xs text-zinc-500 dark:text-zinc-500">{tr('detail.source')}</span>
        </div>
      </div>

      {/* ── Alias row ── */}
      {!isImage && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 pb-1">
          {isEditingAlias ? (
            <input
              ref={aliasInputRef}
              type="text"
              value={aliasDraft}
              onChange={(e) => setAliasDraft(e.target.value)}
              onBlur={saveAlias}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); saveAlias() }
                if (e.key === 'Escape') { e.preventDefault(); cancelAlias() }
              }}
              placeholder={tr('detail.aliasPlaceholder')}
              className="text-xs bg-transparent border-b border-blue-500 text-zinc-700 dark:text-zinc-300 outline-none w-48 py-0.5 transition-colors"
            />
          ) : (
            <button
              onClick={startEditAlias}
              className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 border-b border-dashed border-zinc-300 dark:border-zinc-700 py-0.5 transition-colors max-w-[200px] truncate text-left"
              title={tr('detail.aliasPlaceholder')}
            >
              {item.alias || tr('detail.aliasPlaceholder')}
            </button>
          )}
          {item.is_sensitive && (
            <span className="flex items-center gap-0.5 text-[10px] text-rose-500 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 px-1.5 py-0.5 rounded">
              <Shield className="w-2.5 h-2.5" />
              {tr('detail.sensitive')}
            </span>
          )}
        </div>
      )}

      {/* ── Tag row ── */}
      {!isImage && (
        <div className="flex-shrink-0 flex items-center gap-1.5 px-4 pb-2 flex-wrap">
          {item.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] text-zinc-600 dark:text-zinc-400"
            >
              {tag}
              <button
                onClick={() => handleRemoveTag(tag)}
                className="hover:text-red-500 transition-colors"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
          {showTagInput ? (
            <input
              ref={tagInputRef}
              type="text"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onBlur={() => { handleAddTag() }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleAddTag() }
                if (e.key === 'Escape') { e.preventDefault(); setShowTagInput(false); setTagDraft('') }
              }}
              placeholder={tr('detail.tagPlaceholder')}
              className="w-24 h-5 text-[10px] bg-transparent border-b border-blue-500 text-zinc-600 dark:text-zinc-400 outline-none"
            />
          ) : (
            <button
              onClick={() => setShowTagInput(true)}
              className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              title={tr('detail.addTag')}
            >
              <Plus className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Main content */}
      <div className={`flex-1 overflow-auto ${density === 'compact' ? 'p-3' : 'p-5'}`}>
        {isImage ? (
          imageContent || item.content ? (
            <div className="flex items-center justify-center min-h-full">
              <img
                src={imageContent || item.content}
                alt={item.preview}
                onDoubleClick={openLightbox}
                className="max-w-full max-h-full object-contain rounded-lg cursor-zoom-in"
                style={{ imageRendering: 'auto' }}
                title={tr('detail.dblClickZoom')}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="bg-zinc-100 dark:bg-zinc-900 rounded-lg p-8 text-center">
                <Image className="w-12 h-12 text-zinc-300 dark:text-zinc-600 mx-auto mb-2" />
                <p className="text-sm text-zinc-400 dark:text-zinc-500">{tr('detail.noPreview')}</p>
              </div>
            </div>
          )
        ) : isHtml ? (
          // 富文本预览：sandbox 隔离渲染，防止脚本注入
          <div className="h-full rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-white dark:bg-zinc-900">
            {isSensitive && !showSensitive ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <EyeOff className="w-8 h-8 text-zinc-400 dark:text-zinc-500 mx-auto mb-2" />
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">{tr('detail.sensitive')}</p>
                  <button
                    onClick={() => setShowSensitive(true)}
                    className="text-xs text-[var(--accent)] hover:underline"
                  >
                    {tr('detail.showSensitive')}
                  </button>
                </div>
              </div>
            ) : (
              <iframe
                title="rich-text-preview"
                sandbox=""
                srcDoc={buildHtmlPreviewDoc(displayContent)}
                className="w-full h-full bg-white dark:bg-zinc-900"
              />
            )}
          </div>
        ) : isFiles ? (
          // 文件列表：点击打开（标记为敏感时先遮挡）
          isSensitive && !showSensitive ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <EyeOff className="w-8 h-8 text-zinc-400 dark:text-zinc-500 mx-auto mb-2" />
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">{tr('detail.sensitive')}</p>
                <button
                  onClick={() => setShowSensitive(true)}
                  className="text-xs text-[var(--accent)] hover:underline"
                >
                  {tr('detail.showSensitive')}
                </button>
              </div>
            </div>
          ) : (
          <div className="space-y-1.5">
            <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mb-2 flex items-center gap-1">
              <FolderOpen className="w-3 h-3" />
              {tr('detail.filesCount', { n: filePaths.length })} · {tr('detail.filesHint')}
            </p>
            {filePaths.map((p) => (
              <button
                key={p}
                onClick={() => onOpenFile(p)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/60 text-left transition-colors group"
                title={p}
              >
                <FolderOpen className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                <span className="flex-1 min-w-0 truncate text-xs text-zinc-700 dark:text-zinc-300">
                  {basename(p)}
                </span>
                <span className="text-[10px] text-zinc-400 dark:text-zinc-600 truncate max-w-[180px] hidden sm:block">
                  {p}
                </span>
                <ExternalLink className="w-3 h-3 text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-500 dark:group-hover:text-zinc-400 flex-shrink-0" />
              </button>
            ))}
          </div>
          )
        ) : isEditing ? (
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
              if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit() }
            }}
            className={`w-full h-full min-h-[200px] p-3 bg-zinc-50 dark:bg-zinc-900 border border-blue-500/50 rounded-lg text-sm text-zinc-800 dark:text-zinc-200 font-normal antialiased leading-7 resize-none outline-none focus:border-blue-500 transition-colors ${monoClass}`}
            spellCheck={false}
          />
        ) : (
          <div className="relative">
            {/* Sensitive overlay */}
            {isSensitive && !showSensitive && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-50/80 dark:bg-zinc-900/80 rounded-lg backdrop-blur-[2px]">
                <div className="text-center">
                  <EyeOff className="w-8 h-8 text-zinc-400 dark:text-zinc-500 mx-auto mb-2" />
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">{tr('detail.sensitive')}</p>
                  <button
                    onClick={() => setShowSensitive(true)}
                    className="text-xs text-[var(--accent)] hover:underline"
                  >
                    {tr('detail.showSensitive')}
                  </button>
                </div>
              </div>
            )}
            <pre
              onDoubleClick={enterEditMode}
              className={`text-sm text-zinc-800 dark:text-zinc-200 font-normal antialiased whitespace-pre-wrap break-words leading-7 select-text cursor-text hover:bg-zinc-50 dark:hover:bg-zinc-900/50 rounded-lg p-1 -m-1 transition-colors ${monoClass}`}
              title={tr('detail.dblClickEdit')}
            >
              {displayContent}
            </pre>
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="flex-shrink-0 h-12 flex items-center justify-end gap-2 px-4">
        {item.type === 'url' && (
          <button
            onClick={() => onOpenUrl(item.content)}
            className="flex items-center gap-1.5 h-7 px-3 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs text-zinc-600 dark:text-zinc-300 transition-colors"
            title={tr('detail.openUrl')}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>{tr('detail.openUrl')}</span>
          </button>
        )}

        {(item.type === 'text' || item.type === 'url' || item.type === 'html') && plainText.length > 0 && plainText.length <= 2500 && (
          <button
            onClick={() => setQrOpen(true)}
            className="flex items-center gap-1.5 h-7 px-3 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs text-zinc-600 dark:text-zinc-300 transition-colors"
            title={tr('detail.qr')}
          >
            <QrCode className="w-3.5 h-3.5" />
          </button>
        )}

        {isImage && (
          <button
            onClick={() => void runOcr()}
            disabled={ocrBusy}
            className="flex items-center gap-1.5 h-7 px-3 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 text-xs text-zinc-600 dark:text-zinc-300 transition-colors"
            title={tr('detail.ocr')}
          >
            {ocrBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanText className="w-3.5 h-3.5" />}
            {ocrBusy && ocrStage && <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{ocrStage}</span>}
          </button>
        )}

        {!isImage && plainText.length > 0 && (
          <button
            onClick={() => void saveAsFile()}
            className="flex items-center gap-1.5 h-7 px-3 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs text-zinc-600 dark:text-zinc-300 transition-colors"
            title={tr('detail.saveAsFile')}
          >
            <FileDown className="w-3.5 h-3.5" />
          </button>
        )}

        <button
          onClick={() => onCopy(item)}
          className="flex items-center gap-1.5 h-7 px-3 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs text-zinc-600 dark:text-zinc-300 transition-colors"
        >
          <Copy className="w-3.5 h-3.5" />
          <span>{tr('detail.copy')}</span>
        </button>

        {/* Pin / Unpin button */}
        <button
          onClick={() => onTogglePin(item.id)}
          className={`flex items-center gap-1.5 h-7 px-3 rounded-md text-xs transition-colors ${
            item.is_pinned
              ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50'
              : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400'
          }`}
        >
          <Pin className={`w-3.5 h-3.5 ${item.is_pinned ? 'fill-current' : ''}`} />
          <span>{item.is_pinned ? tr('detail.unpin') : tr('detail.pin')}</span>
        </button>

        {/* Mark sensitive button */}
        {!isImage && (
          <button
            onClick={() => onToggleSensitive(item.id)}
            className={`flex items-center gap-1.5 h-7 px-3 rounded-md text-xs transition-colors ${
              item.is_sensitive
                ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 hover:bg-rose-200 dark:hover:bg-rose-900/50'
                : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400'
            }`}
            title={item.is_sensitive ? tr('detail.unmarkSensitive') : tr('detail.markSensitive')}
          >
            <Shield className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Sensitive toggle — only shown when content is sensitive */}
        {isSensitive && (
          <button
            onClick={() => setShowSensitive(!showSensitive)}
            className={`flex items-center gap-1.5 h-7 px-2 rounded-md text-xs transition-colors ${
              showSensitive
                ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
            } hover:bg-zinc-200 dark:hover:bg-zinc-700`}
            title={showSensitive ? tr('detail.hideSensitive') : tr('detail.showSensitive')}
          >
            {showSensitive ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        )}

        <button
          onClick={() => onDelete(item.id)}
          className={`flex items-center gap-1.5 h-7 px-3 rounded-md text-xs transition-colors ${
            confirmingDelete
              ? 'bg-red-600 text-white hover:bg-red-700 shadow-sm'
              : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-red-100 dark:hover:bg-red-900/50 hover:text-red-600 dark:hover:text-red-400 text-zinc-500 dark:text-zinc-400'
          }`}
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>{confirmingDelete ? tr('detail.confirmDelete') : tr('detail.delete')}</span>
        </button>
      </div>

      {/* Lightbox overlay — always dark */}
      {lightboxOpen && (imageContent || item.content) && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm overflow-hidden"
          onWheel={handleWheel}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeLightbox()
          }}
        >
          <div className="absolute top-0 left-0 right-0 h-12 flex items-center justify-between px-4 z-10 pointer-events-none">
            <div className="flex items-center gap-1.5 text-xs text-zinc-400 pointer-events-auto">
              <ZoomIn className="w-3.5 h-3.5" />
              <span>{tr('detail.zoomHint')}</span>
              <span className="text-zinc-600">·</span>
              <span>{tr('detail.dragHint')}</span>
              <span className="text-zinc-600">·</span>
              <span>{tr('detail.dblClickReset')}</span>
              <span className="text-zinc-600">·</span>
              <span>{Math.round(scale * 100)}%</span>
            </div>

            <div className="flex items-center gap-2 pointer-events-auto">
              <button
                onClick={() => { setScale(1); setPos({ x: 0, y: 0 }) }}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-zinc-400 hover:text-zinc-200 transition-colors"
                title="重置"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={closeLightbox}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <img
            src={imageContent || item.content}
            alt={item.preview}
            onMouseDown={(e) => {
              e.stopPropagation()
              handleMouseDown(e)
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              handleImageDoubleClick()
            }}
            draggable={false}
            className="absolute rounded-lg shadow-2xl select-none"
            style={{
              imageRendering: 'auto',
              maxWidth: '90vw',
              maxHeight: '90vh',
              objectFit: 'contain',
              top: '50%',
              left: '50%',
              transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px)) scale(${scale})`,
              transformOrigin: 'center center',
              cursor: isDragging ? 'grabbing' : scale > 1 ? 'grab' : 'zoom-in',
            }}
          />
        </div>
      )}
      {/* ── 二维码分享弹窗 ── */}
      {qrOpen && (
        <div
          className="fixed inset-0 z-[999] bg-black/50 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setQrOpen(false)}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl p-6 flex flex-col items-center gap-4 max-w-[320px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{tr('detail.qr')}</div>
            <div className="rounded-xl bg-white p-3 border border-zinc-200 dark:border-zinc-700">
              <QRCodeCanvas value={plainText.slice(0, 2500)} size={240} />
            </div>
            <div className="text-[11px] text-zinc-400 dark:text-zinc-500 text-center break-all line-clamp-2">
              {plainText.slice(0, 120)}{plainText.length > 120 ? '…' : ''}
            </div>
            <button
              className="h-8 px-5 rounded-md text-xs text-white"
              style={{ background: 'var(--accent)' }}
              onClick={() => setQrOpen(false)}
            >
              {tr('detail.close')}
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
