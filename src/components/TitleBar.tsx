/**
 * 页内标题栏（Windows 无边框真实透明窗口）：
 * - 纯透明底，透出桌面/后方窗口；仅内容区自绘不透明背景
 * - 左上角应用官方图标 + 标题；右上角自绘最小化/最大化/关闭（关闭走托盘隐藏）
 * - 整条拖拽区：拖动、双击最大化、右键原生系统菜单
 */
import { useEffect, useState } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'

export default function TitleBar() {
  const [icon, setIcon] = useState('')
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.electronAPI?.getAppIcon?.().then(setIcon).catch(() => {})
    window.electronAPI?.getWindowMaximized?.().then(setMaximized).catch(() => {})
    const off = window.electronAPI?.onWindowMaximizeChanged?.((v) => setMaximized(!!v))
    return () => off?.()
  }, [])

  const btnBase =
    'no-drag w-11 h-9 flex items-center justify-center text-zinc-600 dark:text-zinc-300 transition-colors'

  return (
    <div
      className="drag-region absolute top-0 left-0 right-0 h-9 z-50 flex items-center pl-3 select-none bg-transparent border-b border-zinc-200 dark:border-zinc-800"
      onContextMenu={(e) => {
        e.preventDefault()
        void window.electronAPI?.showWindowSystemMenu?.()
      }}
      onDoubleClick={() => void window.electronAPI?.maximizeWindow()}
    >
      <img
        src={icon}
        alt=""
        className="w-4 h-4 no-drag pointer-events-none"
        draggable={false}
        onError={(e) => {
          ;(e.currentTarget as HTMLImageElement).style.display = 'none'
        }}
      />
      {icon === '' && (
        <div
          className="w-4 h-4 rounded-[5px] flex items-center justify-center text-[10px] font-black text-white no-drag"
          style={{ background: 'var(--accent)' }}
        >
          Q
        </div>
      )}
      <span className="ml-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">Q-Paste</span>

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
