import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import type { OcrRegion } from '../lib/ocr'

interface OcrRegionSelectorProps {
  src: string
  alt: string
  region: OcrRegion | null
  onChange: (region: OcrRegion) => void
  disabled?: boolean
  imageClassName?: string
  imageTransform?: string
  onImageMouseDown?: (event: MouseEvent<HTMLImageElement>) => void
  onImageLayout?: (layout: { naturalWidth: number; naturalHeight: number; displayedWidth: number; displayedHeight: number }) => void
}

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se'

export default function OcrRegionSelector({ src, alt, region, onChange, disabled = false, imageClassName = 'max-w-full max-h-full', imageTransform, onImageMouseDown, onImageLayout }: OcrRegionSelectorProps) {
  const imageRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; region: OcrRegion } | null>(null)
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    dragRef.current = null
  }, [src, disabled])

  const displayedRegion = region && imageSize.width > 0 && imageSize.height > 0
    ? {
        left: `${(region.x / imageSize.width) * 100}%`,
        top: `${(region.y / imageSize.height) * 100}%`,
        width: `${(region.width / imageSize.width) * 100}%`,
        height: `${(region.height / imageSize.height) * 100}%`,
      }
    : null

  const handleLoad = () => {
    const image = imageRef.current
    if (!image) return
    const size = { width: image.naturalWidth, height: image.naturalHeight }
    setImageSize(size)
    onImageLayout?.({ naturalWidth: size.width, naturalHeight: size.height, displayedWidth: image.offsetWidth, displayedHeight: image.offsetHeight })
    if (!region) {
      onChange({
        x: Math.round(size.width * 0.15),
        y: Math.round(size.height * 0.35),
        width: Math.round(size.width * 0.7),
        height: Math.round(size.height * 0.3),
      })
    }
  }

  const startDrag = (event: PointerEvent<HTMLElement>, mode: DragMode) => {
    if (disabled || !region) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, region }
  }

  const handleMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const image = imageRef.current
    if (!drag || !image || !imageSize.width || !imageSize.height) return
    const dx = Math.round(((event.clientX - drag.startX) / image.offsetWidth) * imageSize.width)
    const dy = Math.round(((event.clientY - drag.startY) / image.offsetHeight) * imageSize.height)
    let { x, y, width, height } = drag.region

    if (drag.mode === 'move') {
      x += dx
      y += dy
    } else {
      if (drag.mode.includes('w')) { x += dx; width -= dx }
      if (drag.mode.includes('n')) { y += dy; height -= dy }
      if (drag.mode.includes('e')) width += dx
      if (drag.mode.includes('s')) height += dy
    }

    width = Math.max(8, Math.min(width, imageSize.width))
    height = Math.max(8, Math.min(height, imageSize.height))
    x = Math.max(0, Math.min(x, imageSize.width - width))
    y = Math.max(0, Math.min(y, imageSize.height - height))
    onChange({ x, y, width, height })
  }

  return (
    <div className="relative inline-flex max-w-full select-none" onPointerMove={handleMove} onPointerUp={() => { dragRef.current = null }} onPointerCancel={() => { dragRef.current = null }}>
      <img ref={imageRef} src={src} alt={alt} onLoad={handleLoad} onMouseDown={onImageMouseDown} className={`${imageClassName} object-contain rounded-lg`} style={imageTransform ? { transform: imageTransform, transformOrigin: 'center center' } : undefined} draggable={false} />
      {displayedRegion && (
        <div
          className="absolute border-2 border-blue-400 bg-blue-400/15 touch-none cursor-move"
          style={displayedRegion}
          onPointerDown={(event) => startDrag(event, 'move')}
        >
          {(['nw', 'ne', 'sw', 'se'] as DragMode[]).map((corner) => (
            <span
              key={corner}
              className={`absolute w-3 h-3 rounded-sm bg-blue-400 ${corner.includes('n') ? '-top-1.5' : '-bottom-1.5'} ${corner.includes('w') ? '-left-1.5' : '-right-1.5'} cursor-${corner === 'nw' || corner === 'se' ? 'nwse' : 'nesw'}-resize`}
              onPointerDown={(event) => {
                event.stopPropagation()
                startDrag(event, corner)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
