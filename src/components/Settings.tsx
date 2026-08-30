import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Monitor, Keyboard, Info, Palette, Database, Minus, Plus, X, RotateCcw, FileClock, HelpCircle, Cloud, User, Github, Star, AlertCircle, ClipboardList } from 'lucide-react'
import { cn } from '../lib/utils'
import { Lang, tr, setLang } from '../i18n'
import SectionHeader from './SectionHeader'
import { ShortcutAction, SHORTCUT_ACTIONS, DEFAULT_SHORTCUTS } from '../lib/shortcuts'
import { useDialog } from './DialogProvider'
import type { CloudSyncConfig, CloudSyncStatus } from '../main/sync/types'
import type { FtStatus, FtSettings } from '../types'
import FileTransferChat from './FileTransferChat'
import { QRCodeCanvas } from 'qrcode.react'

type Theme = 'light' | 'dark' | 'auto'

interface SettingsProps {
  theme: Theme
  onThemeChange: (t: Theme) => void
  language: Lang
  onLanguageChange: (l: Lang) => void
  accentColor: string
  onAccentChange: (c: string) => void
  listDensity: 'comfortable' | 'compact'
  onDensityChange: (d: 'comfortable' | 'compact') => void
  useMonospace: boolean
  onMonospaceChange: (v: boolean) => void
  autoHideOnCopy: boolean
  onAutoHideChange: (v: boolean) => void
  shortcuts: Record<ShortcutAction, string>
  onShortcutChange: (action: ShortcutAction, combo: string) => void
  onBack: () => void
  onDataImported: () => Promise<void>
  onClearData: (type: 'images' | 'all') => Promise<void>
  /** 轻提示（复用主界面 Toast），云同步开关失败归因等使用 */
  onToast?: (msg: string) => void
}

type MenuKey = 'general' | 'appearance' | 'fileTransfer' | 'cloudSync' | 'storage' | 'shortcuts' | 'about'

function useMenuItems(): { key: MenuKey; label: string; icon: React.ReactNode }[] {
  return [
    { key: 'general', label: tr('settings.general'), icon: <Monitor className="w-4 h-4" /> },
    { key: 'appearance', label: tr('settings.appearance'), icon: <Palette className="w-4 h-4" /> },
    { key: 'fileTransfer', label: tr('ft.title'), icon: <FileClock className="w-4 h-4" /> },
    { key: 'cloudSync', label: tr('settings.cloudSync'), icon: <Cloud className="w-4 h-4" /> },
    { key: 'storage', label: tr('settings.storage'), icon: <Database className="w-4 h-4" /> },
    { key: 'shortcuts', label: tr('settings.shortcuts'), icon: <Keyboard className="w-4 h-4" /> },
    { key: 'about', label: tr('settings.about'), icon: <Info className="w-4 h-4" /> },
  ]
}

/** 局域网传输设置开关：全热区、无禁用态，点击即时回调（乐观更新由调用方处理） */
function FtSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
        'after:content-[\'\'] after:absolute after:-inset-1.5 after:rounded-full',
        checked ? 'bg-[var(--accent)]' : 'bg-zinc-300 dark:bg-zinc-600'
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
          checked ? 'translate-x-4' : 'translate-x-0'
        )}
      />
    </button>
  )
}

