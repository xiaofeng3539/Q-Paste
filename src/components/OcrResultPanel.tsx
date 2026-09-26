import { Copy, RefreshCw, Save, X } from 'lucide-react'

interface OcrResultPanelProps {
  value: string
  busy: boolean
  error: string | null
  notice?: string | null
  onChange: (value: string) => void
  onCopy: () => void
  onSave: () => Promise<void>
  onRetry: () => void
  onClose: () => void
}

export default function OcrResultPanel({ value, busy, error, notice, onChange, onCopy, onSave, onRetry, onClose }: OcrResultPanelProps) {
  return (
    <div className="mb-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">局部 OCR 结果</span>
        <button onClick={onClose} className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200" title="关闭 OCR 结果">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {error ? (
        <div className="p-3">
          <p className="text-xs text-red-500 mb-3">{error}</p>
          <button onClick={onRetry} disabled={busy} className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 text-xs text-zinc-600 dark:text-zinc-300">
            <RefreshCw className="w-3.5 h-3.5" />重新识别
          </button>
        </div>
      ) : (
        <div className="p-3">
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="w-full min-h-32 resize-y rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-2 text-xs leading-5 text-zinc-700 dark:text-zinc-200 outline-none focus:border-[var(--accent)]"
            placeholder="识别出的文字会显示在这里"
          />
          {notice && <p className="mt-2 text-xs text-red-500">{notice}</p>}
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{[...value].length} 个字符</span>
            <div className="flex gap-2">
              <button onClick={onCopy} disabled={!value.trim()} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 text-xs text-zinc-600 dark:text-zinc-300">
                <Copy className="w-3.5 h-3.5" />复制
              </button>
              <button onClick={() => void onSave()} disabled={!value.trim()} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-[var(--accent)] text-white disabled:opacity-50 text-xs">
                <Save className="w-3.5 h-3.5" />保存到历史
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
