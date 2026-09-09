import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import NavBar from './components/NavBar'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import DetailView from './components/DetailView'
import Settings from './components/Settings'
import { ClipboardItem, ClipboardChangedData, ItemType } from './types'
import { mockItems } from './mock'
import { Lang, loadLang, setLang, tr } from './i18n'
import { detectSensitive, stripHtml, cn } from './lib/utils'
import { searchIncludes } from './lib/search'
import { useDialog } from './components/DialogProvider'
import { loadShortcuts, saveShortcuts, matchShortcut, ShortcutAction } from './lib/shortcuts'

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

type Theme = 'light' | 'dark' | 'auto'
type AccentColor = 'blue' | 'purple' | 'orange' | 'green' | 'rose' | 'amber'
type ListDensity = 'comfortable' | 'compact'
type ActiveTab = 'history' | 'vault'

export const ACCENT_MAP: Record<AccentColor, string> = {
  blue: '#3b82f6', purple: '#a855f7', orange: '#f97316',
  green: '#22c55e', rose: '#f43f5e', amber: '#f59e0b',
}

/** 主界面分栏宽度约束：左侧栏最小 / 右侧详情最小 / 默认宽 */
const SIDEBAR_MIN_WIDTH = 200
const DETAIL_MIN_WIDTH = 400
const SIDEBAR_DEFAULT_WIDTH = 200
/** 导航列宽度（NavBar w-[52px]） */
const NAV_WIDTH_PX = 52
/** 分隔条(6) + 左右两侧内边距（Column2 pr-2 8 + Column3 pl-2/pr-4 24）≈ 38 */
const RESIZE_GAP_PX = 38

function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem('q-paste-theme')
    if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored
  } catch {}
  return 'dark'
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

function saveTheme(theme: Theme) {
  try { localStorage.setItem('q-paste-theme', theme) } catch {}
}

function safeParseJson(str: string, fallback: any): any {
  try { return JSON.parse(str) } catch { return fallback }
}

/** 规范化数据库字段到前端模型 */
function normalizeItems(rows: any[]): ClipboardItem[] {
  return rows.map((row: any) => ({
    ...row,
    is_pinned: row.is_pinned === 1 || row.is_pinned === true,
    alias: row.alias || '',
    tags: Array.isArray(row.tags) ? row.tags : safeParseJson(row.tags, []),
    is_sensitive: row.is_sensitive === 1 || row.is_sensitive === true,
  })) as ClipboardItem[]
}

/** 金库排序：收藏时间倒序（后收藏的排最前），旧数据无收藏时间按复制时间兜底 */
function pinTimeOf(it: ClipboardItem): string {
  return it.pinned_at || it.created_at
}
function compareByPinTime(a: ClipboardItem, b: ClipboardItem): number {
  const byTime = pinTimeOf(b).localeCompare(pinTimeOf(a))
  return byTime !== 0 ? byTime : b.id - a.id
}
function compareByVaultOrder(a: ClipboardItem, b: ClipboardItem): number {
  const ao = a.vault_sort_order ?? 0
  const bo = b.vault_sort_order ?? 0
  if (ao !== bo) return bo - ao
  return compareByPinTime(a, b)
}

