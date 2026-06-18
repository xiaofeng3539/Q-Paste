import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import NavBar from './components/NavBar'
import Sidebar from './components/Sidebar'
import DetailView from './components/DetailView'
import Settings from './components/Settings'
import { ClipboardItem, ClipboardChangedData } from './types'
import { mockItems } from './mock'
import { Lang, loadLang, setLang, tr } from './i18n'

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

type Theme = 'light' | 'dark' | 'auto'
type AccentColor = 'blue' | 'purple' | 'orange' | 'green' | 'rose' | 'amber'
type ListDensity = 'comfortable' | 'compact'

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
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync accent color CSS variable
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', ACCENT_MAP[accentColor])
    try { localStorage.setItem('q-paste-accent', accentColor) } catch {}
  }, [accentColor])

  // Sync density to localStorage
  useEffect(() => {
    try { localStorage.setItem('q-paste-density', listDensity) } catch {}
  }, [listDensity])

  // Sync monospace to localStorage
  useEffect(() => {
    try { localStorage.setItem('q-paste-monospace', String(useMonospace)) } catch {}
  }, [useMonospace])

  // Sync language to i18n module
  useEffect(() => { setLang(language) }, [language])

  // Sync theme to <html> class
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

  function handleSetTheme(t: Theme) {
    setTheme(t)
  }

  function showToast(msg: string) {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 1500)
  }

  // Load items from store on mount
  useEffect(() => {
    if (!isElectron) return
    window.electronAPI.getItems({ limit: 500, offset: 0 }).then((loaded) => {
      setItems(loaded)
      if (loaded.length > 0) {
        setSelectedId(loaded[0].id)
      }
    })
  }, [])

  // Listen for clipboard changes
  useEffect(() => {
    if (!isElectron) return
    const cleanup = window.electronAPI.onClipboardChanged(async (data: ClipboardChangedData) => {
      const id = await window.electronAPI.insertItem({
        type: data.type,
        content: data.content,
        preview: data.preview,
        charCount: data.charCount ?? 0,
        storageSize: data.storageSize ?? 0,
        createdAt: data.createdAt,
      })
      const newItem: ClipboardItem = {
        id,
        type: data.type,
        content: data.content,
        preview: data.preview,
        char_count: data.charCount ?? 0,
        storage_size: data.storageSize ?? 0,
        created_at: data.createdAt,
      }
      setItems((prev) => [newItem, ...prev])
      setSelectedId(id)
      showToast(tr('toast.captured'))
    })
    return cleanup
  }, [])

  const selectedItem = useMemo(
    () => items.find((it) => it.id === selectedId) ?? null,
    [items, selectedId]
  )

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items
    const q = searchQuery.toLowerCase()
    return items.filter(
      (it) =>
        it.preview.toLowerCase().includes(q) ||
        it.content.toLowerCase().includes(q)
    )
  }, [items, searchQuery])

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
    },
    []
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
    },
    []
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
  }, [selectedItem, selectedId, filteredItems, searchQuery, handleCopy, handleDelete])

  // ── Settings view (fullscreen) ──
  if (showSettings) {
    return <Settings theme={theme} onThemeChange={handleSetTheme} language={language} onLanguageChange={setLanguage} accentColor={accentColor} onAccentChange={(c) => setAccentColor(c as AccentColor)} listDensity={listDensity} onDensityChange={setListDensity} useMonospace={useMonospace} onMonospaceChange={setUseMonospace} onBack={() => setShowSettings(false)} onClearData={async (type: 'images' | 'all') => {
            if (type === 'all') {
              setItems([])
              setSelectedId(null)
            } else {
              setItems(prev => prev.filter(it => it.type !== 'image'))
              setSelectedId(prev => {
                if (prev === null) return null
                const item = items.find(it => it.id === prev)
                return item && item.type !== 'image' ? prev : null
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
          items={filteredItems}
          selectedId={selectedId}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelect={handleSelect}
          density={listDensity}
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
