import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { ClipboardItem } from '../types'
import { readHistoryContent } from '../lib/history-memory'
import { formatStorageSize, getTypeLabel, maskSensitive, parseFilePaths, basename } from '../lib/utils'
import { ShortcutAction } from '../lib/shortcuts'
import { FileText, Link, Image, Copy, Trash2, Monitor, X, ZoomIn, RotateCcw, Pin, Eye, EyeOff, Shield, Plus, ExternalLink, FolderOpen, FileCode2, QrCode, ScanText, FileDown, Loader2, RemoveFormatting, BookPlus, Clock, Braces, Palette, ChevronsUpDown } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import { tr } from '../i18n'
import OcrRegionSelector from './OcrRegionSelector'
import OcrResultPanel from './OcrResultPanel'
import JsonTreeView from './JsonTreeView'
import { inspectClipboardText } from '../lib/smart-inspect'
import { canSaveOcrResult, createOcrWorkerSession, cropImageForOcr, invalidateOcrTask, isValidOcrRegion, mapViewportOcrRegionToImage, normalizeOcrText, ocrActionErrorMessage, ocrErrorMessage, openOcrSelection, shouldApplyOcrResult, type OcrRegion } from '../lib/ocr'
import { appendRichTextPasteValue, appendTextContextPasteValue, getTextContextCopyValue, insertTextAtSelection, supportsTextContextMenu } from '../lib/text-context-menu'
import { buildHtmlPreviewDoc, getHtmlPreviewFrameKey, isHtmlPreviewReady } from '../lib/html-preview'

interface DetailViewProps {
  item: ClipboardItem | null
  density?: 'comfortable' | 'compact'
  onCopy: (item: ClipboardItem) => void
  onCopyPlainText?: (item: ClipboardItem) => void
  onSaveToFloral?: (item: ClipboardItem, mode: 'new' | 'append', overrideText?: string) => Promise<void>
  onUpdateOcrText?: (id: number, ocrText: string) => Promise<void>
  onFilterBySource?: (source: string) => void
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
  onCopyPlainText,
  onSaveToFloral,
  onUpdateOcrText,
  onFilterBySource,
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
  const [floralMenuOpen, setFloralMenuOpen] = useState(false)
  const [savingToFloral, setSavingToFloral] = useState(false)
  const floralMenuRef = useRef<HTMLDivElement>(null)
  const [jsonViewMode, setJsonViewMode] = useState<'tree' | 'raw'>('tree')
  const [jsonExpandSignal, setJsonExpandSignal] = useState<{ expanded: boolean; version: number } | undefined>(undefined)
  const monoClass = monospace ? 'font-mono' : 'font-sans'
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef({ startX: 0, startY: 0, posX: 0, posY: 0 })

  // Edit mode for text
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const htmlPreviewRef = useRef<HTMLIFrameElement>(null)
  const [textContextMenu, setTextContextMenu] = useState<{ x: number; y: number; selection: string; editing: boolean; selectionStart: number; selectionEnd: number } | null>(null)

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
  const [ocrSelecting, setOcrSelecting] = useState(false)
  const [ocrRegion, setOcrRegion] = useState<OcrRegion | null>(null)
  const [ocrCropRegion, setOcrCropRegion] = useState<OcrRegion | null>(null)
  const [ocrImageLayout, setOcrImageLayout] = useState<{ naturalWidth: number; naturalHeight: number; displayedWidth: number; displayedHeight: number } | null>(null)
  const [ocrResult, setOcrResult] = useState('')
  const [ocrError, setOcrError] = useState<string | null>(null)
  const [ocrActionError, setOcrActionError] = useState<string | null>(null)
  const ocrTaskIdRef = useRef(0)
  const currentItemIdRef = useRef<number | null>(item?.id ?? null)
  const [ocrSession] = useState(() => createOcrWorkerSession(async (reportProgress) => {
    const [Tesseract, config] = await Promise.all([
      import('tesseract.js'),
      window.electronAPI.getOcrConfig(),
    ])
    return Tesseract.createWorker(['chi_sim', 'eng'], Tesseract.OEM.LSTM_ONLY, {
      langPath: config.langPath,
      workerPath: config.workerPath,
      corePath: config.corePath,
      cacheMethod: 'none',
      logger: (message) => reportProgress(message.progress ?? 0),
    })
  }))

  // 选中图片记录时加载完整图片内容
  useEffect(() => {
    setImageContent('')
    if (!item || item.type !== 'image') return
    if (typeof window === 'undefined' || !window.electronAPI) return
    let request = 0
    const refresh = () => {
      const current = ++request
      if (document.hidden) { setImageContent(''); return }
      void window.electronAPI.getItemContent(item.id).then((content) => {
        if (request === current) setImageContent(content)
      }).catch(() => { if (request === current) setImageContent('') })
    }
    refresh()
    document.addEventListener('visibilitychange', refresh)
    return () => { request++; document.removeEventListener('visibilitychange', refresh) }
  }, [item?.id, item?.type])

