import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import NavBar from './components/NavBar'
import Sidebar from './components/Sidebar'
import DetailView from './components/DetailView'
import Settings from './components/Settings'
import { ClipboardItem, ClipboardChangedData } from './types'
import { mockItems } from './mock'
import { Lang, loadLang, setLang, tr } from './i18n'
import { detectSensitive } from './lib/utils'

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

type Theme = 'light' | 'dark' | 'auto'
type AccentColor = 'blue' | 'purple' | 'orange' | 'green' | 'rose' | 'amber'
type ListDensity = 'comfortable' | 'compact'
type ActiveTab = 'history' | 'vault'

export const ACCENT_MAP: Record<AccentColor, string> = {
  blue: '#3b82f6', purple: '#a855f7', orange: '#f97316',
  green: '#22c55e', rose: '#f43f5e', amber: '#f59e0b',
}

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
  /** DB 层搜索结果（搜索时优先展示；清空搜索后置回 null 恢复本地列表） */
  const [searchResults, setSearchResults] = useState<ClipboardItem[] | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    try { return (localStorage.getItem('q-paste-tab') as ActiveTab) || 'history' } catch { return 'history' }
  })
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  useEffect(() => {
    try { localStorage.setItem('q-paste-tab', activeTab) } catch {}
  }, [activeTab])

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

  // DB 层全文搜索（防抖）：搜索全部历史，不再局限于已加载的 500 条
  useEffect(() => {
    if (!isElectron) return
    const q = searchQuery.trim()
    if (!q) {
      setSearchResults(null)
      return
    }
    const timer = setTimeout(async () => {
      const loaded = await window.electronAPI.getItems({ limit: 300, offset: 0, search: q })
      setSearchResults(normalizeItems(loaded))
    }, 250)
    return () => clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    if (!isElectron) return
    const cleanup = window.electronAPI.onClipboardChanged(async (data: ClipboardChangedData) => {
      const isSensitive = data.type !== 'image' && detectSensitive(data.content)
      const res = await window.electronAPI.insertItem({
        type: data.type,
        content: data.content,
        preview: data.preview,
        charCount: data.charCount ?? 0,
        storageSize: data.storageSize ?? 0,
        createdAt: data.createdAt,
        isSensitive,
      })
      if (!res) return
      const id = res.id
      if (res.updated) {
        // 内容去重：复用已有记录并置顶
        setItems((prev) => {
          const existing = prev.find((it) => it.id === id)
          if (!existing) return prev
          const updated: ClipboardItem = {
            ...existing,
            preview: data.preview,
            char_count: data.charCount ?? 0,
            storage_size: data.storageSize ?? 0,
            created_at: data.createdAt,
          }
          return [updated, ...prev.filter((it) => it.id !== id)]
        })
        setSelectedId(id)
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
      if (isSensitive) {
        showToast(tr('toast.sensitiveDetected'))
      } else {
        showToast(tr('toast.captured'))
      }
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
    if (searchResults) return searchResults
    if (!searchQuery.trim()) return items
    const q = searchQuery.toLowerCase()
    return items.filter(
      (it) =>
        it.preview.toLowerCase().includes(q) ||
        it.content.toLowerCase().includes(q)
    )
  }, [items, searchQuery, searchResults])

  const vaultItems = useMemo(() => {
    return items
      .filter((it) => it.is_pinned)
      .sort((a, b) => {
        const tagA = a.tags.length > 0 ? a.tags[0] : '￿'
        const tagB = b.tags.length > 0 ? b.tags[0] : '￿'
        if (tagA !== tagB) return tagA.localeCompare(tagB)
        const aliasA = a.alias || a.preview
        const aliasB = b.alias || b.preview
        return aliasA.localeCompare(aliasB)
      })
  }, [items])

  const sidebarItems = activeTab === 'vault' ? vaultItems : filteredItems

  const handleSelect = useCallback((id: number) => {
    setSelectedId(id)
  }, [])

  const handleCopy = useCallback(
    async (item: ClipboardItem) => {
      if (isElectron) {
        if (item.type === 'image' && item.content) {
          await window.electronAPI.writeImage(item.content)
        } else {
          await window.electronAPI.writeText(item.content)
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

  const handleDelete = useCallback(
    async (id: number) => {
      if (isElectron) {
        await window.electronAPI.deleteItem(id)
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
    [selectedId]
  )

  const handleUpdate = useCallback(
    async (id: number, content: string) => {
      const preview = content.length > 100 ? content.slice(0, 100) + '...' : content
      const charCount = content.length
      const storageSize = new TextEncoder().encode(content).length
      if (isElectron) {
        await window.electronAPI.updateItem({ id, content, preview, charCount, storageSize })
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
      if (isElectron) {
        await window.electronAPI.updateItemMeta({ id, isPinned: next })
      }
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, is_pinned: next } : it))
      )
      showToast(next ? tr('toast.pinned') : tr('toast.unpinned'))
    },
    [items]
  )

  const handleUpdateAlias = useCallback(
    async (id: number, alias: string) => {
      if (isElectron) {
        await window.electronAPI.updateItemMeta({ id, alias })
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
      if (isElectron) {
        await window.electronAPI.updateItemMeta({ id, tags: tagsJson })
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
      if (isElectron) {
        await window.electronAPI.updateItemMeta({ id, isSensitive: next })
      }
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, is_sensitive: next } : it))
      )
    },
    [items]
  )

  // ── Local keyboard shortcuts ──
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat) return
      const target = e.target as HTMLElement
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'

      // Escape: clear search first, then deselect
      if (e.key === 'Escape') {
        if (searchQuery) {
          setSearchQuery('')
          return
        }
        if (selectedId !== null) {
          setSelectedId(null)
          return
        }
      }

      if (!selectedItem) return

      // C — copy (no modifiers, not in input)
      if (e.key === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey && !inInput) {
        e.preventDefault()
        handleCopy(selectedItem)
      }

      // D — delete
      if (e.key === 'd' && !e.metaKey && !e.ctrlKey && !e.altKey && !inInput) {
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

      // Ctrl+P / Alt+P — toggle pin
      if ((e.key === 'p' || e.key === 'P') && (e.ctrlKey || e.altKey) && !e.metaKey && !e.shiftKey && !inInput) {
        e.preventDefault()
        handleTogglePin(selectedItem.id)
      }

      // W/S — navigate
      if ((e.key === 'w' || e.key === 's') && !e.metaKey && !e.ctrlKey && !e.altKey && !inInput) {
        e.preventDefault()
        const idx = filteredItems.findIndex((it) => it.id === selectedId)
        if (idx === -1) return
        const next =
          e.key === 's'
            ? Math.min(idx + 1, filteredItems.length - 1)
            : Math.max(idx - 1, 0)
        setSelectedId(filteredItems[next].id)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedItem, selectedId, filteredItems, searchQuery, handleCopy, handleDelete, handleTogglePin])

  // ── Settings view (fullscreen) ──
  if (showSettings) {
    return <Settings theme={theme} onThemeChange={setTheme} language={language} onLanguageChange={setLanguage} accentColor={accentColor} onAccentChange={(c) => setAccentColor(c as AccentColor)} listDensity={listDensity} onDensityChange={setListDensity} useMonospace={useMonospace} onMonospaceChange={setUseMonospace} autoHideOnCopy={autoHideOnCopy} onAutoHideChange={setAutoHideOnCopy} onBack={() => setShowSettings(false)} onClearData={async (type: 'images' | 'all') => {
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
  }

  // ── Main 3-column view ──
  return (
    <div className="h-screen flex bg-zinc-50 dark:bg-zinc-950 overflow-hidden">
      {/* Column 1 — global navigation (~52px) */}
      <NavBar onOpenSettings={() => setShowSettings(true)} />

      {/* Column 2 — history list (~30%) */}
      <div className="w-[280px] min-w-[240px] max-w-[320px] flex-shrink-0">
        <Sidebar
          items={sidebarItems}
          selectedId={selectedId}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelect={handleSelect}
          density={listDensity}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>

      {/* Column 3 — detail view (~70%) as floating card */}
      <div className="flex-1 min-w-0 relative p-3 pl-0">
        <div className="h-full bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200/60 dark:border-zinc-800/50 overflow-hidden flex flex-col">
          <DetailView
            item={selectedItem}
            onCopy={handleCopy}
            onDelete={handleDelete}
            onUpdate={handleUpdate}
            onTogglePin={handleTogglePin}
            onUpdateAlias={handleUpdateAlias}
            onUpdateTags={handleUpdateTags}
            onToggleSensitive={handleToggleSensitive}
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
