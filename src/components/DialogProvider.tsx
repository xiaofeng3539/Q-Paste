import { createContext, useCallback, useContext, useState, ReactNode } from 'react'
import Modal from './Modal'
import { tr } from '../i18n'

interface ConfirmOptions {
  title?: string
  confirmText?: string
  cancelText?: string
  /** 危险操作：确认按钮红色 */
  danger?: boolean
}

interface DialogContextValue {
  /** 应用内 alert（仅提示，无按钮逻辑） */
  alert: (message: string, title?: string) => Promise<void>
  /** 应用内 confirm，返回用户是否确认 */
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>
}

const DialogContext = createContext<DialogContextValue | null>(null)

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext)
  if (!ctx) {
    // 未包裹 Provider 时退化为原生弹窗（不影响功能）
    return {
      alert: async (msg) => { window.alert(msg) },
      confirm: async (msg) => window.confirm(msg),
    }
  }
  return ctx
}

interface DialogState {
  kind: 'alert' | 'confirm'
  message: string
  title?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  resolve: (value: boolean) => void
}

export default function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null)

  const openDialog = useCallback((state: Omit<DialogState, 'resolve'>) => {
    return new Promise<boolean>((resolve) => {
      setDialog({ ...state, resolve })
    })
  }, [])

  const alert = useCallback((message: string, title?: string) => {
    return openDialog({ kind: 'alert', message, title }).then(() => undefined)
  }, [openDialog])

  const confirm = useCallback((message: string, options?: ConfirmOptions) => {
    return openDialog({
      kind: 'confirm',
      message,
      title: options?.title,
      confirmText: options?.confirmText,
      cancelText: options?.cancelText,
      danger: options?.danger,
    })
  }, [openDialog])

  const close = useCallback((value: boolean) => {
    setDialog((prev) => {
      prev?.resolve(value)
      return null
    })
  }, [])

  const isConfirm = dialog?.kind === 'confirm'

  return (
    <DialogContext.Provider value={{ alert, confirm }}>
      {children}
      <Modal
        open={!!dialog}
        onClose={() => close(false)}
        title={dialog?.title}
        dismissable={false}
        footer={
          isConfirm ? (
            <>
              <button
                onClick={() => close(false)}
                className="h-8 px-4 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs text-zinc-600 dark:text-zinc-400 transition-colors font-medium"
              >
                {dialog?.cancelText || tr('dialog.cancel')}
              </button>
              <button
                onClick={() => close(true)}
                className={`h-8 px-4 rounded-md text-xs text-white transition-colors font-medium ${
                  dialog?.danger
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-[var(--accent)] hover:opacity-90'
                }`}
              >
                {dialog?.confirmText || tr('dialog.confirm')}
              </button>
            </>
          ) : (
            <button
              onClick={() => close(true)}
              className="h-8 px-4 rounded-md bg-[var(--accent)] text-xs text-white hover:opacity-90 transition-colors font-medium"
            >
              {tr('dialog.ok')}
            </button>
          )
        }
      >
        {dialog?.message}
      </Modal>
    </DialogContext.Provider>
  )
}
