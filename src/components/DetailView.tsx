import { useState, useEffect, useRef, useCallback } from 'react'
import { ClipboardItem } from '../types'
import { formatStorageSize, getTypeLabel } from '../lib/utils'
import { FileText, Link, Image, Copy, Trash2, Monitor, X, ZoomIn, RotateCcw } from 'lucide-react'
import { tr } from '../i18n'

interface DetailViewProps {
  item: ClipboardItem | null
  onCopy: (item: ClipboardItem) => void
  onDelete: (id: number) => void
  onUpdate: (id: number, content: string) => void
  monospace: boolean
}

function typeIcon(type: string, size = 'w-4 h-4') {
  switch (type) {
    case 'url':
      return <Link className={`${size} text-blue-500 dark:text-blue-400`} />
    case 'image':
      return <Image className={`${size} text-green-500 dark:text-green-400`} />
    default:
      return <FileText className={`${size} text-zinc-400 dark:text-zinc-400`} />
  }
}

const MIN_SCALE = 0.1
const MAX_SCALE = 10
const ZOOM_STEP = 0.1

export default function DetailView({ item, onCopy, onDelete, onUpdate, monospace }: DetailViewProps) {
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

  // Reset edit mode when item changes
  useEffect(() => { setIsEditing(false) }, [item?.id])

  // Auto-focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
    }
  }, [isEditing])

  function enterEditMode() {
    if (!item || item.type === 'image') return
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

  if (!item) {
    return (
      <div className="h-full flex items-center justify-center bg-transparent">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
            <FileText className="w-8 h-8 text-zinc-300 dark:text-zinc-700" />
          </div>
          <p className="text-sm text-zinc-400 dark:text-zinc-600">{tr('detail.empty')}</p>
          <div className="flex items-center gap-3 mt-2 justify-center text-[10px] text-zinc-300 dark:text-zinc-700">
            <span><kbd className="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded font-mono">↑↓</kbd> {tr('detail.switch')}</span>
            <span><kbd className="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded font-mono">C</kbd> {tr('detail.copy')}</span>
            <span><kbd className="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded font-mono">D</kbd> {tr('detail.delete')}</span>
          </div>
        </div>
      </div>
    )
  }

  const isImage = item.type === 'image'

  return (
    <div className="h-full flex flex-col bg-transparent">
      {/* Top info bar */}
      <div className="flex-shrink-0 h-10 flex items-center px-4 gap-3">
        <div className="flex items-center gap-1.5">
          {typeIcon(item.type)}
          <span className="text-xs text-zinc-600 dark:text-zinc-400">{getTypeLabel(item.type)}</span>
        </div>

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

      {/* Main content */}
      <div className="flex-1 overflow-auto p-4">
        {isImage ? (
          item.content ? (
            <div className="flex items-center justify-center min-h-full">
              <img
                src={item.content}
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
          <pre
            onDoubleClick={enterEditMode}
            className={`text-sm text-zinc-800 dark:text-zinc-200 font-normal antialiased whitespace-pre-wrap break-words leading-7 select-text cursor-text hover:bg-zinc-50 dark:hover:bg-zinc-900/50 rounded-lg p-1 -m-1 transition-colors ${monoClass}`}
            title={tr('detail.dblClickZoom')}
          >
            {item.content}
          </pre>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="flex-shrink-0 h-12 flex items-center justify-end gap-2 px-4">
        <button
          onClick={() => onCopy(item)}
          className="flex items-center gap-1.5 h-7 px-3 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs text-zinc-600 dark:text-zinc-300 transition-colors"
        >
          <Copy className="w-3.5 h-3.5" />
          <span>{tr('detail.copy')}</span>
          <kbd className="ml-1 text-[10px] text-zinc-400 dark:text-zinc-500 bg-zinc-200 dark:bg-zinc-900 px-1 py-0.5 rounded font-mono">C</kbd>
        </button>
        <button
          onClick={() => onDelete(item.id)}
          className="flex items-center gap-1.5 h-7 px-3 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-red-100 dark:hover:bg-red-900/50 hover:text-red-600 dark:hover:text-red-400 text-xs text-zinc-500 dark:text-zinc-400 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>{tr('detail.delete')}</span>
          <kbd className="ml-1 text-[10px] text-zinc-400 dark:text-zinc-500 bg-zinc-200 dark:bg-zinc-900 px-1 py-0.5 rounded font-mono">D</kbd>
        </button>
      </div>

      {/* Lightbox overlay — always dark */}
      {lightboxOpen && item.content && (
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
            src={item.content}
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
    </div>
  )
}