export default function App() {
  const [items, setItems] = useState<ClipboardItem[]>(isElectron ? [] : mockItems)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [language, setLanguage] = useState<Lang>(loadLang)
  const [accentColor, setAccentColor] = useState<AccentColor>(() => {
    try { return (localStorage.getItem('q-paste-accent') as AccentColor) || 'blue' } catch { return 'blue' }
  })
  const [listDensity, setListDensity] = useState<ListDensity>(() => {
    try { return (localStorage.getItem('q-paste-density') as ListDensity) || 'comfortable' } catch { return 'comfortable' }
  })
  const [useMonospace, setUseMonospace] = useState(() => {
    try { return localStorage.getItem('q-paste-monospace') !== 'false' } catch { return true }
  })
  const [autoHideOnCopy, setAutoHideOnCopy] = useState(() => {
    try { return localStorage.getItem('q-paste-autohide') === 'true' } catch { return false }
  })
  /** 本地快捷键配置（自定义，持久化 localStorage） */
  const [shortcuts, setShortcuts] = useState(loadShortcuts)
  /** DB 层搜索结果（搜索时优先展示；清空搜索后置回 null 恢复本地列表） */
  const [searchResults, setSearchResults] = useState<ClipboardItem[] | null>(null)
  /** 标签过滤：非空时只显示带该标签的记录 */
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  /** 类型过滤：非 all 时只显示该类型的记录 */
  const [typeFilter, setTypeFilter] = useState<ItemType | 'all'>('all')
  /** 批量多选：选中的记录 id 集合（空集合表示未进入多选态） */
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set())
  /** 收藏项删除确认态：记录等待二次确认删除的 id（按两次 D / 点两次删除按钮） */
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const pendingDeleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    try { return (localStorage.getItem('q-paste-tab') as ActiveTab) || 'history' } catch { return 'history' }
  })
  /** 主界面左侧栏宽度（可拖拽分隔条调整，持久化 localStorage） */
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem('q-paste-sidebar-width'))
      if (v >= SIDEBAR_MIN_WIDTH) {
        // 启动时同样按窗口宽度收紧上限，防止旧存储值超限撑爆布局
        const max = window.innerWidth - NAV_WIDTH_PX - DETAIL_MIN_WIDTH - RESIZE_GAP_PX
        return Math.min(v, Math.max(SIDEBAR_MIN_WIDTH, max))
      }
    } catch {}
    return SIDEBAR_DEFAULT_WIDTH
  })
  const [isResizing, setIsResizing] = useState(false)
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { confirm } = useDialog()

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', ACCENT_MAP[accentColor])
    try { localStorage.setItem('q-paste-accent', accentColor) } catch {}
  }, [accentColor])

  useEffect(() => {
    try { localStorage.setItem('q-paste-density', listDensity) } catch {}
  }, [listDensity])

  useEffect(() => {
    try { localStorage.setItem('q-paste-monospace', String(useMonospace)) } catch {}
  }, [useMonospace])

  useEffect(() => {
    try { localStorage.setItem('q-paste-autohide', String(autoHideOnCopy)) } catch {}
  }, [autoHideOnCopy])

  // 快捷键变更时持久化
  useEffect(() => {
    saveShortcuts(shortcuts)
  }, [shortcuts])

  /** 更新某个快捷键动作的按键 */
  const handleShortcutChange = useCallback((action: ShortcutAction, combo: string) => {
    setShortcuts((prev) => ({ ...prev, [action]: combo }))
  }, [])

  useEffect(() => {
    try { localStorage.setItem('q-paste-tab', activeTab) } catch {}
  }, [activeTab])

  // 左侧栏宽度持久化
  useEffect(() => {
    try { localStorage.setItem('q-paste-sidebar-width', String(sidebarWidth)) } catch {}
  }, [sidebarWidth])

  // 窗口缩放时校正侧栏宽度上限，防止右侧详情区被挤出
  useEffect(() => {
    const onResize = () => {
      const max = window.innerWidth - NAV_WIDTH_PX - DETAIL_MIN_WIDTH - RESIZE_GAP_PX
      setSidebarWidth((w) => Math.min(Math.max(SIDEBAR_MIN_WIDTH, w), Math.max(SIDEBAR_MIN_WIDTH, max)))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /** 拖拽分隔条开始：记录起始位置与宽度，进入拖拽态 */
  const handleResizeStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    resizeRef.current = { startX: e.clientX, startWidth: sidebarWidth }
    setIsResizing(true)
  }

  // 拖拽中：跟随鼠标实时更新宽度（含左右最小宽度限制）
  useEffect(() => {
    if (!isResizing) return
    function onMouseMove(e: MouseEvent) {
      if (!resizeRef.current) return
      const next = resizeRef.current.startWidth + (e.clientX - resizeRef.current.startX)
      const max = window.innerWidth - NAV_WIDTH_PX - DETAIL_MIN_WIDTH - RESIZE_GAP_PX
      setSidebarWidth(Math.min(Math.max(SIDEBAR_MIN_WIDTH, next), Math.max(SIDEBAR_MIN_WIDTH, max)))
    }
    function onMouseUp() {
      resizeRef.current = null
      setIsResizing(false)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isResizing])

  useEffect(() => { setLang(language) }, [language])

  useEffect(() => {
    const root = document.documentElement
    const resolved = resolveTheme(theme)
    if (resolved === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    saveTheme(theme)
  }, [theme])

  // Listen for system theme changes when in auto mode
  useEffect(() => {
    if (theme !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    function onChange() {
      const root = document.documentElement
      if (mq.matches) {
        root.classList.add('dark')
      } else {
        root.classList.remove('dark')
      }
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  function showToast(msg: string) {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 1500)
  }

  useEffect(() => {
    if (!isElectron) return
    window.electronAPI.getItems({ limit: 500, offset: 0 }).then((loaded) => {
      const normalized = normalizeItems(loaded)
      setItems(normalized)
      if (normalized.length > 0) {
        setSelectedId(normalized[0].id)
      }
    })
  }, [])

  // DB 层全文搜索（防抖）：搜索全部历史/金库，不再局限于已加载的 500 条
  useEffect(() => {
    if (!isElectron) return
    const q = searchQuery.trim()
    if (!q) {
      setSearchResults(null)
      return
    }
    const timer = setTimeout(async () => {
      let loaded: ClipboardItem[] = []
      if (isElectron) {
        const dbRes = await window.electronAPI.getItems({ limit: 300, offset: 0, search: q, pinnedOnly: activeTab === 'vault' })
        loaded = normalizeItems(dbRes)
      }
      // 拼音搜索：对本地已加载条目（最近 500 条）额外做拼音/子串匹配，与 DB 结果去重合并
      const known = new Set(loaded.map((it) => it.id))
      const localHits = items.filter(
        (it) => !known.has(it.id) && (it.is_pinned || activeTab !== 'vault') && searchIncludes(it.preview + '\n' + it.content, q),
      )
      if (localHits.length) loaded = [...loaded, ...localHits]
      setSearchResults(loaded)
    }, 250)
    return () => clearTimeout(timer)
  }, [searchQuery, activeTab, items])

  useEffect(() => {
    if (!isElectron) return
    const cleanup = window.electronAPI.onClipboardChanged(async (data: ClipboardChangedData & { fromFt?: boolean; fromOversize?: boolean; id?: number }) => {
      // 来自文件传输/超大文本确认入库的内容已在主进程入库，直接更新列表，不再重复插入
      if ((data.fromFt || data.fromOversize) && data.id !== undefined) {
        const newItem: ClipboardItem = {
          id: data.id,
          type: data.type,
          content: data.content,
          preview: data.preview,
          char_count: data.charCount ?? 0,
          storage_size: data.storageSize ?? 0,
          created_at: data.createdAt,
          is_pinned: false,
          alias: '',
          tags: [],
          is_sensitive: false,
        }
        setItems((prev) => [newItem, ...prev])
        setSelectedId(data.id)
        setPendingDeleteId(null)
        showToast(tr('toast.ftReceived', { preview: data.preview }))
        return
      }

      // 敏感检测：HTML 先转纯文本再检测（避免标签干扰），图片/文件列表不检测
      const contentForCheck = data.type === 'html' ? stripHtml(data.content) : data.content
      const isSensitive = (data.type === 'text' || data.type === 'url' || data.type === 'html') && detectSensitive(contentForCheck)
      let res: { id: number; updated: boolean } | null = null
      try {
        res = await window.electronAPI.insertItem({
          type: data.type,
          content: data.content,
          preview: data.preview,
          charCount: data.charCount ?? 0,
          storageSize: data.storageSize ?? 0,
          createdAt: data.createdAt,
          isSensitive,
        })
      } catch (err: any) {
        console.error('[Q-Paste] 插入记录失败:', err)
        return
      }
      if (!res) return
      const id = res.id
      if (res.updated) {
        // 内容去重/富文本归一：复用已有记录并置顶（类型与内容同步更新，如 text 升级为 html）
        setItems((prev) => {
          const existing = prev.find((it) => it.id === id)
          if (!existing) return prev
          const updated: ClipboardItem = {
            ...existing,
            type: data.type,
            content: data.content,
            preview: data.preview,
            char_count: data.charCount ?? 0,
            storage_size: data.storageSize ?? 0,
            created_at: data.createdAt,
          }
          return [updated, ...prev.filter((it) => it.id !== id)]
        })
        setSelectedId(id)
        setPendingDeleteId(null)
        showToast(tr('toast.repinned'))
        return
      }
      const newItem: ClipboardItem = {
        id,
        type: data.type,
        content: data.content,
        preview: data.preview,
        char_count: data.charCount ?? 0,
        storage_size: data.storageSize ?? 0,
        created_at: data.createdAt,
        is_pinned: false,
        alias: '',
        tags: [],
        is_sensitive: isSensitive,
      }
      setItems((prev) => [newItem, ...prev])
      setSelectedId(id)
      setPendingDeleteId(null)
      if (isSensitive) {
        showToast(tr('toast.sensitiveDetected'))
      } else {
        showToast(tr('toast.captured'))
      }
    })
    return cleanup
  }, [])

  // 云端同步：主进程入库后的远端记录直接并入列表（按 id 去重，最新在前）
  useEffect(() => {
    if (!isElectron) return
    const cleanup = window.electronAPI.onCloudSyncPulled((rows) => {
      if (!rows.length) return
      setItems((prev) => {
        const known = new Set(prev.map((it) => it.id))
        const incoming = rows
          .filter((r) => !known.has(r.id))
          .map((r) => ({
            id: r.id,
            type: r.type as ClipboardItem['type'],
            content: r.content,
            preview: r.preview,
            char_count: r.charCount,
            storage_size: r.storageSize,
            created_at: r.createdAt,
            is_pinned: false,
            alias: '',
            tags: [],
            is_sensitive: false,
          }))
        return [...incoming.reverse(), ...prev]
      })
      showToast(tr('toast.cloudSyncPulled', { n: rows.length }))
    })
    return cleanup
  }, [])

  // 超大文本：等待用户选择「完整保留 / 截断保留」（主进程捕获到超限内容时触发）
  const [oversizePending, setOversizePending] = useState<{ content: string; kb: number } | null>(null)
  useEffect(() => {
    if (!isElectron) return
    const cleanup = window.electronAPI.onOversizeConfirm?.((info) => setOversizePending(info))
    return cleanup
  }, [])

  async function handleOversizeChoice(truncate: boolean) {
    if (!oversizePending) return
    const res = await window.electronAPI.insertOversize(oversizePending.content, truncate)
    setOversizePending(null)
    if (res?.id) setSelectedId(res.id)
  }

  // 数据库完整性异常提示（启动自愈检查发现时）
  const [dbIssue, setDbIssue] = useState(false)
  useEffect(() => {
    if (!isElectron) return
    const cleanup = window.electronAPI.onDbIntegrityIssue?.(() => {
      setDbIssue(true)
      showToast(tr('toast.dbIntegrity'))
    })
    return cleanup
  }, [])

  // Tray menu: open settings
  useEffect(() => {
    if (!isElectron) return
    const cleanup = window.electronAPI.onOpenSettings(() => setShowSettings(true))
    return cleanup
  }, [])

  const selectedItem = useMemo(
    () => items.find((it) => it.id === selectedId) ?? null,
    [items, selectedId]
  )

  const filteredItems = useMemo(() => {
    // 搜索模式下优先展示 DB 搜索结果（非 Electron 环境退回本地过滤）
    let list: ClipboardItem[]
    const q = searchQuery.trim()
    if (searchResults && isElectron) {
      list = searchResults
    } else if (!q) {
      list = items
    } else {
      list = items.filter((it) => searchIncludes(it.preview + '\n' + it.content, q))
    }
    // 类型过滤
    if (typeFilter !== 'all') {
      list = list.filter((it) => it.type === typeFilter)
    }
    // 标签过滤
    if (selectedTag) {
      list = list.filter((it) => it.tags.includes(selectedTag))
    }
    return list
  }, [items, searchQuery, searchResults, selectedTag, typeFilter, isElectron])

  const vaultItems = useMemo(() => {
    let list = items
      .filter((it) => it.is_pinned)
      .sort(compareByVaultOrder)
    // 类型过滤
    if (typeFilter !== 'all') {
      list = list.filter((it) => it.type === typeFilter)
    }
    // 标签过滤
    if (selectedTag) {
      list = list.filter((it) => it.tags.includes(selectedTag))
    }
    return list
  }, [items, selectedTag, typeFilter])

  /** 全部标签（用于标签过滤 chips），按出现次数降序 */
  const allTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const it of items) {
      for (const tag of it.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag]) => tag)
  }, [items])

  // 金库搜索时优先展示 DB 搜索结果（pinnedOnly），且搜索结果同样应用标签/类型过滤；否则展示本地收藏列表
  const sidebarItems = useMemo(() => {
    if (activeTab === 'vault') {
      if (searchResults) {
        let list = searchResults
        if (typeFilter !== 'all') list = list.filter((it) => it.type === typeFilter)
        if (selectedTag) list = list.filter((it) => it.tags.includes(selectedTag))
        // 与金库常规列表一致：按金库拖拽排序（vault_sort_order 越大越靠前）
        return [...list].sort(compareByVaultOrder)
      }
      return vaultItems
    }
    return filteredItems
  }, [activeTab, searchResults, vaultItems, filteredItems, selectedTag, typeFilter])

  const handleSelect = useCallback((id: number) => {
    setSelectedId(id)
    setPendingDeleteId(null)
  }, [])

  /** 切换多选：点击条目时若已进入多选态则切换勾选，否则作为常规选中 */
  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  /** 全选当前视图（无关键词/标签/类型过滤时全选全部可见项） */
  const selectAll = useCallback(() => {
    setSelectedIds(new Set(sidebarItems.map((it) => it.id)))
  }, [sidebarItems])

  /** 历史列表拖拽重排：按拖拽结果重组数组，并立即持久化到本地 DB */
  const handleReorder = useCallback(async (ordered: ClipboardItem[]) => {
    setItems(ordered)
    if (!isElectron) return
    try {
      await window.electronAPI.reorderItems(ordered.map((it) => it.id))
    } catch (err: any) {
      showToast(tr('toast.error', { error: err?.message ?? String(err) }))
    }
  }, [])

  /** 金库列表拖拽重排：重赋收藏条目的 vault_sort_order（越大越靠前），并立即持久化到本地 DB */
  const handleVaultReorder = useCallback(
    async (ordered: ClipboardItem[]) => {
      const n = ordered.length
      const byId = new Map(ordered.map((it, i) => [it.id, n - i]))
      setItems((prev) =>
        prev.map((it) => (it.is_pinned && byId.has(it.id) ? { ...it, vault_sort_order: byId.get(it.id) } : it)),
      )
      if (!isElectron) return
      try {
        await window.electronAPI.vaultReorderItems(ordered.map((it) => it.id))
      } catch (err: any) {
        showToast(tr('toast.error', { error: err?.message ?? String(err) }))
      }
    },
    [],
  )

  const handleCopy = useCallback(
    async (item: ClipboardItem) => {
      if (isElectron) {
        try {
          if (item.type === 'image') {
            // 列表查询已置空图片 content，复制前按 id 取完整内容（dataURL）
            let content = item.content
            if (!content) {
              content = await window.electronAPI.getItemContent(item.id)
            }
            if (content) {
              await window.electronAPI.writeImage(content)
            }
          } else if (item.type === 'html' && item.content) {
            await window.electronAPI.writeHtml(item.content)
          } else if (item.type === 'files' && item.content) {
            const paths = safeParseJson(item.content, [] as string[])
            if (Array.isArray(paths) && paths.length > 0) {
              await window.electronAPI.writeFiles(paths)
            }
          } else {
            await window.electronAPI.writeText(item.content)
          }
        } catch (err: any) {
          showToast(tr('toast.error', { error: err?.message ?? String(err) }))
          return
        }
      }
      showToast(tr('toast.copied'))
      // 复制后自动隐藏窗口（弹窗式使用）
      if (autoHideOnCopy && isElectron) {
        window.electronAPI.closeWindow()
      }
    },
    [autoHideOnCopy]
  )

  const handleOpenUrl = useCallback(async (url: string) => {
    try {
      if (isElectron) {
        await window.electronAPI.openUrl(url)
      } else {
        window.open(url, '_blank')
      }
    } catch (err: any) {
      showToast(tr('toast.error', { error: err?.message ?? String(err) }))
    }
  }, [])

  const handleOpenFile = useCallback(async (filePath: string) => {
    try {
      if (isElectron) {
        await window.electronAPI.openFile(filePath)
      }
    } catch (err: any) {
      showToast(tr('toast.error', { error: err?.message ?? String(err) }))
    }
  }, [])

  const handleDelete = useCallback(
    async (id: number) => {
      // 收藏（金库）项删除需二次确认：第一次进入确认态，第二次才真正删除，防止误删
      const target = items.find((it) => it.id === id)
      if (target?.is_pinned && pendingDeleteId !== id) {
        setPendingDeleteId(id)
        if (pendingDeleteTimer.current) clearTimeout(pendingDeleteTimer.current)
        pendingDeleteTimer.current = setTimeout(() => setPendingDeleteId(null), 3000)
        showToast(tr('toast.confirmDeletePinned'))
        return
      }
      // 清除确认态
      if (pendingDeleteTimer.current) clearTimeout(pendingDeleteTimer.current)
      setPendingDeleteId(null)

      try {
        if (isElectron) {
          await window.electronAPI.deleteItem(id)
        }
      } catch (err: any) {
        showToast(tr('toast.error', { error: err?.message ?? String(err) }))
        return
      }
      setItems((prev) => {
        const next = prev.filter((it) => it.id !== id)
        if (id === selectedId && next.length > 0) {
          const deletedIdx = prev.findIndex((it) => it.id === id)
          const newIdx = Math.min(deletedIdx, next.length - 1)
          setSelectedId(next[newIdx].id)
        } else if (next.length === 0) {
          setSelectedId(null)
        }
        return next
      })
      showToast(tr('toast.deleted'))
    },
    [selectedId, items, pendingDeleteId]
  )

  const handleUpdate = useCallback(
    async (id: number, content: string) => {
      const preview = content.length > 100 ? content.slice(0, 100) + '...' : content
      const charCount = content.length
      const storageSize = new TextEncoder().encode(content).length
      try {
        if (isElectron) {
          await window.electronAPI.updateItem({ id, content, preview, charCount, storageSize })
        }
      } catch (err: any) {
        showToast(tr('toast.error', { error: err?.message ?? String(err) }))
        return
      }
      setItems((prev) =>
        prev.map((it) =>
          it.id === id ? { ...it, content, preview, char_count: charCount, storage_size: storageSize } : it
        )
      )
      showToast(tr('toast.updated'))
    },
    []
  )

  const handleTogglePin = useCallback(
    async (id: number) => {
      const item = items.find((it) => it.id === id)
      if (!item) return
      const next = !item.is_pinned
      try {
        if (isElectron) {
          await window.electronAPI.updateItemMeta({ id, isPinned: next })
        }
      } catch (err: any) {
        showToast(tr('toast.error', { error: err?.message ?? String(err) }))
        return
      }
      const now = new Date().toLocaleString('sv-SE').replace('T', ' ').slice(0, 19)
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, is_pinned: next, pinned_at: next ? now : null } : it))
      )
      showToast(next ? tr('toast.pinned') : tr('toast.unpinned'))
    },
    [items]
  )

  const handleUpdateAlias = useCallback(
    async (id: number, alias: string) => {
      try {
        if (isElectron) {
          await window.electronAPI.updateItemMeta({ id, alias })
        }
      } catch (err: any) {
        showToast(tr('toast.error', { error: err?.message ?? String(err) }))
        return
      }
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, alias } : it))
      )
      showToast(tr('toast.aliasUpdated'))
    },
    []
  )

  const handleUpdateTags = useCallback(
    async (id: number, tags: string[]) => {
      const tagsJson = JSON.stringify(tags)
      try {
        if (isElectron) {
          await window.electronAPI.updateItemMeta({ id, tags: tagsJson })
        }
      } catch (err: any) {
        showToast(tr('toast.error', { error: err?.message ?? String(err) }))
        return
      }
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, tags } : it))
      )
    },
    []
  )

  const handleToggleSensitive = useCallback(
    async (id: number) => {
      const item = items.find((it) => it.id === id)
      if (!item) return
      const next = !item.is_sensitive
      try {
        if (isElectron) {
          await window.electronAPI.updateItemMeta({ id, isSensitive: next })
        }
      } catch (err: any) {
        showToast(tr('toast.error', { error: err?.message ?? String(err) }))
        return
      }
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, is_sensitive: next } : it))
      )
    },
    [items]
  )

  /** 批量复制：依次复制所有选中记录的文本/链接内容 */
  const handleBatchCopy = useCallback(async () => {
    if (selectedIds.size === 0) return
    const list = sidebarItems.filter((it) => selectedIds.has(it.id))
    if (!list.length) return
    const texts = list
      .filter((it) => it.type !== 'image')
      .map((it) => (it.type === 'html' ? stripHtml(it.content) : it.content))
      .filter((t) => t && t.trim())
    if (texts.length) {
      try {
        if (isElectron) await window.electronAPI.writeText(texts.join('\n\n'))
        else if (navigator.clipboard) await navigator.clipboard.writeText(texts.join('\n\n'))
      } catch (err: any) {
        showToast(tr('toast.error', { error: err?.message ?? String(err) }))
        return
      }
    }
    showToast(tr('toast.batchCopied', { n: texts.length }))
    if (autoHideOnCopy && isElectron) window.electronAPI.closeWindow()
  }, [selectedIds, sidebarItems, isElectron, autoHideOnCopy])

  /** 批量收藏/取消收藏：全选中均收藏则取消，否则全部收藏 */
  const handleBatchPin = useCallback(async () => {
    if (selectedIds.size === 0) return
    const list = sidebarItems.filter((it) => selectedIds.has(it.id))
    if (!list.length) return
    const allPinned = list.length > 0 && list.every((it) => it.is_pinned)
    let ok = true
    for (const it of list) {
      if (it.is_pinned === allPinned) continue
      try {
        if (isElectron) await window.electronAPI.updateItemMeta({ id: it.id, isPinned: !allPinned })
      } catch (err: any) {
        ok = false
        showToast(tr('toast.error', { error: err?.message ?? String(err) }))
        break
      }
    }
    if (!ok) return
    const now = new Date().toLocaleString('sv-SE').replace('T', ' ').slice(0, 19)
    setItems((prev) =>
      prev.map((it) =>
        selectedIds.has(it.id) ? { ...it, is_pinned: !allPinned, pinned_at: !allPinned ? now : null } : it,
      ),
    )
    showToast(allPinned ? tr('toast.batchUnpinned', { n: list.length }) : tr('toast.batchPinned', { n: list.length }))
  }, [selectedIds, sidebarItems, isElectron])

  /** 批量加标签：为所有选中记录追加同一标签 */
  const handleBatchAddTag = useCallback(async (tag: string) => {
    if (selectedIds.size === 0) return
    const list = sidebarItems.filter((it) => selectedIds.has(it.id))
    if (!list.length) return
    let ok = true
    for (const it of list) {
      if (it.tags.includes(tag)) continue
      const next = [...it.tags, tag]
      try {
        if (isElectron) await window.electronAPI.updateItemMeta({ id: it.id, tags: JSON.stringify(next) })
      } catch (err: any) {
        ok = false
        showToast(tr('toast.error', { error: err?.message ?? String(err) }))
        break
      }
    }
    if (!ok) return
    setItems((prev) => prev.map((it) => (selectedIds.has(it.id) && !it.tags.includes(tag) ? { ...it, tags: [...it.tags, tag] } : it)))
    showToast(tr('toast.batchTagged', { n: list.length, tag }))
  }, [selectedIds, sidebarItems, isElectron])

  /** 批量删除：若含收藏项先二次确认，再批量删除 */
  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return
    const list = sidebarItems.filter((it) => selectedIds.has(it.id))
    if (!list.length) return
    const hasPinned = list.some((it) => it.is_pinned)
    if (hasPinned) {
      const ok = await confirm(tr('toast.batchConfirmDelete', { n: list.length }), { danger: true })
      if (!ok) return
    }
    try {
      if (isElectron) await window.electronAPI.deleteItems(list.map((it) => it.id))
    } catch (err: any) {
      showToast(tr('toast.error', { error: err?.message ?? String(err) }))
      return
    }
    setItems((prev) => {
      const removed = new Set(list.map((it) => it.id))
      const next = prev.filter((it) => !removed.has(it.id))
      if (next.length === 0) setSelectedId(null)
      else if (selectedId !== null && removed.has(selectedId)) setSelectedId(next[0].id)
      return next
    })
    setSelectedIds(new Set())
    showToast(tr('toast.batchDeleted', { n: list.length }))
  }, [selectedIds, sidebarItems, isElectron, selectedId, confirm])

  // ── Local keyboard shortcuts（可自定义）──
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat) return
      const target = e.target as HTMLElement
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      const sc = shortcuts

      // Escape / 自定义清空搜索键：先清搜索 → 再清标签 → 再取消多选 → 再取消选中
      if (matchShortcut(e, sc.clearSearch)) {
        if (searchQuery) {
          setSearchQuery('')
          return
        }
        if (selectedTag) {
          setSelectedTag(null)
          return
        }
        if (selectedIds.size > 0) {
          setSelectedIds(new Set())
          return
        }
        if (pendingDeleteId !== null) {
          setPendingDeleteId(null)
          return
        }
        if (selectedId !== null) {
          setSelectedId(null)
          return
        }
      }

      // Ctrl/Cmd + A：全选当前视图（进入多选态）
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !inInput && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        if (sidebarItems.length > 0) selectAll()
        return
      }

      // Ctrl/Cmd + 1..9：按列表位置快捷复制（写入剪贴板，遵循复制后自动隐藏设置）
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !inInput && /^[1-9]$/.test(e.key)) {
        const target = filteredItems[Number(e.key) - 1]
        if (target) {
          e.preventDefault()
          handleCopy(target)
          setSelectedId(target.id)
        }
        return
      }

      if (!selectedItem) return

      // 复制
      if (matchShortcut(e, sc.copy) && !inInput) {
        e.preventDefault()
        handleCopy(selectedItem)
      }

      // 删除
      if (matchShortcut(e, sc.delete) && !inInput) {
        e.preventDefault()
        handleDelete(selectedItem.id)
      }

      // Enter — copy (convenience)
      if (e.key === 'Enter' && !inInput) {
        handleCopy(selectedItem)
      }

      // Backspace — delete (convenience, not in input)
      if (e.key === 'Backspace' && !inInput) {
        handleDelete(selectedItem.id)
      }

      // 收藏 / 取消收藏
      if (matchShortcut(e, sc.pin) && !inInput) {
        e.preventDefault()
        handleTogglePin(selectedItem.id)
      }

      // 上一条 / 下一条导航（在当前视图实际显示的列表中切换：历史用 filteredItems，金库用 vaultItems/搜索结果）
      if (matchShortcut(e, sc.prev) && !inInput) {
        e.preventDefault()
        const list = sidebarItems
        const idx = list.findIndex((it) => it.id === selectedId)
        if (idx === -1) return
        setPendingDeleteId(null)
        setSelectedId(list[Math.max(idx - 1, 0)].id)
      }
      if (matchShortcut(e, sc.next) && !inInput) {
        e.preventDefault()
        const list = sidebarItems
        const idx = list.findIndex((it) => it.id === selectedId)
        if (idx === -1) return
        setPendingDeleteId(null)
        setSelectedId(list[Math.min(idx + 1, list.length - 1)].id)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedItem, selectedId, sidebarItems, searchQuery, selectedTag, pendingDeleteId, shortcuts, handleCopy, handleDelete, handleTogglePin, filteredItems, selectedIds, selectAll])

  // 窗口最大化时取消内容圆角（透明窗口四角不再透出桌面缺口）
  const [winMaximized, setWinMaximized] = useState(false)
  useEffect(() => {
    if (!isElectron || !window.electronAPI?.onWindowMaximizeChanged) return
    window.electronAPI.getWindowMaximized().then(setWinMaximized).catch(() => {})
    const off = window.electronAPI.onWindowMaximizeChanged((v) => setWinMaximized(!!v))
    return off
  }, [])
  const winRadius = winMaximized ? '' : 'rounded-lg'

  // ── Settings view (fullscreen) ──
  if (showSettings) {
    return (
      <div className={`relative h-screen overflow-hidden pt-9 bg-zinc-50 dark:bg-zinc-950 ${winRadius}`}>
        <TitleBar />
        <Settings theme={theme} onThemeChange={setTheme} language={language} onLanguageChange={setLanguage} accentColor={accentColor} onAccentChange={(c) => setAccentColor(c as AccentColor)} listDensity={listDensity} onDensityChange={setListDensity} useMonospace={useMonospace} onMonospaceChange={setUseMonospace} autoHideOnCopy={autoHideOnCopy} onAutoHideChange={setAutoHideOnCopy} shortcuts={shortcuts} onShortcutChange={handleShortcutChange} onBack={() => setShowSettings(false)} onToast={showToast} onDataImported={async () => {
            // 导入 JSON 后重新拉取列表
            if (!isElectron) return
            const loaded = await window.electronAPI.getItems({ limit: 500, offset: 0 })
            const normalized = normalizeItems(loaded)
            setItems(normalized)
            setSelectedId(normalized.length > 0 ? normalized[0].id : null)
          }} onClearData={async (type: 'images' | 'all') => {
            if (type === 'all') {
              // 仅清空未收藏的记录，保留金库数据
              setItems(prev => prev.filter(it => it.is_pinned))
              setSelectedId(prev => {
                if (prev === null) return null
                const item = items.find(it => it.id === prev)
                return item && !item.is_pinned ? null : prev
              })
            } else {
              // 仅清空未收藏的图片，保留金库图片
              setItems(prev => prev.filter(it => !(it.type === 'image' && !it.is_pinned)))
              setSelectedId(prev => {
                if (prev === null) return null
                const item = items.find(it => it.id === prev)
                return item && item.type === 'image' && !item.is_pinned ? null : prev
              })
            }
          }} />
      </div>
  )
  }

  // ── Main 3-column view ──
  return (
    <div className={`relative h-screen flex bg-zinc-50 dark:bg-zinc-950 overflow-hidden pt-9 ${winRadius}`}>
      <TitleBar />
      {/* ── 超大文本确认弹窗（完整保留 / 截断保留） ── */}
      {oversizePending && (
        <div className="fixed inset-0 z-[999] bg-black/50 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl p-6 w-[420px] max-w-[90vw]">
            <div className="text-sm font-bold text-zinc-800 dark:text-zinc-200 mb-2">{tr('oversize.title')}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-4 leading-relaxed">
              {tr('oversize.desc', { kb: oversizePending.kb })}
              <div className="mt-2 max-h-24 overflow-y-auto rounded-md bg-zinc-100 dark:bg-zinc-800 p-2 font-mono text-[10px] text-zinc-500 dark:text-zinc-400 break-all">
                {oversizePending.content.slice(0, 300)}{oversizePending.content.length > 300 ? '…' : ''}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => void handleOversizeChoice(false)}
                className="h-8 px-4 rounded-md text-xs bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 transition-colors"
              >
                {tr('oversize.keep')}
              </button>
              <button
                onClick={() => void handleOversizeChoice(true)}
                className="h-8 px-4 rounded-md text-xs text-white transition-colors"
                style={{ background: 'var(--accent)' }}
              >
                {tr('oversize.truncate', { kb: oversizePending.kb })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Column 1 — global navigation (~52px) */}
      <NavBar onOpenSettings={() => setShowSettings(true)} />

      {/* Column 2 — history list（宽度可拖拽调整） */}
      <div style={{ width: sidebarWidth, minWidth: SIDEBAR_MIN_WIDTH }} className="flex-shrink-0 pr-2 pt-5 pb-4">
        <Sidebar
          items={sidebarItems}
          selectedId={selectedId}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelect={handleSelect}
          density={listDensity}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          allTags={allTags}
          selectedTag={selectedTag}
          onTagChange={setSelectedTag}
          onReorder={handleReorder}
          onVaultReorder={handleVaultReorder}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          selectedIds={selectedIds.size > 0 ? selectedIds : undefined}
          onToggleSelect={toggleSelect}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
          onBatchCopy={handleBatchCopy}
          onBatchPin={handleBatchPin}
          onBatchDelete={handleBatchDelete}
          onBatchAddTag={handleBatchAddTag}
        />
      </div>

      {/* Resize divider — 拖拽调整左右宽度（仅主界面） */}
      <div
        onMouseDown={handleResizeStart}
        className="group relative z-10 flex-shrink-0 w-1.5 cursor-col-resize pt-5 pb-4 flex items-center justify-center select-none"
      >
        <div
          className={cn(
            'w-0.5 h-full rounded-full transition-colors',
            isResizing
              ? 'bg-zinc-500 dark:bg-zinc-200'
              : 'bg-transparent group-hover:bg-zinc-400 dark:group-hover:bg-zinc-500',
          )}
        />
      </div>

      {/* Column 3 — detail view (~70%) as floating card */}
      <div style={{ minWidth: DETAIL_MIN_WIDTH }} className="flex-1 min-w-0 relative pl-2 pr-4 pt-5 pb-4">
        <div className="h-full bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200/60 dark:border-zinc-800/50 overflow-hidden flex flex-col">
          <DetailView
            item={selectedItem}
            density={listDensity}
            onCopy={handleCopy}
            onDelete={handleDelete}
            onUpdate={handleUpdate}
            onTogglePin={handleTogglePin}
            onUpdateAlias={handleUpdateAlias}
            onUpdateTags={handleUpdateTags}
            onToggleSensitive={handleToggleSensitive}
            onOpenUrl={handleOpenUrl}
            onOpenFile={handleOpenFile}
            onToast={showToast}
            confirmingDelete={pendingDeleteId === selectedItem?.id}
            shortcuts={shortcuts}
            monospace={useMonospace}
          />
        </div>

        {/* Toast notification */}
        {toast && (
          <div className="absolute bottom-14 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-zinc-800 dark:bg-zinc-800/90 text-xs text-zinc-300 shadow-lg border border-zinc-200 dark:border-zinc-700/50 backdrop-blur-sm transition-all duration-200">
            {toast}
          </div>
        )}
      </div>
    </div>
  )
}
