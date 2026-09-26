/**
 * 页内标题栏（Windows 无边框真实透明窗口）：
 * - 纯透明底，透出桌面/后方窗口；仅内容区自绘不透明背景
 * - 左上角应用官方图标 + 标题；右上角自绘最小化/最大化/关闭（关闭走托盘隐藏）
 * - 整条拖拽区：拖动、双击恢复原大小、右键原生系统菜单
 */
import { useEffect, useRef, useState } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'

function getConfiguredDeleteShortcut(): string {
  try {
    const shortcuts = JSON.parse(localStorage.getItem('q-paste-shortcuts') || '{}')
    if (typeof shortcuts.delete === 'string' && shortcuts.delete.trim()) return shortcuts.delete.trim()
  } catch {}
  return 'D'
}

export default function TitleBar() {
  const [icon, setIcon] = useState('')
  const [maximized, setMaximized] = useState(false)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; lastX: number; lastY: number; started: boolean } | null>(null)
  const isWindows = navigator.platform.toLowerCase().startsWith('win') || navigator.userAgent.includes('Windows')

  useEffect(() => {
    window.electronAPI?.getAppIcon?.().then(setIcon).catch(() => {})
    window.electronAPI?.getWindowMaximized?.().then(setMaximized).catch(() => {})
    const off = window.electronAPI?.onWindowMaximizeChanged?.((v) => setMaximized(!!v))
    return () => off?.()
  }, [])

  const btnBase =
    'no-drag w-11 h-9 flex items-center justify-center text-zinc-600 dark:text-zinc-300 transition-colors'

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isWindows || event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY,
      started: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.started && Math.hypot(event.screenX - drag.startX, event.screenY - drag.startY) < 4) return
    drag.started = true
    const dx = event.screenX - drag.lastX
    const dy = event.screenY - drag.lastY
    drag.lastX = event.screenX
    drag.lastY = event.screenY
    if (dx || dy) window.electronAPI?.moveWindowByDrag(dx, dy)
  }

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  return (
    <div
      className={`${isWindows ? 'no-drag' : 'drag-region'} absolute top-0 left-0 right-0 h-9 z-50 flex items-center pl-3 select-none bg-transparent border-b border-zinc-200 dark:border-zinc-800`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onContextMenu={(e) => {
        e.preventDefault()
        void window.electronAPI?.showWindowSystemMenu?.()
      }}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return
        event.preventDefault()
        void window.electronAPI?.restoreDefaultWindowSize()
      }}
    >
      <button
        type="button"
        className="no-drag flex items-center gap-2 rounded px-1 py-1 hover:bg-zinc-500/10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-500"
        title="切换到花笺"
        aria-label="切换到花笺"
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={() => void window.electronAPI?.switchAppMode('floral', getConfiguredDeleteShortcut())}
      >
        <img
          src={icon}
          alt=""
          className="w-4 h-4 pointer-events-none"
          draggable={false}
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.display = 'none'
          }}
        />
        {icon === '' && (
          <div
            className="w-4 h-4 rounded-[5px] flex items-center justify-center text-[10px] font-black text-white"
            style={{ background: 'var(--accent)' }}
          >
            Q
          </div>
        )}
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Q-Paste</span>
      </button>

      {/* 右上角自绘窗口按钮（无边框窗口下系统不再绘制） */}
      <div className="flex-1" />
      <div className="flex items-stretch h-9 flex-shrink-0">
        <button
          className={btnBase}
          title="最小化"
          onClick={() => void window.electronAPI?.minimizeWindow()}
        >
          <Minus size={15} />
        </button>
        <button
          className={btnBase}
          title={maximized ? '向下还原' : '最大化'}
          onClick={() => void window.electronAPI?.maximizeWindow()}
        >
          {maximized ? <Copy size={13} className="-scale-x-100" /> : <Square size={12} />}
        </button>
        <button
          className={`${btnBase} hover:bg-red-500 hover:text-white`}
          title="关闭"
          onClick={() => void window.electronAPI?.closeWindow()}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