export default function Settings({ theme, onThemeChange, language, onLanguageChange, accentColor, onAccentChange, listDensity, onDensityChange, useMonospace, onMonospaceChange, autoHideOnCopy, onAutoHideChange, shortcuts, onShortcutChange, onBack, onDataImported, onClearData, onToast }: SettingsProps) {
  const [activeMenu, setActiveMenu] = useState<MenuKey>('general')
  const menuItems = useMenuItems()
  const { alert, confirm } = useDialog()

  // General toggle state
  const [autoStart, setAutoStart] = useState(true)
  const [minToTray, setMinToTray] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI) return
    window.electronAPI.getAutoStart().then((s) => {
      setAutoStart(s.autoStart)
      setMinToTray(s.startMinimized)
    })
  }, [])

  function handleToggleAutoStart(v: boolean) {
    setAutoStart(v)
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.setAutoStart({ autoStart: v })
    }
  }

  function handleToggleMinToTray(v: boolean) {
    setMinToTray(v)
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.setAutoStart({ startMinimized: v })
    }
  }

  const [storagePath, setStoragePath] = useState('')
  useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.getConfigPath().then((p) => {
        if (p) setStoragePath(p)
      })
    } else {
      setStoragePath('C:\\Users\\Admin\\AppData\\Roaming\\Q-Paste\\Data')
    }
  }, [])
  const [storageUsage, setStorageUsage] = useState<{ textBytes: number; imageBytes: number; totalBytes: number } | null>(null)

  // Fetch real storage stats when entering storage section
  useEffect(() => {
    if (activeMenu !== 'storage') return
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.getStorageUsage().then(setStorageUsage)
    }
  }, [activeMenu])

  const [retentionDays, setRetentionDays] = useState('forever')
  const [maxRecords, setMaxRecords] = useState(500)

  // 从主进程读取已保存的保留策略
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI) return
    window.electronAPI.getRetention().then((s) => {
      setRetentionDays(String(s.retentionDays))
      setMaxRecords(s.maxRecords)
    })
  }, [])

  function handleRetentionChange(v: string) {
    setRetentionDays(v)
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.setRetention({ retentionDays: v === 'forever' ? 'forever' : Number(v) })
    }
  }

  function handleMaxRecordsChange(n: number) {
    const clamped = Math.min(9999, Math.max(100, Math.round(n) || 100))
    setMaxRecords(clamped)
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.setRetention({ maxRecords: clamped })
    }
  }

  // ── 捕获规则（忽略规则 / 去重置顶开关）──
  const [ignorePatterns, setIgnorePatterns] = useState<string[]>([])
  const [dedupeOnCapture, setDedupeOnCapture] = useState(true)
  const [maxCaptureKb, setMaxCaptureKb] = useState(1024)
  const [ignoreRuleDraft, setIgnoreRuleDraft] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI) return
    window.electronAPI.getCaptureRules().then((s) => {
      setIgnorePatterns(s.ignorePatterns)
      setDedupeOnCapture(s.dedupeOnCapture)
      setMaxCaptureKb(s.maxCaptureKb)
    })
  }, [])

  function handleToggleDedupe(v: boolean) {
    setDedupeOnCapture(v)
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.setCaptureRules({ dedupeOnCapture: v })
    }
  }

  // ── 局域网文件传输（手机 ↔ PC，对齐 Tiez 交互）──
  const [ftEnabled, setFtEnabled] = useState(false)
  const [ftStatus, setFtStatus] = useState<FtStatus | null>(null)
  const [ftSettings, setFtSettings] = useState<FtSettings>({ enabled: false, port: 18888, path: '', autoOpen: false, autoClose: false, autoCopy: true, bindIp: '' })
  const [ftPortDraft, setFtPortDraft] = useState('18888')
  const [availableIps, setAvailableIps] = useState<string[]>([])
  const [localIp, setLocalIp] = useState('')
  const [showAutoCloseHint, setShowAutoCloseHint] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.ftGetSettings) return
    window.electronAPI.ftGetSettings().then((s) => {
      setFtSettings(s)
      setFtEnabled(s.enabled)
      setFtPortDraft(String(s.port))
      return window.electronAPI.ftStatus()
    }).then((st) => {
      setFtStatus(st)
      if (st?.ip) setLocalIp(st.ip)
    }).catch(() => {})
    window.electronAPI.ftGetAvailableIps().then((ips) => {
      setAvailableIps(ips)
      setLocalIp((cur) => cur || ips[0] || '')
    }).catch(() => {})
    const offStatus = window.electronAPI.onFtStatusChanged((st) => {
      setFtStatus(st)
      setFtEnabled(st.enabled)
      if (st.ip) setLocalIp(st.ip)
    })
    return offStatus
  }, [])

  async function handleFtToggle(v: boolean): Promise<void> {
    const res = await window.electronAPI.ftToggle(v, Number(ftPortDraft) || undefined)
    if (res.success) {
      setFtEnabled(v)
      const st = await window.electronAPI.ftStatus()
      setFtStatus(st)
      if (v && !localIp) {
        const ips = await window.electronAPI.ftGetAvailableIps()
        setAvailableIps(ips)
        setLocalIp(ips[0] || '127.0.0.1')
      }
    } else {
      setFtEnabled(false)
      onToast?.(res.error || 'error')
    }
  }

  /** 端口失焦/回车应用：重启服务绑定新端口（等价 Tiez applyFileServerPort） */
  function applyFtPort(): void {
    const n = Number(ftPortDraft)
    if (Number.isInteger(n) && n > 0 && n < 65536 && ftEnabled) void handleFtToggle(true)
  }

  const ftSavingKeys = useRef<Set<string>>(new Set())
  async function ftSaveSetting(key: 'fileTransferAutoOpen' | 'fileTransferAutoClose' | 'fileTransferAutoCopy', v: boolean): Promise<void> {
    // 快速连点串行化：同键在途时忽略，防 UI 与配置不一致
    if (ftSavingKeys.current.has(key)) return
    ftSavingKeys.current.add(key)
    setFtSettings((s) => ({ ...s, [key]: v })) // 即时切换 UI
    try {
      await window.electronAPI.ftSetSetting(key, v) // 实时持久化（同步写配置文件）
      const fresh = await window.electronAPI.ftGetSettings() // 读回校准，双向绑定
      setFtSettings((s) => ({ ...s, ...fresh, [key]: v }))
    } catch (err: any) {
      setFtSettings((s) => ({ ...s, [key]: !v })) // 失败回滚 UI
      onToast?.(err?.message ?? String(err))
    } finally {
      ftSavingKeys.current.delete(key)
    }
  }

  // ── 云同步（WebDAV，多设备）──
  const [cloudCfg, setCloudCfg] = useState<CloudSyncConfig>({
    enabled: false, webdavUrl: '', username: '', password: '',
    basePath: 'qpaste-sync', deviceId: '', intervalSecs: 120,
  })
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus | null>(null)
  const [cloudErr, setCloudErr] = useState('')
  const [cloudBusy, setCloudBusy] = useState(false)
  /** 本地是否有配置缓存（决定开启 Toggle 时是否直接展开表单） */
  const [showCloudForm, setShowCloudForm] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.getCloudSyncConfig) return
    window.electronAPI.getCloudSyncConfig().then((cfg) => {
      setCloudCfg(cfg)
      if (cfg.enabled) window.electronAPI.getCloudSyncStatus().then(setCloudStatus).catch(() => {})
    }).catch(() => {})
  }, [])

  function cloudFailText(reason?: string): string {
    if (reason === 'auth') return tr('general.cloudSyncAuthFailed')
    if (reason === 'network') return tr('general.cloudSyncNetworkFailed')
    return tr('general.cloudSyncServerError')
  }

  /**
   * 开关唯一入口：调主进程 toggleWebDav，由 Promise 结果决定 Toggle 是否停留。
   * 无配置缓存时开启 → 仅展开表单，保存按钮二次触发真正的开启。
   */
  async function handleToggleCloudSync(v: boolean): Promise<boolean> {
    if (v && !cloudCfg.webdavUrl.trim()) {
      setShowCloudForm(true)
      setCloudErr(tr('general.cloudSyncNeedUrl'))
      return false
    }
    setCloudBusy(true)
    setCloudErr('')
    try {
      const res = await window.electronAPI.toggleWebDav({
        webdavUrl: cloudCfg.webdavUrl,
        username: cloudCfg.username,
        password: cloudCfg.password,
        basePath: cloudCfg.basePath,
        intervalSecs: cloudCfg.intervalSecs,
      }, v)
      setCloudStatus(res.status ?? null)
      if (!res.ok) {
        // 鉴权失败 / 网络断开：Toggle 回弹到关闭，Toast 提示归因
        setCloudErr(res.message || cloudFailText(res.reason))
        onToast?.(cloudFailText(res.reason))
        return false
      }
      setCloudCfg((c) => ({ ...c, enabled: v }))
      onToast?.(tr(v ? 'general.cloudSyncEnabled' : 'general.cloudSyncDisabled'))
      return true
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      setCloudErr(msg)
      onToast?.(cloudFailText('server'))
      return false
    } finally {
      setCloudBusy(false)
    }
  }

  async function handleCloudSyncNow() {
    if (!window.electronAPI?.cloudSyncNow) return
    setCloudBusy(true)
    try {
      const res = await window.electronAPI.cloudSyncNow()
      setCloudStatus(res.status)
      if (!res.ok && res.error) {
        setCloudErr(res.error)
        onToast?.(cloudFailText('network'))
      }
    } finally {
      setCloudBusy(false)
    }
  }

  function handleAddIgnoreRule() {
    const rule = ignoreRuleDraft.trim()
    if (!rule) return
    try { new RegExp(rule) } catch {
      alert(tr('general.invalidRegex'))
      return
    }
    if (!ignorePatterns.includes(rule)) {
      const next = [...ignorePatterns, rule]
      setIgnorePatterns(next)
      if (typeof window !== 'undefined' && window.electronAPI) {
        window.electronAPI.setCaptureRules({ ignorePatterns: next })
      }
    }
    setIgnoreRuleDraft('')
  }

  function handleRemoveIgnoreRule(rule: string) {
    const next = ignorePatterns.filter((r) => r !== rule)
    setIgnorePatterns(next)
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.setCaptureRules({ ignorePatterns: next })
    }
  }

  /** 打开外部链接（复用 IPC shell:open-url） */
  const openUrl = async (url: string) => {
    if (typeof window !== 'undefined' && window.electronAPI?.openUrl) {
      await window.electronAPI.openUrl(url)
    }
  }

  const [shortcutRecording, setShortcutRecording] = useState(false)
  const [toggleShortcut, setToggleShortcut] = useState('Alt+Space')
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI) return
    window.electronAPI.getShortcut().then((sc) => {
      if (sc) setToggleShortcut(sc)
    })
  }, [])

  // ── 本地快捷键录制（复制/删除/收藏/导航/清空搜索）──
  /** 正在录制的本地快捷键动作；null 表示未在录制 */
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null)

  // 录制监听：按下组合键后写入，Esc/失焦取消
  useEffect(() => {
    if (!recordingAction) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat) return
      e.preventDefault()
      e.stopPropagation()

      // Escape → 取消
      if (e.key === 'Escape') {
        setRecordingAction(null)
        return
      }

      // 组合键需至少一个修饰键；纯单键允许（如 C / W / S / D）
      const modifierKeys = new Set(['Control', 'Alt', 'Shift', 'Meta'])
      if (modifierKeys.has(e.key)) return // 只按了修饰键本身

      const parts: string[] = []
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      if (e.metaKey) parts.push('Meta')
      parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key)

      const combo = parts.join('+')
      // 闭包内自行收窄（不依赖外层 effect 的收窄传递）
      const action: ShortcutAction = recordingAction as ShortcutAction
      // 冲突检测：同一组合键已被其他动作占用时拒绝
      const conflict = SHORTCUT_ACTIONS.find(
        (a) => a !== action && shortcuts[a] === combo
      )
      if (conflict) {
        alert(tr('shortcuts.conflict', { action: shortcutLabel(conflict) }))
        setRecordingAction(null)
        return
      }
      onShortcutChange(action, combo)
      setRecordingAction(null)
    }

    function onBlur() {
      setRecordingAction(null)
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [recordingAction, onShortcutChange, shortcuts])

  /** 快捷键标签文案 */
  function shortcutLabel(action: ShortcutAction): string {
    switch (action) {
      case 'copy': return tr('shortcuts.copyItem')
      case 'delete': return tr('shortcuts.deleteItem')
      case 'pin': return tr('shortcuts.pinItem')
      case 'prev': return tr('shortcuts.prevItem')
      case 'next': return tr('shortcuts.nextItem')
      case 'clearSearch': return tr('shortcuts.clearSearch')
      default: return action
    }
  }

  /** 重置本地快捷键为默认值 */
  function handleResetShortcuts() {
    for (const action of SHORTCUT_ACTIONS) {
      onShortcutChange(action, DEFAULT_SHORTCUTS[action])
    }
  }

  // ── Storage path handlers ──

  /** 禁止写入的系统目录 */
  const FORBIDDEN_DIRS = [
    'C:\\Windows',
    'C:\\Windows\\System32',
    'C:\\Windows\\SysWOW64',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\',
  ]

  function isForbiddenPath(p: string): boolean {
    const normalized = p.replace(/\//g, '\\').replace(/\\+$/, '')
    return FORBIDDEN_DIRS.some(
      (dir) => normalized.toLowerCase() === dir.toLowerCase() ||
               normalized.toLowerCase().startsWith(dir.toLowerCase() + '\\')
    )
  }

  async function handleChangeDir() {
    if (typeof window === 'undefined' || !window.electronAPI) {
      setStoragePath(tr('storage.selectDirElectronOnly'))
      return
    }
    const result = await window.electronAPI.selectDirectory()
    if (result.canceled || !result.path) return

    if (isForbiddenPath(result.path)) {
      alert(tr('storage.forbiddenPath'))
      return
    }

    // 保存新路径 → 迁移数据 → 强制重启
    const res = await window.electronAPI.changeStoragePath(result.path)
    if (res && !res.success) {
      alert(res.error ? tr('storage.migrateFailed', { error: res.error }) : tr('storage.migrateFailedUnknown'))
    }
  }

  async function handleOpenFolder() {
    if (typeof window === 'undefined' || !window.electronAPI) return
    await window.electronAPI.openFolder(storagePath)
  }

  // ── Shortcut recording listener ──
  useEffect(() => {
    if (!shortcutRecording) return
    const prevShortcut = toggleShortcut

    async function onKeyDown(e: KeyboardEvent) {
      if (e.repeat) return
      e.preventDefault()
      e.stopPropagation()

      // Escape → cancel
      if (e.key === 'Escape') {
        setToggleShortcut(prevShortcut)
        setShortcutRecording(false)
        return
      }

      // Must have at least one modifier
      if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return

      // Must have a real key (not just a modifier)
      const modifierKeys = new Set(['Control', 'Alt', 'Shift', 'Meta'])
      if (modifierKeys.has(e.key)) return

      // Build combo string
      const parts: string[] = []
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      if (e.metaKey) parts.push('Meta')
      parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key)

      const newSc = parts.join('+')
      setToggleShortcut(newSc)
      setShortcutRecording(false)

      // Sync to main process for global registration
      if (typeof window !== 'undefined' && window.electronAPI) {
        const result = await window.electronAPI.updateShortcut(newSc)
        if (!result.success) {
          // Registration failed — revert to what main process kept
          setToggleShortcut(result.shortcut)
        }
      }
    }

    function onBlur() {
      setToggleShortcut(prevShortcut)
      setShortcutRecording(false)
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [shortcutRecording, toggleShortcut])

  return (
    <div className="h-full flex bg-zinc-50 dark:bg-zinc-950">
      {/* Left — settings menu */}
      <div className="w-[200px] flex-shrink-0 flex flex-col">
        {/* Menu items */}
        <div className="flex-1 py-2 pt-8">
          {menuItems.map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveMenu(item.key)}
              style={activeMenu === item.key ? { backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)' } : undefined}
              className={cn(
                'w-[calc(100%-16px)] mx-2 flex items-center gap-2.5 px-3 py-2 text-left text-[13px] rounded-lg transition-all',
                activeMenu === item.key
                  ? 'text-[var(--accent)] font-medium'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/50',
              )}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {/* Bottom — back button (fixed) */}
        <div className="flex-shrink-0 border-t border-zinc-200 dark:border-zinc-800 p-2">
          <button
            onClick={onBack}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-[13px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{tr('settings.back')}</span>
          </button>
        </div>
      </div>

      {/* Right — settings content (floating card) */}
      <div className="flex-1 flex flex-col min-w-0 p-4 pt-8 pl-0">
        <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200/60 dark:border-zinc-800/50 p-6">
          {activeMenu === 'general' && (
            <div className="space-y-4">
              <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <SectionHeader className="px-5 pt-5 pb-1 mb-0">{tr('general.startup')}</SectionHeader>

                {/* Auto-start */}
                <div className="flex items-center justify-between py-4 px-5 border-b border-zinc-200 dark:border-zinc-800">
                  <div className="flex flex-col">
                    <span className="text-[14px] font-medium text-zinc-800 dark:text-zinc-200">{tr('general.autoStart')}</span>
                    <span className="text-[12px] text-zinc-400 dark:text-zinc-500 mt-0.5">{tr('general.autoStartDesc')}</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoStart}
                    onClick={() => handleToggleAutoStart(!autoStart)}
                    className={cn(
                      'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                      autoStart ? 'bg-[var(--accent)]' : 'bg-zinc-300 dark:bg-zinc-600'
                    )}
                  >
                    <span
                      className={cn(
                        'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
                        autoStart ? 'translate-x-4' : 'translate-x-0'
                      )}
                    />
                  </button>
                </div>

                {/* Min to tray on launch */}
                <div className="flex items-center justify-between py-4 px-5 border-t border-zinc-200 dark:border-zinc-800">
                  <div className="flex flex-col">
                    <span className="text-[14px] font-medium text-zinc-800 dark:text-zinc-200">{tr('general.minToTray')}</span>
                    <span className="text-[12px] text-zinc-400 dark:text-zinc-500 mt-0.5">{tr('general.minToTrayDesc')}</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={minToTray}
                    onClick={() => handleToggleMinToTray(!minToTray)}
                    className={cn(
                      'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                      minToTray ? 'bg-[var(--accent)]' : 'bg-zinc-300 dark:bg-zinc-600'
                    )}
                  >
                    <span
                      className={cn(
                        'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
                        minToTray ? 'translate-x-4' : 'translate-x-0'
                      )}
                    />
                  </button>
                </div>

                {/* Auto-hide after copy */}
                <div className="flex items-center justify-between py-4 px-5 border-t border-zinc-200 dark:border-zinc-800">
                  <div className="flex flex-col">
                    <span className="text-[14px] font-medium text-zinc-800 dark:text-zinc-200">{tr('general.autoHideOnCopy')}</span>
                    <span className="text-[12px] text-zinc-400 dark:text-zinc-500 mt-0.5">{tr('general.autoHideOnCopyDesc')}</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoHideOnCopy}
                    onClick={() => onAutoHideChange(!autoHideOnCopy)}
                    className={cn(
                      'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                      autoHideOnCopy ? 'bg-[var(--accent)]' : 'bg-zinc-300 dark:bg-zinc-600'
                    )}
                  >
                    <span
                      className={cn(
                        'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
                        autoHideOnCopy ? 'translate-x-4' : 'translate-x-0'
                      )}
                    />
                  </button>
                </div>
              </div>

              <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl p-5 border border-zinc-200 dark:border-zinc-800">
                <SectionHeader className="mb-3">{tr('general.language')}</SectionHeader>
                <select
                  value={language}
                  onChange={(e) => { const l = e.target.value as Lang; onLanguageChange(l); setLang(l) }}
                  className="h-8 px-3 rounded-md text-[13px] bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 outline-none focus:border-zinc-400 dark:focus:border-zinc-700 appearance-none cursor-pointer min-w-[160px]"
                >
                  <option value="zh-CN">中文（简体）</option>
                  <option value="en">English</option>
                </select>
              </div>

              {/* ── 剪贴板行为 ── */}
              <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <SectionHeader className="px-5 pt-5 pb-1 mb-0">{tr('general.clipboard')}</SectionHeader>

                {/* Dedupe toggle */}
                <div className="flex items-center justify-between py-4 px-5 border-b border-zinc-200 dark:border-zinc-800">
                  <div className="flex flex-col">
                    <span className="text-[14px] font-medium text-zinc-800 dark:text-zinc-200">{tr('general.dedupeOnCapture')}</span>
                    <span className="text-[12px] text-zinc-400 dark:text-zinc-500 mt-0.5">{tr('general.dedupeOnCaptureDesc')}</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={dedupeOnCapture}
                    onClick={() => handleToggleDedupe(!dedupeOnCapture)}
                    className={cn(
                      'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                      dedupeOnCapture ? 'bg-[var(--accent)]' : 'bg-zinc-300 dark:bg-zinc-600'
                    )}
                  >
                    <span
                      className={cn(
                        'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
                        dedupeOnCapture ? 'translate-x-4' : 'translate-x-0'
                      )}
                    />
                  </button>
                </div>

                {/* Ignore rules */}
                <div className="px-5 py-4">
                  <p className="text-[13px] text-zinc-700 dark:text-zinc-300">{tr('general.ignoreRules')}</p>
                  <p className="text-[12px] text-zinc-400 dark:text-zinc-500 mt-0.5 mb-3">{tr('general.ignoreRulesDesc')}</p>
                  {ignorePatterns.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {ignorePatterns.map((rule) => (
                        <span
                          key={rule}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] text-zinc-600 dark:text-zinc-400 font-mono"
                        >
                          {rule}
                          <button
                            onClick={() => handleRemoveIgnoreRule(rule)}
                            className="hover:text-red-500 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={ignoreRuleDraft}
                      onChange={(e) => setIgnoreRuleDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); handleAddIgnoreRule() }
                        if (e.key === 'Escape') { e.preventDefault(); setIgnoreRuleDraft('') }
                      }}
                      placeholder={tr('general.ignoreRulesPlaceholder')}
                      className="flex-1 h-7 px-2.5 rounded-md text-xs bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 dark:placeholder-zinc-600 outline-none focus:border-zinc-400 dark:focus:border-zinc-700 transition-colors font-mono"
                    />
                    <button
                      onClick={handleAddIgnoreRule}
                      className="flex-shrink-0 h-7 px-3 rounded-md bg-zinc-800 dark:bg-zinc-700 hover:bg-zinc-700 dark:hover:bg-zinc-600 text-xs text-zinc-200 transition-colors font-medium"
                    >
                      {tr('general.addRule')}
                    </button>
                  </div>
                </div>

              </div>

            </div>
          )}

          {activeMenu === 'fileTransfer' && (
            <div className="space-y-4">
              <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <SectionHeader className="px-5 pt-5 pb-1 mb-0">{tr('ft.title')}</SectionHeader>

                {/* 启用开关 */}
                <div className="flex items-center justify-between py-4 px-5 border-b border-zinc-200 dark:border-zinc-800">
                  <div className="flex flex-col">
                    <span className="text-[14px] font-medium text-zinc-800 dark:text-zinc-200">{tr('ft.enable')}</span>
                    <span className="text-[12px] text-zinc-400 dark:text-zinc-500 mt-0.5">{tr('ft.hint')}</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={ftEnabled}
                    onClick={() => void handleFtToggle(!ftEnabled)}
                    className={cn(
                      'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                      ftEnabled ? 'bg-[var(--accent)]' : 'bg-zinc-300 dark:bg-zinc-600'
                    )}
                  >
                    <span
                      className={cn(
                        'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
                        ftEnabled ? 'translate-x-4' : 'translate-x-0'
                      )}
                    />
                  </button>
                </div>

                {ftEnabled && (
                  <>
                    {/* 端口 */}
                    <div className="flex items-center justify-between py-4 px-5 border-b border-zinc-200 dark:border-zinc-800">
                      <span className="text-[14px] font-medium text-zinc-800 dark:text-zinc-200">{tr('ft.port')}</span>
                      <input
                        className="w-24 h-8 px-2.5 rounded-md text-xs bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 outline-none focus:border-zinc-400 dark:focus:border-zinc-700 transition-colors font-mono text-right"
                        value={ftPortDraft}
                        onChange={(e) => setFtPortDraft(e.target.value.replace(/\D/g, ''))}
                        onBlur={applyFtPort}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            applyFtPort()
                          }
                        }}
                        placeholder="18888"
                      />
                    </div>

                    {/* 本机 IP */}
                    <div className="flex items-center justify-between py-4 px-5 border-b border-zinc-200 dark:border-zinc-800">
                      <span className="text-[14px] font-medium text-zinc-800 dark:text-zinc-200">Local IP</span>
                      <div className="flex items-center gap-1 font-mono text-xs text-zinc-600 dark:text-zinc-300">
                        {availableIps.length > 1 ? (
                          <select
                            className="bg-transparent outline-none cursor-pointer"
                            value={localIp}
                            onChange={(e) => {
                              setLocalIp(e.target.value)
                              void window.electronAPI.ftSetSetting('fileTransferBindIp', e.target.value).then(() => {
                                if (ftEnabled) return window.electronAPI.ftToggle(true, Number(ftPortDraft) || undefined)
                              })
                            }}
                          >
                            {availableIps.map((ip) => (
                              <option key={ip} value={ip}>{ip}</option>
                            ))}
                          </select>
                        ) : (
                          <span>{localIp || '—'}</span>
                        )}
                        <span className="opacity-70">:{ftStatus?.port ?? ftPortDraft}</span>
                      </div>
                    </div>

                    {/* 接收后自动打开 */}
                    <div className="flex items-center justify-between py-4 px-5 border-b border-zinc-200 dark:border-zinc-800">
                      <span className="text-[14px] font-medium text-zinc-800 dark:text-zinc-200">{tr('ft.autoOpen')}</span>
                      <FtSwitch checked={ftSettings.autoOpen} onChange={(v) => void ftSaveSetting('fileTransferAutoOpen', v)} />
                    </div>

                    {/* 自动关闭服务（5 分钟无传输） */}
                    <div className="py-4 px-5 border-b border-zinc-200 dark:border-zinc-800">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[14px] font-medium text-zinc-800 dark:text-zinc-200">{tr('ft.autoClose')}</span>
                          <button
                            className="p-0 bg-transparent border-none cursor-pointer flex items-center opacity-60 hover:opacity-100 text-zinc-500"
                            onClick={() => setShowAutoCloseHint(!showAutoCloseHint)}
                            title=""
                          >
                            <HelpCircle size={13} />
                          </button>
                        </div>
                        <FtSwitch checked={ftSettings.autoClose} onChange={(v) => void ftSaveSetting('fileTransferAutoClose', v)} />
                      </div>
                      {showAutoCloseHint && (
                        <div className="mt-2 p-2.5 rounded-lg bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] border border-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                          {tr('ft.autoCloseHint')}
                        </div>
                      )}
                    </div>

                    {/* 接收后自动复制 */}
                    <div className="flex items-center justify-between py-4 px-5 border-b border-zinc-200 dark:border-zinc-800">
                      <span className="text-[14px] font-medium text-zinc-800 dark:text-zinc-200">{tr('ft.autoCopy')}</span>
                      <FtSwitch checked={ftSettings.autoCopy} onChange={(v) => void ftSaveSetting('fileTransferAutoCopy', v)} />
                    </div>

                    {/* 二维码 */}
                    {localIp && (ftStatus?.port ?? 0) > 0 && (
                      <div className="flex items-center gap-5 py-5 px-5 border-b border-zinc-200 dark:border-zinc-800">
                        <div className="rounded-lg bg-white p-2 border border-zinc-200 dark:border-zinc-700 flex-shrink-0">
                          <QRCodeCanvas value={`http://${localIp}:${ftStatus?.port}`} size={90} />
                        </div>
                        <div className="flex flex-col gap-1 font-mono text-[11px]">
                          <span className="text-[13px] font-bold text-zinc-800 dark:text-zinc-200">{tr('ft.scanToSend')}</span>
                          <span className="text-zinc-400 dark:text-zinc-500">STATUS: <span className="text-emerald-600 dark:text-emerald-500 font-bold">ONLINE</span></span>
                          <span className="text-zinc-400 dark:text-zinc-500">HOST: <span className="text-zinc-700 dark:text-zinc-300">{localIp}</span></span>
                          <span className="text-zinc-400 dark:text-zinc-500">PORT: <span className="text-zinc-700 dark:text-zinc-300">{ftStatus?.port}</span></span>
                        </div>
                      </div>
                    )}

                    {/* 保存路径 */}
                    <div className="py-4 px-5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[14px] font-medium text-zinc-800 dark:text-zinc-200">{tr('ft.savePath')}</span>
                        <button
                          className="h-7 px-3 rounded-md text-xs bg-zinc-800 dark:bg-zinc-700 hover:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-200 transition-colors font-medium"
                          onClick={() => {
                            void window.electronAPI.ftChooseSavePath().then((r) => {
                              if (!r.canceled && r.path) setFtSettings((s) => ({ ...s, path: r.path as string }))
                            })
                          }}
                        >
                          {tr('ft.choose')}
                        </button>
                      </div>
                      <div
                        className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 cursor-pointer truncate"
                        title={ftSettings.path || tr('ft.notSet')}
                        onClick={() => {
                          void window.electronAPI.ftGetActivePath().then((p) => {
                            if (p) void window.electronAPI.ftOpenPath(p)
                          })
                        }}
                      >
                        {ftSettings.path || tr('ft.notSet')}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* 聊天传输视图（对齐 Tiez FileTransferChatView） */}
              {ftEnabled && (
                <FileTransferChat status={ftStatus} localIp={localIp} />
              )}
            </div>
          )}

          {activeMenu === 'appearance' && (
            <div className="space-y-6">
              <div>
                <SectionHeader className="mb-4">{tr('appearance.theme')}</SectionHeader>
                <div className="flex flex-wrap justify-center gap-8">
                  {/* Light theme card */}
                  <button
                    onClick={() => onThemeChange('light')}
                    className={cn(
                      'w-44 rounded-lg border-2 overflow-hidden transition-all',
                      theme === 'light'
                        ? 'border-blue-500 ring-1 ring-blue-500/30'
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700',
                    )}
                  >
                    <div className="bg-white p-3 space-y-2">
                      <div className="h-2 w-16 rounded bg-gray-200" />
                      <div className="flex gap-1.5">
                        <div className="w-8 h-8 rounded bg-gray-100 border border-gray-200" />
                        <div className="flex-1 space-y-1">
                          <div className="h-1.5 w-20 rounded bg-gray-300" />
                          <div className="h-1.5 w-28 rounded bg-gray-200" />
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <div className="w-8 h-8 rounded bg-gray-100 border border-gray-200" />
                        <div className="flex-1 space-y-1">
                          <div className="h-1.5 w-16 rounded bg-gray-300" />
                          <div className="h-1.5 w-24 rounded bg-gray-200" />
                        </div>
                      </div>
                    </div>
                    <div className="px-3 py-2 bg-zinc-50 border-t border-zinc-100">
                      <span className="text-xs font-medium text-zinc-600">{tr('appearance.light')}</span>
                    </div>
                  </button>

                  {/* Dark theme card */}
                  <button
                    onClick={() => onThemeChange('dark')}
                    className={cn(
                      'w-44 rounded-lg border-2 overflow-hidden transition-all',
                      theme === 'dark'
                        ? 'border-blue-500 ring-1 ring-blue-500/30'
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700',
                    )}
                  >
                    <div className="bg-zinc-900 p-3 space-y-2">
                      <div className="h-2 w-16 rounded bg-zinc-700" />
                      <div className="flex gap-1.5">
                        <div className="w-8 h-8 rounded bg-zinc-800 border border-zinc-700" />
                        <div className="flex-1 space-y-1">
                          <div className="h-1.5 w-20 rounded bg-zinc-600" />
                          <div className="h-1.5 w-28 rounded bg-zinc-700" />
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <div className="w-8 h-8 rounded bg-zinc-800 border border-zinc-700" />
                        <div className="flex-1 space-y-1">
                          <div className="h-1.5 w-16 rounded bg-zinc-600" />
                          <div className="h-1.5 w-24 rounded bg-zinc-700" />
                        </div>
                      </div>
                    </div>
                    <div className="px-3 py-2 bg-zinc-800 border-t border-zinc-700">
                      <span className="text-xs font-medium text-zinc-400">{tr('appearance.dark')}</span>
                    </div>
                  </button>

                  {/* Auto theme card */}
                  <button
                    onClick={() => onThemeChange('auto')}
                    className={cn(
                      'w-44 rounded-lg border-2 overflow-hidden transition-all',
                      theme === 'auto'
                        ? 'border-blue-500 ring-1 ring-blue-500/30'
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700',
                    )}
                  >
                    <div className="bg-gradient-to-r from-white from-50% to-zinc-900 to-50% p-3 space-y-2">
                      <div className="h-2 w-16 rounded bg-gradient-to-r from-gray-200 from-50% to-zinc-700 to-50%" />
                      <div className="flex gap-1.5">
                        <div className="w-8 h-8 rounded bg-gradient-to-r from-gray-100 from-50% to-zinc-800 to-50% border border-gray-200" />
                        <div className="flex-1 space-y-1">
                          <div className="h-1.5 w-20 rounded bg-gradient-to-r from-gray-300 from-50% to-zinc-600 to-50%" />
                          <div className="h-1.5 w-28 rounded bg-gradient-to-r from-gray-200 from-50% to-zinc-700 to-50%" />
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <div className="w-8 h-8 rounded bg-gradient-to-r from-gray-100 from-50% to-zinc-800 to-50% border border-gray-200" />
                        <div className="flex-1 space-y-1">
                          <div className="h-1.5 w-16 rounded bg-gradient-to-r from-gray-300 from-50% to-zinc-600 to-50%" />
                          <div className="h-1.5 w-24 rounded bg-gradient-to-r from-gray-200 from-50% to-zinc-700 to-50%" />
                        </div>
                      </div>
                    </div>
                    <div className="px-3 py-2 bg-gradient-to-r from-zinc-50 from-50% to-zinc-800 to-50% border-t border-zinc-100 dark:border-zinc-700">
                      <span className="text-xs font-medium bg-gradient-to-r from-zinc-600 from-50% to-zinc-400 to-50% bg-clip-text text-transparent">{tr('appearance.auto')}</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* ── Accent Color ── */}
              <div className="flex items-center justify-between pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <span className="text-[13px] text-zinc-600 dark:text-zinc-400">{tr('appearance.accent')}</span>
                <div className="flex items-center gap-2">
                  {['blue', 'purple', 'orange', 'green', 'rose', 'amber'].map((color) => {
                    const colorMap: Record<string, string> = {
                      blue: 'bg-blue-500', purple: 'bg-purple-500', orange: 'bg-orange-500',
                      green: 'bg-green-500', rose: 'bg-rose-500', amber: 'bg-amber-500',
                    }
                    return (
                      <button
                        key={color}
                        onClick={() => onAccentChange(color)}
                        className={cn(
                          'w-5 h-5 rounded-full transition-all',
                          colorMap[color],
                          accentColor === color
                            ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900 ring-zinc-400 dark:ring-zinc-500'
                            : 'hover:scale-110',
                        )}
                      />
                    )
                  })}
                </div>
              </div>

              {/* ── List Density ── */}
              <div className="flex items-center justify-between pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <div className="flex flex-col">
                  <span className="text-[13px] text-zinc-600 dark:text-zinc-400">{tr('appearance.density')}</span>
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">{tr('appearance.densityDesc')}</span>
                </div>
                <div className="flex rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                  <button
                    onClick={() => onDensityChange('comfortable')}
                    className={cn(
                      'px-3 py-1 text-xs transition-colors',
                      listDensity === 'comfortable'
                        ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200'
                        : 'bg-transparent text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800',
                    )}
                  >
                    {tr('appearance.densityComfortable')}
                  </button>
                  <button
                    onClick={() => onDensityChange('compact')}
                    className={cn(
                      'px-3 py-1 text-xs transition-colors',
                      listDensity === 'compact'
                        ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200'
                        : 'bg-transparent text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800',
                    )}
                  >
                    {tr('appearance.densityCompact')}
                  </button>
                </div>
              </div>

              {/* ── Density live preview ── */}
              <div className="pt-3">
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-2.5">
                  <div className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 mb-1.5">{tr('appearance.densityPreview')}</div>
                  <div className="space-y-1">
                    {[
                      { title: tr('appearance.previewItem1'), meta: tr('appearance.previewMeta1') },
                      { title: tr('appearance.previewItem2'), meta: tr('appearance.previewMeta2') },
                      { title: tr('appearance.previewItem3'), meta: tr('appearance.previewMeta3') },
                    ].map((m, i) => (
                      <div
                        key={i}
                        className={cn(
                          'rounded-md border border-zinc-200 dark:border-zinc-700/70 bg-white dark:bg-zinc-900 px-3 transition-all',
                          listDensity === 'compact' ? 'py-0.5' : 'py-2',
                        )}
                      >
                        <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate">{m.title}</div>
                        <div className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">{m.meta}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── 单条捕获上限 ── */}
              <div className="flex items-center justify-between pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <div className="flex flex-col">
                  <span className="text-[13px] text-zinc-600 dark:text-zinc-400">{tr('general.maxCapture')}</span>
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">{tr('general.maxCaptureDesc')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    value={maxCaptureKb}
                    onChange={(e) => setMaxCaptureKb(Number(e.target.value) || 0)}
                    onBlur={() => window.electronAPI.setCaptureRules({ maxCaptureKb })}
                    onKeyDown={(e) => { if (e.key === 'Enter') window.electronAPI.setCaptureRules({ maxCaptureKb }) }}
                    className="w-20 h-7 px-2 rounded-md text-xs bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 outline-none focus:border-zinc-400 dark:focus:border-zinc-700 transition-colors font-mono text-right"
                  />
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500">KB</span>
                </div>
              </div>

              {/* ── Typography ── */}
              <div className="flex items-center justify-between pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <div className="flex flex-col">
                  <span className="text-[13px] text-zinc-600 dark:text-zinc-400">{tr('appearance.typography')}</span>
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">{tr('appearance.typographyDesc')}</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={useMonospace}
                  onClick={() => onMonospaceChange(!useMonospace)}
                  className={cn(
                    'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                    useMonospace ? 'bg-[var(--accent)]' : 'bg-zinc-300 dark:bg-zinc-600',
                  )}
                >
                  <span
                    className={cn(
                      'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
                      useMonospace ? 'translate-x-4' : 'translate-x-0',
                    )}
                  />
                </button>
              </div>
            </div>
          )}

          {activeMenu === 'cloudSync' && (
            <div className="space-y-4">
              <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <SectionHeader className="px-5 pt-5 pb-1 mb-0">{tr('settings.cloudSync')}</SectionHeader>

                {/* Cloud sync (WebDAV, multi-device) */}
                <div className="py-4 px-5">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-[14px] font-medium text-zinc-800 dark:text-zinc-200">{tr('general.cloudSync')}</span>
                      <span className="text-[12px] text-zinc-400 dark:text-zinc-500 mt-0.5">{tr('general.cloudSyncDesc')}</span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={cloudCfg.enabled}
                      disabled={cloudBusy}
                      onClick={() => handleToggleCloudSync(!cloudCfg.enabled)}
                      className={cn(
                        'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                        cloudCfg.enabled ? 'bg-[var(--accent)]' : 'bg-zinc-300 dark:bg-zinc-600'
                      )}
                    >
                      <span
                        className={cn(
                          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
                          cloudCfg.enabled ? 'translate-x-4' : 'translate-x-0'
                        )}
                      />
                    </button>
                  </div>

                  {(cloudCfg.enabled || showCloudForm) && (
                    <div className="mt-3 space-y-2">
                      <input
                        value={cloudCfg.webdavUrl}
                        onChange={(e) => setCloudCfg({ ...cloudCfg, webdavUrl: e.target.value })}
                        placeholder="https://dav.jianguoyun.com/dav/"
                        spellCheck={false}
                        className="w-full h-7 px-2.5 rounded-md text-xs bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 dark:placeholder-zinc-600 outline-none focus:border-zinc-400 dark:focus:border-zinc-700 transition-colors font-mono"
                      />
                      <div className="flex gap-2">
                        <input
                          value={cloudCfg.username}
                          onChange={(e) => setCloudCfg({ ...cloudCfg, username: e.target.value })}
                          placeholder={tr('general.cloudSyncUser')}
                          spellCheck={false}
                          autoComplete="off"
                          className="flex-1 h-7 px-2.5 rounded-md text-xs bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 dark:placeholder-zinc-600 outline-none focus:border-zinc-400 dark:focus:border-zinc-700 transition-colors"
                        />
                        <input
                          type="password"
                          value={cloudCfg.password}
                          onChange={(e) => setCloudCfg({ ...cloudCfg, password: e.target.value })}
                          placeholder={tr('general.cloudSyncPwd')}
                          autoComplete="new-password"
                          className="flex-1 h-7 px-2.5 rounded-md text-xs bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 dark:placeholder-zinc-600 outline-none focus:border-zinc-400 dark:focus:border-zinc-700 transition-colors"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          value={cloudCfg.basePath}
                          onChange={(e) => setCloudCfg({ ...cloudCfg, basePath: e.target.value })}
                          placeholder="qpaste-sync"
                          spellCheck={false}
                          title={tr('general.cloudSyncBase')}
                          className="w-32 h-7 px-2.5 rounded-md text-xs bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 dark:placeholder-zinc-600 outline-none focus:border-zinc-400 dark:focus:border-zinc-700 transition-colors font-mono"
                        />
                        <input
                          type="number"
                          min={0}
                          max={3600}
                          value={cloudCfg.intervalSecs}
                          onChange={(e) => setCloudCfg({ ...cloudCfg, intervalSecs: Number(e.target.value) || 0 })}
                          title={tr('general.cloudSyncInterval')}
                          className="w-20 h-7 px-2.5 rounded-md text-xs bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 outline-none focus:border-zinc-400 dark:focus:border-zinc-700 transition-colors"
                        />
                        <button
                          onClick={() => void handleToggleCloudSync(true)}
                          disabled={cloudBusy}
                          className="flex-shrink-0 h-7 px-3 rounded-md bg-zinc-800 dark:bg-zinc-700 hover:bg-zinc-700 dark:hover:bg-zinc-600 disabled:opacity-50 text-xs text-zinc-200 transition-colors font-medium"
                        >
                          {tr('general.cloudSyncSave')}
                        </button>
                        <button
                          onClick={handleCloudSyncNow}
                          disabled={cloudBusy}
                          className="flex-shrink-0 h-7 px-3 rounded-md bg-zinc-800 dark:bg-zinc-700 hover:bg-zinc-700 dark:hover:bg-zinc-600 disabled:opacity-50 text-xs text-zinc-200 transition-colors font-medium"
                        >
                          {tr('general.cloudSyncNow')}
                        </button>
                      </div>

                      {cloudErr && (
                        <span className="block text-[11px] text-red-500 dark:text-red-400">{cloudErr}</span>
                      )}
                      {cloudStatus && (
                        <div className="text-[11px] leading-relaxed">
                          <span className={cloudStatus.lastError ? 'text-red-500 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-500'}>
                            {cloudStatus.lastError || tr('general.cloudSyncOn')}
                          </span>
                          <span className="block text-zinc-400 dark:text-zinc-500">
                            {tr('general.cloudSyncLast', { time: cloudStatus.lastSyncAt ? new Date(cloudStatus.lastSyncAt).toLocaleString() : '—' })}
                          </span>
                          <span className="block text-zinc-400 dark:text-zinc-500">
                            {tr('general.cloudSyncStat', { n: cloudStatus.receivedItems, m: cloudStatus.uploadedItems })}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeMenu === 'storage' && (
            <div className="space-y-8">
              <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <SectionHeader className="px-5 pt-5 pb-1 mb-0">{tr('storage.dbTool')}</SectionHeader>
                <div className="flex items-center justify-between py-4 px-5">
                  <div className="flex flex-col">
                    <span className="text-[14px] font-medium text-zinc-800 dark:text-zinc-200">{tr('storage.dbCheck')}</span>
                    <span className="text-[12px] text-zinc-400 dark:text-zinc-500 mt-0.5">{tr('about.logsDesc')}</span>
                  </div>
                  <button
                    className="flex-shrink-0 h-7 px-3 rounded-md text-xs bg-zinc-800 dark:bg-zinc-700 hover:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-200 transition-colors font-medium"
                    onClick={async () => {
                      const r = await window.electronAPI.checkDatabase()
                      onToast?.(tr(r.ok ? 'storage.dbCheckOk' : 'storage.dbCheckBad', { count: r.count, integrity: r.integrity, size: r.size }))
                    }}
                  >
                    {tr('storage.dbCheck')}
                  </button>
                </div>
              </div>
              {/* ── Database status card ── */}
              {(() => {
                const textBytes = storageUsage?.textBytes ?? 0
                const imageBytes = storageUsage?.imageBytes ?? 0
                const totalBytes = storageUsage?.totalBytes ?? 0
                const fmt = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`
                const usedBytes = textBytes + imageBytes
                const textPct = usedBytes > 0 ? (textBytes / usedBytes) * 100 : 0
                const imagePct = usedBytes > 0 ? (imageBytes / usedBytes) * 100 : 0

                return (
              <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl p-5 border border-zinc-200 dark:border-zinc-800">
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <p className="text-[13px] text-zinc-500 dark:text-zinc-500 mb-1">{tr('storage.dbUsage')}</p>
                    <p className="text-2xl font-semibold text-zinc-800 dark:text-zinc-200">{fmt(usedBytes)}</p>
                    <p className="text-[12px] text-zinc-400 dark:text-zinc-600 mt-1">{tr('storage.textData')} {fmt(textBytes)} · {tr('storage.imageData')} {fmt(imageBytes)}</p>
                  </div>
                  <div className="flex-1 max-w-[280px] pt-2">
                    <div className="flex h-5 rounded-full overflow-hidden bg-zinc-200 dark:bg-zinc-800">
                      {textPct > 0 && <div className="bg-blue-500/70 transition-all" style={{ width: `${textPct}%` }} title={`${tr('storage.textData')} ${fmt(textBytes)}`} />}
                      {imagePct > 0 && <div className="bg-green-500/70 transition-all" style={{ width: `${imagePct}%` }} title={`${tr('storage.imageData')} ${fmt(imageBytes)}`} />}
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-blue-500/70" />
                        <span className="text-zinc-500 dark:text-zinc-500">{tr('storage.textData')} {fmt(textBytes)}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-green-500/70" />
                        <span className="text-zinc-500 dark:text-zinc-500">{tr('storage.imageData')} {fmt(imageBytes)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
                )
              })()}

              {/* ── Storage path ── */}
              <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl p-5 border border-zinc-200 dark:border-zinc-800">
                <SectionHeader className="mb-1">{tr('storage.path')}</SectionHeader>
                <p className="text-[12px] text-zinc-400 dark:text-zinc-600 mb-4">{tr('storage.pathHint')}</p>
                <div className="flex items-stretch gap-2">
                  <input
                    type="text"
                    readOnly
                    value={storagePath}
                    className="flex-1 h-8 px-3 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md text-xs text-zinc-600 dark:text-zinc-400 outline-none cursor-default select-all font-mono"
                  />
                  <button
                    onClick={handleChangeDir}
                    className="flex-shrink-0 h-8 px-4 rounded-md bg-zinc-800 dark:bg-zinc-700 hover:bg-zinc-700 dark:hover:bg-zinc-600 text-xs text-zinc-200 transition-colors font-medium"
                  >
                    {tr('storage.changeDir')}
                  </button>
                  <button
                    onClick={handleOpenFolder}
                    className="flex-shrink-0 h-8 px-3 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs text-zinc-600 dark:text-zinc-400 transition-colors flex items-center gap-1"
                  >
                    <span>{tr('storage.openFolder')}</span>
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </button>
                </div>
                <p className="text-[11px] text-amber-600/80 dark:text-amber-500/70 mt-2">
                  {tr('storage.pathWarning')}
                </p>
              </div>

              {/* ── Retention rules ── */}
              <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl p-5 border border-zinc-200 dark:border-zinc-800">
                <SectionHeader className="mb-1">{tr('storage.retention')}</SectionHeader>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mb-4">{tr('storage.retentionHint')}</p>
                <div className="space-y-4">
                  {/* Retention time */}
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-zinc-600 dark:text-zinc-400">{tr('storage.retentionTime')}</span>
                    <select
                      value={retentionDays}
                      onChange={(e) => handleRetentionChange(e.target.value)}
                      className="h-7 px-2.5 rounded-md text-xs bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 outline-none focus:border-zinc-400 dark:focus:border-zinc-700 appearance-none cursor-pointer"
                    >
                      <option value="7">{tr('storage.retention7d')}</option>
                      <option value="30">{tr('storage.retention30d')}</option>
                      <option value="90">{tr('storage.retention90d')}</option>
                      <option value="forever">{tr('storage.retentionForever')}</option>
                    </select>
                  </div>

                  {/* Max records */}
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-zinc-600 dark:text-zinc-400">{tr('storage.maxRecords')}</span>
                    <div className="flex items-center">
                      <button
                        onClick={() => handleMaxRecordsChange(maxRecords - 100)}
                        className="w-6 h-7 flex items-center justify-center rounded-l-md border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <input
                        type="number"
                        value={maxRecords}
                        onChange={(e) => handleMaxRecordsChange(Number(e.target.value) || 100)}
                        className="w-16 h-7 text-center bg-zinc-50 dark:bg-zinc-950 border-y border-zinc-200 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <button
                        onClick={() => handleMaxRecordsChange(maxRecords + 100)}
                        className="w-6 h-7 flex items-center justify-center rounded-r-md border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Data backup ── */}
              <div>
                <SectionHeader className="mb-4">{tr('storage.backup')}</SectionHeader>
                <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800">
                  <div className="flex items-center justify-between p-5">
                    <div>
                      <p className="text-[13px] text-zinc-700 dark:text-zinc-300">{tr('storage.backupDb')}</p>
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">{tr('storage.backupDbHint')}</p>
                    </div>
                    <button
                      onClick={async () => {
                        if (typeof window === 'undefined' || !window.electronAPI) return
                        const res = await window.electronAPI.exportDb()
                        if (res.success && res.path) alert(tr('storage.backupOk', { path: res.path }))
                        else if (!res.canceled) alert(tr('storage.backupErr', { error: res.error || 'unknown' }))
                      }}
                      className="flex-shrink-0 h-8 px-4 rounded-md bg-zinc-800 dark:bg-zinc-700 hover:bg-zinc-700 dark:hover:bg-zinc-600 text-xs text-zinc-200 transition-colors font-medium"
                    >
                      {tr('storage.backupDb')}
                    </button>
                  </div>
                  <div className="flex items-center justify-between p-5">
                    <div>
                      <p className="text-[13px] text-zinc-700 dark:text-zinc-300">{tr('storage.exportJson')}</p>
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">{tr('storage.exportJsonHint')}</p>
                    </div>
                    <button
                      onClick={async () => {
                        if (typeof window === 'undefined' || !window.electronAPI) return
                        const res = await window.electronAPI.exportJson()
                        if (res.success && res.path) alert(tr('storage.exportOk', { path: res.path }))
                        else if (!res.canceled) alert(tr('storage.exportErr', { error: res.error || 'unknown' }))
                      }}
                      className="flex-shrink-0 h-8 px-4 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs text-zinc-600 dark:text-zinc-400 transition-colors font-medium"
                    >
                      {tr('storage.exportJson')}
                    </button>
                  </div>
                  <div className="flex items-center justify-between p-5">
                    <div>
                      <p className="text-[13px] text-zinc-700 dark:text-zinc-300">{tr('storage.importJson')}</p>
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">{tr('storage.importJsonHint')}</p>
                    </div>
                    <button
                      onClick={async () => {
                        if (typeof window === 'undefined' || !window.electronAPI) return
                        const res = await window.electronAPI.importJson()
                        if (res.success) {
                          if ((res.count ?? 0) > 0) {
                            alert(tr('storage.importOk', { count: res.count ?? 0 }))
                            await onDataImported()
                          } else if ((res.duplicates ?? 0) > 0) {
                            // 全部为已存在记录：明确告知数据没丢，不是导入失败
                            alert(tr('storage.importAllDup', { count: res.duplicates ?? 0 }))
                            await onDataImported()
                          } else {
                            alert(tr('storage.importOk', { count: 0 }))
                          }
                        } else if (!res.canceled) {
                          alert(tr('storage.importErr', { error: res.error || 'unknown' }))
                        }
                      }}
                      className="flex-shrink-0 h-8 px-4 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs text-zinc-600 dark:text-zinc-400 transition-colors font-medium"
                    >
                      {tr('storage.importJson')}
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Danger zone ── */}
              <div>
                <SectionHeader className="mb-4 !text-red-500/80 dark:!text-red-500/70">{tr('storage.dangerZone')}</SectionHeader>
                <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-red-500/15 dark:border-red-500/10 p-5 space-y-5">
                  {/* Clear image cache — 原生 button */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[13px] text-zinc-700 dark:text-zinc-300">{tr('storage.clearImages')}</p>
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">{tr('storage.clearImagesHint')}</p>
                    </div>
                    <button
                      style={{ fontSize: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: 'transparent', color: '#52525b', cursor: 'pointer' }}
                      onClick={async () => {
                        if (!(await confirm(tr('storage.clearImagesConfirm'), { danger: true, confirmText: tr('storage.clear') }))) return
                        try {
                          const res = await window.electronAPI.forceClearData('images')
                          if (res.success) {
                            alert(tr('storage.clearImagesDone'))
                            window.electronAPI.getStorageUsage().then(setStorageUsage)
                            onClearData('images')
                          } else {
                            alert(tr('storage.clearFailed', { error: res.error || 'unknown' }))
                          }
                        } catch (e: any) {
                          alert(tr('storage.ipcError', { error: e?.message ?? String(e) }))
                        }
                      }}
                    >
                      {tr('storage.clear')}
                    </button>
                  </div>

                  {/* Clear all — 原生 button */}
                  <div className="flex items-center justify-between pt-4 border-t border-zinc-200 dark:border-zinc-800/50">
                    <div>
                      <p className="text-[13px] text-zinc-700 dark:text-zinc-300">{tr('storage.clearAll')}</p>
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-0.5">{tr('storage.clearAllHint')}</p>
                    </div>
                    <button
                      style={{ fontSize: 12, padding: '6px 16px', borderRadius: 6, border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer' }}
                      onClick={async () => {
                        if (!(await confirm(tr('storage.clearAllConfirm'), { danger: true, confirmText: tr('storage.clearAllBtn') }))) return
                        try {
                          const res = await window.electronAPI.forceClearData('all')
                          if (res.success) {
                            alert(tr('storage.clearAllDone'))
                            window.electronAPI.getStorageUsage().then(setStorageUsage)
                            onClearData('all')
                          } else {
                            alert(tr('storage.clearFailed', { error: res.error || 'unknown' }))
                          }
                        } catch (e: any) {
                          alert(tr('storage.ipcError', { error: e?.message ?? String(e) }))
                        }
                      }}
                    >
                      {tr('storage.clearAllBtn')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeMenu === 'shortcuts' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-200 dark:border-zinc-800/50">
                <span className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">{tr('shortcuts.localTitle')}</span>
                <button
                  onClick={handleResetShortcuts}
                  className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  {tr('shortcuts.reset')}
                </button>
              </div>

              {/* 本地快捷键（点击即可录制） */}
              {SHORTCUT_ACTIONS.map((action) => {
                const isRecording = recordingAction === action
                return (
                  <div key={action} className="flex items-center justify-between py-2 border-b border-zinc-200 dark:border-zinc-800/50">
                    <span className="text-[13px] text-zinc-600 dark:text-zinc-400">{shortcutLabel(action)}</span>
                    <button
                      onClick={() => {
                        if (isRecording) { setRecordingAction(null); return }
                        setRecordingAction(action)
                      }}
                      style={isRecording ? { backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)' } : undefined}
                      className={cn(
                        'text-[11px] px-2 py-0.5 rounded font-mono transition-all cursor-pointer select-none min-w-[64px] text-center',
                        isRecording
                          ? 'text-[var(--accent)] ring-1 ring-[var(--accent)]/50'
                          : 'text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700',
                      )}
                      title={tr('shortcuts.clickToRecord')}
                    >
                      {isRecording ? '...' : shortcuts[action]}
                    </button>
                  </div>
                )
              })}

              {/* 全局快捷键（呼出/隐藏窗口） */}
              <div className="flex items-center justify-between py-2">
                <span className="text-[13px] text-zinc-600 dark:text-zinc-400">{tr('shortcuts.toggleWindow')}</span>
                <button
                  onClick={() => setShortcutRecording(true)}
                  style={shortcutRecording ? { backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)' } : undefined}
                  className={cn(
                    'text-[11px] px-2 py-0.5 rounded font-mono transition-all cursor-pointer select-none min-w-[64px] text-center',
                    shortcutRecording
                      ? 'text-[var(--accent)] ring-1 ring-[var(--accent)]/50'
                      : 'text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700',
                  )}
                >
                  {shortcutRecording ? '...' : toggleShortcut}
                </button>
              </div>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-600">{tr('shortcuts.hint')}</p>
            </div>
          )}

          {activeMenu === 'about' && (
            <div className="h-full flex flex-col gap-3">
              {/* ── 品牌区：图标 + 名称 + 标语（对齐 ElegantClipboard 关于页） ── */}
              <div className="flex-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 flex flex-col justify-center overflow-auto">
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="h-16 w-16 rounded-md overflow-hidden bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                    <ClipboardList className="w-8 h-8 text-zinc-500 dark:text-zinc-400" />
                  </div>
                  <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100">Q-Paste</h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-xs">{tr('about.tagline')}</p>
                </div>
              </div>

              {/* ── 作者信息卡片 ── */}
              <div className="flex-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 flex flex-col overflow-auto">
                <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3">{tr('about.authorTitle')}</h3>
                <div className="space-y-2 flex-1 flex flex-col justify-center">
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">{tr('about.author')}</span>
                    </div>
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">潇风风</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <Github className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">GitHub</span>
                    </div>
                    <button
                      onClick={() => openUrl('https://github.com/xiaofeng3539')}
                      className="text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:underline"
                    >
                      @xiaofeng3539
                    </button>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <Star className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">{tr('about.star')}</span>
                    </div>
                    <button
                      onClick={() => openUrl('https://github.com/xiaofeng3539/Q-Paste')}
                      className="text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:underline"
                    >
                      Q-Paste
                    </button>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">{tr('about.feedback')}</span>
                    </div>
                    <button
                      onClick={() => openUrl('https://github.com/xiaofeng3539/Q-Paste/issues')}
                      className="text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:underline"
                    >
                      {tr('about.submitIssue')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