  // Reset edit modes when item changes
  useEffect(() => {
    ocrTaskIdRef.current = invalidateOcrTask(ocrTaskIdRef.current)
    ocrSession.cancelActive()
    currentItemIdRef.current = item?.id ?? null
    setIsEditing(false)
    setEditContent('')
    setIsEditingAlias(false)
    setShowTagInput(false)
    setShowSensitive(false)
    setOcrSelecting(false)
    setOcrRegion(null)
    setOcrCropRegion(null)
    setOcrImageLayout(null)
    setOcrResult('')
    setOcrError(null)
    setOcrActionError(null)
    setOcrBusy(false)
    setOcrStage('')
    setFloralMenuOpen(false)
    setJsonViewMode('tree')
    setJsonExpandSignal(undefined)
  }, [item?.id, ocrSession])

  useEffect(() => {
    if (!floralMenuOpen) return
    const handleOutside = (event: MouseEvent) => {
      if (floralMenuRef.current && !floralMenuRef.current.contains(event.target as Node)) {
        setFloralMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [floralMenuOpen])

  useEffect(() => {
    if (!isEditing) setEditContent('')
  }, [isEditing])

  useEffect(() => {
    if (!ocrRegion || !ocrImageLayout) return
    setOcrCropRegion(mapViewportOcrRegionToImage(
      ocrRegion,
      { width: ocrImageLayout.naturalWidth, height: ocrImageLayout.naturalHeight },
      { width: ocrImageLayout.displayedWidth, height: ocrImageLayout.displayedHeight },
      scale,
      pos,
    ))
  }, [ocrRegion, ocrImageLayout, scale, pos])

  useEffect(() => () => {
    ocrTaskIdRef.current = invalidateOcrTask(ocrTaskIdRef.current)
    ocrSession.dispose()
  }, [ocrSession])

  // Auto-focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
    }
  }, [isEditing])

  useEffect(() => {
    if (!textContextMenu) return
    const close = () => setTextContextMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [textContextMenu])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== htmlPreviewRef.current?.contentWindow || event.data?.type !== 'qpaste-html-context-menu') return
      const rect = htmlPreviewRef.current.getBoundingClientRect()
      setTextContextMenu({
        x: rect.left + event.data.x,
        y: rect.top + event.data.y,
        selection: event.data.selection || '',
        editing: false,
        selectionStart: 0,
        selectionEnd: 0,
      })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

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

