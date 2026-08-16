import { ReactNode, useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '../lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** 底部按钮区域（默认不渲染） */
  footer?: ReactNode
  /** 点击遮罩是否关闭，默认 true */
  dismissable?: boolean
  width?: string
}

/**
 * 通用模态弹窗：替代原生 alert/confirm，风格与应用 UI 统一。
 * 支持 Esc 关闭、遮罩点击关闭、自定义底部按钮。
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  dismissable = true,
  width = 'max-w-sm',
}: ModalProps) {
  // Esc 关闭
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={() => dismissable && onClose()}
      />
      {/* 内容卡片 */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative w-full mx-4 rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl border border-zinc-200/70 dark:border-zinc-800/70 overflow-hidden',
          width
        )}
      >
        {title && (
          <div className="flex items-center justify-between px-5 pt-4 pb-0">
            <h3 className="text-[14px] font-medium text-zinc-800 dark:text-zinc-200">{title}</h3>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              aria-label="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="px-5 py-4 text-[13px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
          {children}
        </div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 pb-4">{footer}</div>
        )}
      </div>
    </div>
  )
}