  async function enterEditMode() {
    if (!item || item.type === 'image' || item.type === 'html' || item.type === 'files') return
    try {
      const content = isElectron ? await readHistoryContent(item, window.electronAPI.getItemContent) : item.content
      if (currentItemIdRef.current !== item.id) return
      setEditContent(content)
      setIsEditing(true)
    } catch { onToast?.('读取正文失败，请重试') }
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

  async function copyTextContext() {
    if (!item || !textContextMenu) return
    try {
      const fullContent = textContextMenu.editing ? editContent : await readHistoryContent(item, window.electronAPI.getItemContent)
      const source = !textContextMenu.editing && item.type === 'html'
        ? (item.is_sensitive && !showSensitive ? maskSensitive(fullContent) : fullContent)
          .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        : fullContent
      const content = getTextContextCopyValue(source, textContextMenu.selection)
      await window.electronAPI.writeText(content)
      onToast?.('已复制文本')
    } catch {
      onToast?.('复制失败，请重试')
    }
    setTextContextMenu(null)
  }

  async function pasteTextContext() {
    if (!item) return
    try {
      const content = await readHistoryContent(item, window.electronAPI.getItemContent)
      const pasted = await window.electronAPI.readText()
      if (currentItemIdRef.current !== item.id) return
      if (!pasted) {
        onToast?.('剪贴板中没有文本')
        setTextContextMenu(null)
        return
      }
      if (item.type === 'html') {
        onUpdate(item.id, appendRichTextPasteValue(content, pasted))
        onToast?.('已粘贴到富文本')
      } else if (textContextMenu?.editing) {
        const next = insertTextAtSelection(editContent, pasted, textContextMenu.selectionStart, textContextMenu.selectionEnd)
        setEditContent(next.value)
        requestAnimationFrame(() => textareaRef.current?.setSelectionRange(next.cursor, next.cursor))
      } else {
        setEditContent(appendTextContextPasteValue(content, pasted))
        setIsEditing(true)
      }
    } catch {
      onToast?.('粘贴失败，请重试')
    }
    setTextContextMenu(null)
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

  const startOcrSelection = () => {
    const next = openOcrSelection()
    setOcrSelecting(next.selecting)
    setScale(1)
    setPos({ x: 0, y: 0 })
    setLightboxOpen(next.lightboxOpen)
    setOcrError(null)
  }

  const closeOcrSelection = () => {
    setOcrSelecting(false)
    closeLightbox()
  }

  useEffect(() => {
    if (!lightboxOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (ocrSelecting) closeOcrSelection()
        else closeLightbox()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightboxOpen, ocrSelecting, closeLightbox])

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

  const smartInspection = useMemo(() => {
    if (!item || item.type === 'image' || item.type === 'html' || item.type === 'files') return null
    if (item.is_sensitive && !showSensitive) return null
    return inspectClipboardText(item.content)
  }, [item?.id, item?.type, item?.content, item?.is_sensitive, showSensitive])

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
  const htmlPreviewReady = isHtml && isHtmlPreviewReady(item)
  const htmlPreviewDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  let htmlPreviewAccent = '#4f7dff'
  if (typeof document !== 'undefined') {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      if (v) htmlPreviewAccent = v
    } catch {}
  }
  const htmlPreviewDoc = htmlPreviewReady
    ? buildHtmlPreviewDoc(displayContent, {
        dark: htmlPreviewDark,
        accent: htmlPreviewAccent,
        fallbackText: item.preview,
      })
    : ''
  const htmlPreviewKey = htmlPreviewReady
    ? getHtmlPreviewFrameKey(item.id, htmlPreviewDark, htmlPreviewDoc)
    : ''

  const plainText = isImage
    ? ''
    : isHtml
      ? displayContent.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : displayContent.trim()
  const filePaths = isFiles ? parseFilePaths(item.content) : []
  const runOcr = async () => {
    if (ocrBusy) return
    const src = imageContent || item.content
    if (!src || !item || !ocrCropRegion || !isValidOcrRegion(ocrCropRegion)) {
      setOcrError('请将选区移动到图片文字上后重试')
      return
    }
    const taskId = ++ocrTaskIdRef.current
    const itemId = item.id
    const isCurrent = () => shouldApplyOcrResult({ startedItemId: itemId, currentItemId: currentItemIdRef.current ?? -1, startedTaskId: taskId, currentTaskId: ocrTaskIdRef.current })
    setOcrBusy(true)
    setOcrError(null)
    setOcrActionError(null)
    try {
      setOcrStage('正在准备本地 OCR…')
      const cropped = await cropImageForOcr(src, ocrCropRegion)
      if (!isCurrent()) return
      const result = await ocrSession.recognize(cropped, (progress) => {
        if (isCurrent()) setOcrStage(progress > 0 ? `正在识别 ${Math.round(progress * 100)}%` : '正在初始化 OCR…')
      })
      if (!isCurrent()) return
      const text = normalizeOcrText(result ?? '')
      if (!text) {
        setOcrError('未识别到文字，请调整选区后重试')
        return
      }
      setOcrResult(text)
      if (onUpdateOcrText) {
        void onUpdateOcrText(itemId, text).then(() => {
          if (isCurrent()) onToast?.(tr('toast.ocrIndexed'))
        }).catch(() => {})
      }
    } catch (error) {
      if (isCurrent()) setOcrError(ocrErrorMessage(error))
    } finally {
      if (isCurrent()) {
        setOcrBusy(false)
        setOcrStage('')
      }
    }
  }

  const updateOcrIndex = async () => {
    if (!item || !canSaveOcrResult(ocrResult) || !onUpdateOcrText) return
    const content = normalizeOcrText(ocrResult)
    try {
      await onUpdateOcrText(item.id, content)
      setOcrActionError(null)
      onToast?.(tr('toast.ocrIndexed'))
    } catch {
      setOcrActionError(ocrActionErrorMessage('save'))
    }
  }

  const copySmartText = async (value: string, label?: string) => {
    if (!value) return
    try {
      if (isElectron) await window.electronAPI.writeText(value)
      else if (navigator.clipboard) await navigator.clipboard.writeText(value)
      onToast?.(tr('smart.copiedValue', { value: label || (value.length > 36 ? value.slice(0, 36) + '…' : value) }))
    } catch {
      onToast?.('复制失败，请重试')
    }
  }

  const copyOcrResult = async () => {
    if (!canSaveOcrResult(ocrResult)) return
    try {
      await window.electronAPI.writeText(ocrResult)
      setOcrActionError(null)
      onToast?.('已复制 OCR 结果')
    } catch {
      setOcrActionError(ocrActionErrorMessage('copy'))
    }
  }

  const saveOcrResult = async () => {
    if (!canSaveOcrResult(ocrResult)) {
      setOcrError('未识别到文字，请调整选区后重试')
      return
    }
    const content = normalizeOcrText(ocrResult)
    try {
      await window.electronAPI.insertItem({
        type: 'text',
        content,
        preview: [...content].slice(0, 100).join('') + ([...content].length > 100 ? '...' : ''),
        charCount: content.length,
        storageSize: new TextEncoder().encode(content).length,
        createdAt: new Date().toLocaleString('sv-SE').replace('T', ' ').slice(0, 19),
        sourceApp: item.source_app || 'OCR',
      })
      setOcrActionError(null)
      setOcrResult('')
      setOcrSelecting(false)
      onToast?.('OCR 结果已保存到历史记录')
    } catch {
      setOcrActionError(ocrActionErrorMessage('save'))
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
          <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200">{getTypeLabel(item.type)}</span>
        </div>

        {item.is_pinned && (
          <Pin className="w-3 h-3 text-amber-500 flex-shrink-0" />
        )}

        {!isImage && item.char_count > 0 && (
          <>
            <span className="text-zinc-300 dark:text-zinc-600 text-xs">·</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{item.char_count} {tr('detail.chars')}</span>
          </>
        )}

        <span className="text-zinc-300 dark:text-zinc-600 text-xs">·</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{formatStorageSize(item.storage_size)}</span>

        <span className="text-zinc-300 dark:text-zinc-600 text-xs">·</span>
        {item.source_app && onFilterBySource ? (
          <button
            type="button"
            data-testid="detail-source-app"
            onClick={() => onFilterBySource(item.source_app!)}
            title={tr('detail.filterBySource', { source: item.source_app })}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 -mx-1 rounded-md text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-[var(--accent)] transition-colors max-w-[180px]"
          >
            <Monitor className="w-3 h-3 text-zinc-400 dark:text-zinc-400 flex-shrink-0" />
            <span className="truncate">{item.source_app}</span>
          </button>
        ) : (
          <div data-testid="detail-source-app" className="flex items-center gap-1 max-w-[180px]">
            <Monitor className="w-3 h-3 text-zinc-400 dark:text-zinc-400 flex-shrink-0" />
            <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{item.source_app || tr('detail.source')}</span>
          </div>
        )}
      </div>

      {/* ── Alias row ── */}
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
              className="text-xs bg-transparent border-b border-blue-500 text-zinc-700 dark:text-zinc-200 outline-none w-48 py-0.5 transition-colors"
            />
          ) : (
            <button
              onClick={startEditAlias}
              className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 border-b border-dashed border-zinc-400 dark:border-zinc-600 py-0.5 transition-colors max-w-[200px] truncate text-left"
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

      {/* ── Tag row ── */}
      {!isImage && (
        <div className="flex-shrink-0 flex items-center gap-1.5 px-4 pb-2 flex-wrap">
          {item.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/80 text-[10px] text-zinc-700 dark:text-zinc-300"
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
              className="w-24 h-5 text-[10px] bg-transparent border-b border-blue-500 text-zinc-600 dark:text-zinc-300 outline-none"
            />
          ) : (
            <button
              onClick={() => setShowTagInput(true)}
              className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/80 text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
              title={tr('detail.addTag')}
            >
              <Plus className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Main content */}
      <div className={`flex-1 overflow-auto border-t qp-divider ${density === 'compact' ? 'p-3' : 'p-5'}`}>
        {isImage && (ocrResult || ocrError) && (
          <OcrResultPanel
            value={ocrResult}
            busy={ocrBusy}
            error={ocrError}
            notice={ocrActionError}
            indexed={Boolean(item.ocr_text && item.ocr_text.trim() === normalizeOcrText(ocrResult))}
            onChange={(value) => { setOcrResult(value); setOcrActionError(null) }}
            onCopy={() => { void copyOcrResult() }}
            onSave={saveOcrResult}
            onSaveToIndex={onUpdateOcrText ? updateOcrIndex : undefined}
            onSaveToFloral={onSaveToFloral ? async () => {
              if (!canSaveOcrResult(ocrResult)) return
              const content = normalizeOcrText(ocrResult)
              await onSaveToFloral({ ...item, type: 'text', content, preview: content.slice(0, 100) }, 'new', content)
            } : undefined}
            onRetry={() => { setOcrError(null); void runOcr() }}
            onClose={() => { setOcrResult(''); setOcrError(null); setOcrActionError(null) }}
          />
        )}
        {isImage && !ocrResult && !ocrError && item.ocr_text && (
          <div
            data-testid="indexed-ocr-banner"
            className="mb-3 rounded-lg border border-emerald-200/80 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/30 px-3 py-2 flex items-start gap-2.5"
          >
            <ScanText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
                {tr('detail.ocrIndexed')}
              </div>
              <p className="text-xs text-zinc-700 dark:text-zinc-300 line-clamp-2 whitespace-pre-wrap break-words mt-0.5">
                {item.ocr_text}
              </p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={() => { void copySmartText(item.ocr_text || '', 'OCR 文字') }}
                className="h-6 px-2 rounded bg-white/90 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[11px] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              >
                {tr('detail.copy')}
              </button>
              <button
                type="button"
                onClick={() => setOcrResult(item.ocr_text || '')}
                className="h-6 px-2 rounded bg-white/90 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[11px] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              >
                展开
              </button>
            </div>
          </div>
        )}
        {isImage ? (
          imageContent || item.content ? (
            <div className="flex items-center justify-center min-h-full">
              <img
                src={imageContent || item.content}
                alt={item.preview}
                onDoubleClick={openLightbox}
                className="max-w-full max-h-full object-contain rounded-lg cursor-zoom-in ring-1 ring-zinc-200 shadow-[0_2px_10px_-4px_rgba(15,23,42,0.18)] dark:ring-zinc-700/70 dark:shadow-[0_6px_20px_-6px_rgba(0,0,0,0.45)]"
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
          // 富文本预览：sandbox 隔离渲染，防止脚本注入；等待正文加载完成再挂载，并按文档 key 重建 iframe，规避 Chromium/Electron 改写 srcDoc 竞态导致空白
          <div className="h-full rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-white dark:bg-[#1a1e26]">
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
            ) : !htmlPreviewReady ? (
              <div data-testid="html-preview-loading" className="w-full h-full bg-white dark:bg-[#1a1e26]" />
            ) : (
              <iframe
                key={htmlPreviewKey}
                ref={htmlPreviewRef}
                title="rich-text-preview"
                sandbox="allow-scripts"
                srcDoc={htmlPreviewDoc}
                className="w-full h-full border-0 bg-white dark:bg-[#1a1e26]"
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
            onContextMenu={(e) => {
              e.preventDefault()
              setTextContextMenu({
                x: e.clientX,
                y: e.clientY,
                selection: e.currentTarget.value.slice(e.currentTarget.selectionStart, e.currentTarget.selectionEnd),
                editing: true,
                selectionStart: e.currentTarget.selectionStart,
                selectionEnd: e.currentTarget.selectionEnd,
              })
            }}
            className={`w-full h-full min-h-[200px] p-3 bg-zinc-50 dark:bg-zinc-950/60 border border-blue-500/50 rounded-lg text-sm text-zinc-800 dark:text-zinc-100 font-normal antialiased leading-7 resize-none outline-none focus:border-blue-500 transition-colors ${monoClass}`}
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

            {/* Smart Inspector: Color swatch card */}
            {smartInspection?.color && (
              <div
                data-testid="smart-color-card"
                className="mb-3 rounded-xl border border-zinc-200 dark:border-zinc-700/80 bg-zinc-50/90 dark:bg-zinc-900/70 p-3 flex items-center gap-3.5"
              >
                <div
                  className="w-12 h-12 rounded-lg border border-black/15 dark:border-white/15 shadow-inner flex-shrink-0 flex items-center justify-center"
                  style={{ backgroundColor: smartInspection.color.cssColor }}
                  title={smartInspection.color.hex}
                >
                  <Palette className={`w-4 h-4 ${smartInspection.color.isDark ? 'text-white/80' : 'text-zinc-900/70'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                    {tr('smart.color')}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: 'HEX', val: smartInspection.color.hex },
                      { label: 'RGB', val: smartInspection.color.rgb },
                      { label: 'HSL', val: smartInspection.color.hsl },
                    ].map(({ label, val }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => { void copySmartText(val) }}
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-[var(--accent)] text-[11px] font-mono text-zinc-700 dark:text-zinc-200 transition-colors"
                      >
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{label}</span>
                        <span>{val}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Smart Inspector: Timestamp card */}
            {smartInspection?.timestamp && (
              <div
                data-testid="smart-timestamp-card"
                className="mb-3 rounded-xl border border-zinc-200 dark:border-zinc-700/80 bg-zinc-50/90 dark:bg-zinc-900/70 p-3"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                    <Clock className="w-3.5 h-3.5 text-[var(--accent)]" />
                    <span>{tr('smart.timestamp')}</span>
                    <span className="px-1.5 py-0.5 rounded bg-zinc-200/70 dark:bg-zinc-800 text-[10px] text-zinc-600 dark:text-zinc-300">
                      {smartInspection.timestamp.unit === 'ms' ? tr('smart.timestampUnitMs') : tr('smart.timestampUnitSec')}
                    </span>
                  </div>
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {smartInspection.timestamp.relative}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { void copySmartText(smartInspection.timestamp!.localFormatted) }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-[var(--accent)] text-xs font-mono font-medium text-zinc-800 dark:text-zinc-100 transition-colors"
                  >
                    <span>{smartInspection.timestamp.localFormatted}</span>
                    <Copy className="w-3 h-3 text-zinc-400" />
                  </button>
                  <button
                    type="button"
                    onClick={() => { void copySmartText(smartInspection.timestamp!.isoUtc) }}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-[var(--accent)] text-[11px] font-mono text-zinc-600 dark:text-zinc-300 transition-colors"
                  >
                    <span>{smartInspection.timestamp.isoUtc}</span>
                    <Copy className="w-3 h-3 text-zinc-400" />
                  </button>
                </div>
              </div>
            )}

            {/* Smart Inspector: JSON toolbar + collapsible tree */}
            {smartInspection?.json && (
              <div
                data-testid="smart-json-bar"
                className="mb-3 rounded-lg border border-zinc-200 dark:border-zinc-700/80 bg-zinc-50/90 dark:bg-zinc-900/70 px-3 py-2 flex flex-wrap items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                  <Braces className="w-3.5 h-3.5 text-[var(--accent)]" />
                  <span className="font-medium">{tr('smart.json')}</span>
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    {smartInspection.json.kind === 'array'
                      ? tr('smart.jsonArray', { n: smartInspection.json.entryCount })
                      : tr('smart.jsonObject', { n: smartInspection.json.entryCount })}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setJsonViewMode((m) => (m === 'tree' ? 'raw' : 'tree'))}
                    className="h-6 px-2 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-[var(--accent)] text-[11px] text-zinc-700 dark:text-zinc-200 transition-colors"
                  >
                    {jsonViewMode === 'tree' ? tr('smart.jsonRawView') : tr('smart.jsonTreeView')}
                  </button>
                  {jsonViewMode === 'tree' && (
                    <button
                      type="button"
                      onClick={() => setJsonExpandSignal((prev) => ({ expanded: !(prev?.expanded ?? true), version: (prev?.version ?? 0) + 1 }))}
                      className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-[var(--accent)] text-[11px] text-zinc-700 dark:text-zinc-200 transition-colors"
                    >
                      <ChevronsUpDown className="w-3 h-3" />
                      <span>{(jsonExpandSignal?.expanded ?? true) ? tr('smart.jsonCollapseAll') : tr('smart.jsonExpandAll')}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { void copySmartText(smartInspection.json!.formatted, tr('smart.jsonFormatCopy')) }}
                    className="h-6 px-2 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-[var(--accent)] text-[11px] text-zinc-700 dark:text-zinc-200 transition-colors"
                  >
                    {tr('smart.jsonFormatCopy')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { void copySmartText(smartInspection.json!.minified, tr('smart.jsonMinifyCopy')) }}
                    className="h-6 px-2 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-[var(--accent)] text-[11px] text-zinc-700 dark:text-zinc-200 transition-colors"
                  >
                    {tr('smart.jsonMinifyCopy')}
                  </button>
                </div>
              </div>
            )}

            {smartInspection?.json && jsonViewMode === 'tree' ? (
              <div onDoubleClick={enterEditMode} title={tr('detail.dblClickEdit')}>
                <JsonTreeView
                  data={smartInspection.json.parsed}
                  expandAllSignal={jsonExpandSignal}
                />
              </div>
            ) : (
              <pre
                onDoubleClick={enterEditMode}
                onContextMenu={(e) => {
                  if (!supportsTextContextMenu(item.type)) return
                  e.preventDefault()
                  setTextContextMenu({ x: e.clientX, y: e.clientY, selection: window.getSelection()?.toString() ?? '', editing: false, selectionStart: 0, selectionEnd: 0 })
                }}
                className={`text-sm text-zinc-800 dark:text-zinc-100 font-normal antialiased whitespace-pre-wrap break-words leading-7 select-text cursor-text hover:bg-zinc-50 dark:hover:bg-zinc-800/40 rounded-lg p-1 -m-1 transition-colors ${monoClass}`}
                title={tr('detail.dblClickEdit')}
              >
                {displayContent}
              </pre>
            )}
          </div>
        )}
      </div>

      {textContextMenu && supportsTextContextMenu(item.type) && (
        <div
          className="fixed z-50 min-w-28 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg text-xs text-zinc-700 dark:text-zinc-200"
          style={{ top: textContextMenu.y, left: textContextMenu.x }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { void copyTextContext() }} className="w-full px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700">复制</button>
          <button onClick={() => { void pasteTextContext() }} className="w-full px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700">粘贴</button>
        </div>
      )}

      {/* Bottom action bar */}
      <div className="flex-shrink-0 min-h-12 flex flex-wrap items-center justify-end gap-2 px-4 py-2 border-t qp-divider bg-zinc-50/80 dark:bg-zinc-950/35 [&>button]:shrink-0 [&>button]:whitespace-nowrap">
        {item.type === 'url' && (
          <button
            onClick={async () => {
              try {
                const content = isElectron ? await readHistoryContent(item, window.electronAPI.getItemContent) : item.content
                onOpenUrl(content)
              } catch { onToast?.('读取链接失败，请重试') }
            }}
            className="flex items-center gap-1.5 h-7 px-3 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/80 hover:bg-zinc-100 hover:border-zinc-300 dark:hover:bg-zinc-700 dark:hover:border-zinc-600 text-xs text-zinc-700 dark:text-zinc-200 transition-colors"
            title={tr('detail.openUrl')}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>{tr('detail.openUrl')}</span>
          </button>
        )}

        {(item.type === 'text' || item.type === 'url' || item.type === 'html') && plainText.length > 0 && plainText.length <= 2500 && (
          <button
            onClick={() => setQrOpen(true)}
            className="flex items-center gap-1.5 h-7 px-3 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/80 hover:bg-zinc-100 hover:border-zinc-300 dark:hover:bg-zinc-700 dark:hover:border-zinc-600 text-xs text-zinc-700 dark:text-zinc-200 transition-colors"
            title={tr('detail.qr')}
          >
            <QrCode className="w-3.5 h-3.5" />
          </button>
        )}

        {isImage && (
          <button
            onClick={startOcrSelection}
            disabled={ocrBusy}
            className="flex items-center gap-1.5 h-7 px-3 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/80 hover:bg-zinc-100 hover:border-zinc-300 dark:hover:bg-zinc-700 dark:hover:border-zinc-600 disabled:opacity-50 text-xs text-zinc-700 dark:text-zinc-200 transition-colors"
            title={tr('detail.ocr')}
          >
            {ocrBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanText className="w-3.5 h-3.5" />}
            {ocrBusy && ocrStage && <span className="text-[10px] text-zinc-400 dark:text-zinc-400">{ocrStage}</span>}
            {!ocrBusy && <span>{tr('detail.ocr')}</span>}
          </button>
        )}

        {!isImage && plainText.length > 0 && (
          <button
            onClick={() => void saveAsFile()}
            className="flex items-center gap-1.5 h-7 px-3 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/80 hover:bg-zinc-100 hover:border-zinc-300 dark:hover:bg-zinc-700 dark:hover:border-zinc-600 text-xs text-zinc-700 dark:text-zinc-200 transition-colors"
            title={tr('detail.saveAsFile')}
          >
            <FileDown className="w-3.5 h-3.5" />
          </button>
        )}

        {onSaveToFloral && (
          <div ref={floralMenuRef} className="relative">
            <button
              type="button"
              disabled={savingToFloral}
              onClick={() => setFloralMenuOpen((open) => !open)}
              className="flex items-center gap-1.5 h-7 px-3 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/80 hover:bg-zinc-100 hover:border-zinc-300 dark:hover:bg-zinc-700 dark:hover:border-zinc-600 disabled:opacity-50 text-xs text-zinc-700 dark:text-zinc-200 transition-colors"
              title={tr('detail.saveToFloral')}
            >
              {savingToFloral ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookPlus className="w-3.5 h-3.5" />}
              <span>{tr('detail.saveToFloral')}</span>
            </button>
            {floralMenuOpen && (
              <div className="absolute right-0 bottom-full mb-1.5 z-40 min-w-[148px] py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg text-xs text-zinc-700 dark:text-zinc-200">
                <button
                  type="button"
                  onClick={async () => {
                    setFloralMenuOpen(false)
                    setSavingToFloral(true)
                    try { await onSaveToFloral(item, 'new') } finally { setSavingToFloral(false) }
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors whitespace-nowrap"
                >
                  {tr('detail.saveToFloralNew')}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setFloralMenuOpen(false)
                    setSavingToFloral(true)
                    try { await onSaveToFloral(item, 'append') } finally { setSavingToFloral(false) }
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors whitespace-nowrap"
                >
                  {tr('detail.saveToFloralAppend')}
                </button>
              </div>
            )}
          </div>
        )}

        {isHtml && onCopyPlainText && (
          <button
            type="button"
            onClick={() => onCopyPlainText(item)}
            className="flex items-center gap-1.5 h-7 px-3 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/80 hover:bg-zinc-100 hover:border-zinc-300 dark:hover:bg-zinc-700 dark:hover:border-zinc-600 text-xs text-zinc-700 dark:text-zinc-200 transition-colors"
            title={tr('detail.copyPlainHint')}
          >
            <RemoveFormatting className="w-3.5 h-3.5" />
            <span>{tr('detail.copyPlain')}</span>
          </button>
        )}

        <button
          onClick={() => onCopy(item)}
          className="flex items-center gap-1.5 h-7 px-3 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/80 hover:bg-zinc-100 hover:border-zinc-300 dark:hover:bg-zinc-700 dark:hover:border-zinc-600 text-xs text-zinc-700 dark:text-zinc-200 transition-colors"
        >
          <Copy className="w-3.5 h-3.5" />
          <span>{tr('detail.copy')}</span>
        </button>

        {/* Pin / Unpin button */}
        <button
          onClick={() => onTogglePin(item.id)}
          className={`flex items-center gap-1.5 h-7 px-3 rounded-md text-xs transition-colors ${
            item.is_pinned
              ? 'bg-amber-100 dark:bg-amber-900/35 border border-amber-300 dark:border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/55'
              : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/80 hover:bg-zinc-100 hover:border-zinc-300 dark:hover:bg-zinc-700 dark:hover:border-zinc-600 text-zinc-700 dark:text-zinc-200'
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
                ? 'bg-rose-100 dark:bg-rose-900/35 border border-rose-200 dark:border-rose-500/40 text-rose-600 dark:text-rose-300 hover:bg-rose-200 dark:hover:bg-rose-900/55'
                : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/80 hover:bg-zinc-100 hover:border-zinc-300 dark:hover:bg-zinc-700 dark:hover:border-zinc-600 text-zinc-700 dark:text-zinc-200'
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
                ? 'bg-rose-100 dark:bg-rose-900/35 border border-rose-200 dark:border-rose-500/40 text-rose-600 dark:text-rose-300'
                : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/80 text-zinc-700 dark:text-zinc-200'
            } hover:bg-zinc-100 dark:hover:bg-zinc-700`}
            title={showSensitive ? tr('detail.hideSensitive') : tr('detail.showSensitive')}
          >
            {showSensitive ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        )}

        <button
          onClick={() => onDelete(item.id)}
          className={`flex items-center gap-1.5 h-7 px-3 rounded-md text-xs transition-colors ${
            confirmingDelete
              ? 'bg-red-600 border border-red-600 text-white hover:bg-red-700 shadow-sm'
              : 'bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/80 hover:bg-red-50 hover:border-red-200 dark:hover:bg-red-900/45 dark:hover:border-red-500/40 hover:text-red-600 dark:hover:text-red-300 text-zinc-700 dark:text-zinc-200'
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
            if (e.target === e.currentTarget) {
              if (ocrSelecting) closeOcrSelection()
              else closeLightbox()
            }
          }}
        >
          <div className="absolute top-0 left-0 right-0 h-12 flex items-center justify-between px-4 z-10 pointer-events-none">
            <div className="flex items-center gap-1.5 text-xs text-zinc-400 pointer-events-auto">
              {ocrSelecting ? (
                <span>滚轮缩放 · 拖动图片或选区后识别</span>
              ) : (
                <>
                  <ZoomIn className="w-3.5 h-3.5" />
                  <span>{tr('detail.zoomHint')}</span>
                  <span className="text-zinc-600">·</span>
                  <span>{tr('detail.dragHint')}</span>
                  <span className="text-zinc-600">·</span>
                  <span>{tr('detail.dblClickReset')}</span>
                  <span className="text-zinc-600">·</span>
                  <span>{Math.round(scale * 100)}%</span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 pointer-events-auto">
              {ocrSelecting ? (
                <button
                  onClick={() => { closeOcrSelection(); void runOcr() }}
                  disabled={ocrBusy || !ocrCropRegion}
                  className="h-7 px-3 rounded-full bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-xs text-white transition-colors"
                >
                  识别选区
                </button>
              ) : (
                <button
                  onClick={() => { setScale(1); setPos({ x: 0, y: 0 }) }}
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-zinc-400 hover:text-zinc-200 transition-colors"
                  title="重置"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={ocrSelecting ? closeOcrSelection : closeLightbox}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {ocrSelecting ? (
            <div className="absolute inset-x-0 top-12 bottom-4 flex items-center justify-center px-4">
              <OcrRegionSelector
                src={imageContent || item.content}
                alt={item.preview}
                region={ocrRegion}
                onChange={setOcrRegion}
                disabled={ocrBusy}
                imageClassName="max-w-[90vw] max-h-[calc(100vh-4rem)]"
                imageTransform={`translate(${pos.x}px, ${pos.y}px) scale(${scale})`}
                onImageMouseDown={handleMouseDown}
                onImageLayout={setOcrImageLayout}
              />
            </div>
          ) : (
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
          )}
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
