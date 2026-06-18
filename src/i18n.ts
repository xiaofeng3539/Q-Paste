export type Lang = 'zh-CN' | 'en'

const zh: Record<string, string> = {
  // NavBar
  'nav.settings': '设置',

  // Sidebar
  'sidebar.title': 'Q-Paste',
  'sidebar.search': '搜索...',
  'sidebar.noResults': '无匹配结果',
  'sidebar.noRecords': '暂无记录',
  'sidebar.today': '今天',
  'sidebar.yesterday': '昨天',
  'sidebar.thisWeek': '本周',
  'sidebar.thisMonth': '本月',
  'sidebar.earlier': '更早',

  // DetailView
  'detail.empty': '选择一条记录查看详情',
  'detail.switch': '切换',
  'detail.copy': '复制',
  'detail.delete': '删除',
  'detail.typeText': '文本',
  'detail.typeUrl': '链接',
  'detail.typeImage': '图片',
  'detail.chars': '字符',
  'detail.source': '本机',
  'detail.noPreview': '无法预览此图片',
  'detail.emptyContent': '空内容',
  'detail.image': '图片',
  'detail.zoomHint': '滚轮缩放',
  'detail.dragHint': '拖拽平移',
  'detail.dblClickReset': '双击重置',
  'detail.dblClickZoom': '双击放大查看',

  // Toast
  'toast.captured': '已捕获新剪贴板内容',
  'toast.copied': '已复制到系统剪贴板',
  'toast.deleted': '已删除',

  // Settings
  'settings.title': '设置',
  'settings.back': '返回',
  'settings.general': '通用',
  'settings.appearance': '外观',
  'settings.storage': '存储管理',
  'settings.shortcuts': '快捷键',
  'settings.about': '关于',

  // Settings - General
  'general.startup': '启动',
  'general.autoStart': '开机自动启动',
  'general.autoStartDesc': '系统启动时自动运行 Q-Paste',
  'general.minToTray': '启动后最小化到系统托盘',
  'general.minToTrayDesc': '启动后最小化到系统托盘，保持后台监听',
  'general.language': '语言',
  'general.clipboard': '剪贴板',
  'general.autoMonitor': '自动监听剪贴板',

  // Settings - Appearance
  'appearance.theme': '主题模式',
  'appearance.light': '浅色模式',
  'appearance.dark': '深色模式',
  'appearance.auto': '跟随系统',
  'appearance.accent': '主题强调色',
  'appearance.density': '剪贴板显示密度',
  'appearance.densityDesc': '调整历史记录列表的上下间距',
  'appearance.densityComfortable': '宽松',
  'appearance.densityCompact': '紧凑',
  'appearance.typography': '代码等宽字体',
  'appearance.typographyDesc': '为代码片段使用 Monospace 字体以增强可读性',

  // Settings - Storage
  'storage.dbUsage': '数据库占用',
  'storage.totalSpace': '总计',
  'storage.availableSpace': '可用空间',
  'storage.textData': '文本',
  'storage.imageData': '图片',
  'storage.available': '可用',
  'storage.path': '存储路径',
  'storage.pathHint': '所有剪贴板历史记录和图片缓存都将保存在此目录下',
  'storage.changeDir': '更改目录',
  'storage.openFolder': '打开文件夹',
  'storage.pathWarning': '更改路径后，系统会自动迁移现有数据，软件将会重启',
  'storage.pathNotAvailable': '选择目录功能需要在 Electron 环境中运行',
  'storage.retention': '历史记录保留',
  'storage.retentionTime': '记录保留时间',
  'storage.retention7d': '7 天',
  'storage.retention30d': '30 天',
  'storage.retention90d': '90 天',
  'storage.retentionForever': '永久',
  'storage.maxRecords': '最大记录条数',
  'storage.dangerZone': '空间释放',
  'storage.clearImages': '清除图片缓存',
  'storage.clearImagesHint': '仅删除图片文件，保留文本记录',
  'storage.clear': '清除',
  'storage.clearAll': '清空所有历史记录',
  'storage.clearAllHint': '此操作不可逆，将清空数据库',
  'storage.clearAllBtn': '清空全部',

  // Settings - Shortcuts
  'shortcuts.copyItem': '复制选中内容',
  'shortcuts.deleteItem': '删除选中内容',
  'shortcuts.switchItem': '切换记录',
  'shortcuts.clearSearch': '清空搜索 / 取消选中',
  'shortcuts.toggleWindow': '显示 / 隐藏窗口',

  // Settings - About
  'about.version': '版本',
  'about.description': '一款轻量、高效的跨平台剪贴板管理工具。支持文本、链接、图片的自动捕获、分类存储与快速检索。',
  'about.techStack': '技术栈：Electron + React + TypeScript + Tailwind CSS',
  'about.storageEngine': '存储引擎：SQLite (WASM)',

  // Time
  'time.justNow': '刚刚',
  'time.minutesAgo': '{n}分钟前',
  'time.hoursAgo': '{n}小时前',
  'time.daysAgo': '{n}天前',
  'time.weeksAgo': '{n}周前',
  'time.monthsAgo': '{n}个月前',
  'time.yearsAgo': '{n}年前',
  'time.yesterday': '昨天',
}

const en: Record<string, string> = {
  'nav.settings': 'Settings',

  'sidebar.title': 'Q-Paste',
  'sidebar.search': 'Search...',
  'sidebar.noResults': 'No results',
  'sidebar.noRecords': 'No records',
  'sidebar.today': 'Today',
  'sidebar.yesterday': 'Yesterday',
  'sidebar.thisWeek': 'This Week',
  'sidebar.thisMonth': 'This Month',
  'sidebar.earlier': 'Earlier',

  'detail.empty': 'Select an item to view details',
  'detail.switch': 'Switch',
  'detail.copy': 'Copy',
  'detail.delete': 'Delete',
  'detail.typeText': 'Text',
  'detail.typeUrl': 'URL',
  'detail.typeImage': 'Image',
  'detail.chars': 'chars',
  'detail.source': 'Local',
  'detail.noPreview': 'Unable to preview this image',
  'detail.emptyContent': 'Empty',
  'detail.image': 'Image',
  'detail.zoomHint': 'Scroll to zoom',
  'detail.dragHint': 'Drag to pan',
  'detail.dblClickReset': 'Double-click to reset',
  'detail.dblClickZoom': 'Double-click to enlarge',

  'toast.captured': 'New clipboard content captured',
  'toast.copied': 'Copied to clipboard',
  'toast.deleted': 'Deleted',

  'settings.title': 'Settings',
  'settings.back': 'Back',
  'settings.general': 'General',
  'settings.appearance': 'Appearance',
  'settings.storage': 'Storage',
  'settings.shortcuts': 'Shortcuts',
  'settings.about': 'About',

  'general.startup': 'Startup',
  'general.autoStart': 'Launch at system startup',
  'general.autoStartDesc': 'Automatically launch Q-Paste at system startup',
  'general.minToTray': 'Minimize to tray on launch',
  'general.minToTrayDesc': 'Minimize to system tray on launch, keep monitoring in background',
  'general.language': 'Language',
  'general.clipboard': 'Clipboard',
  'general.autoMonitor': 'Auto-monitor clipboard',

  'appearance.theme': 'Theme',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.auto': 'Auto',
  'appearance.accent': 'Accent Color',
  'appearance.density': 'List Density',
  'appearance.densityDesc': 'Adjust the vertical spacing of history items',
  'appearance.densityComfortable': 'Comfortable',
  'appearance.densityCompact': 'Compact',
  'appearance.typography': 'Monospace Font',
  'appearance.typographyDesc': 'Use monospace font for code snippets to improve readability',

  'storage.dbUsage': 'Database Usage',
  'storage.totalSpace': 'Total',
  'storage.availableSpace': 'available',
  'storage.textData': 'Text',
  'storage.imageData': 'Images',
  'storage.available': 'Free',
  'storage.path': 'Storage Path',
  'storage.pathHint': 'All clipboard history and image cache will be stored in this directory',
  'storage.changeDir': 'Change',
  'storage.openFolder': 'Open Folder',
  'storage.pathWarning': 'Changing the path will migrate existing data and restart the app',
  'storage.pathNotAvailable': 'Directory selection requires Electron environment',
  'storage.retention': 'History Retention',
  'storage.retentionTime': 'Retention period',
  'storage.retention7d': '7 Days',
  'storage.retention30d': '30 Days',
  'storage.retention90d': '90 Days',
  'storage.retentionForever': 'Forever',
  'storage.maxRecords': 'Max records',
  'storage.dangerZone': 'Free Up Space',
  'storage.clearImages': 'Clear image cache',
  'storage.clearImagesHint': 'Only delete image files, keep text records',
  'storage.clear': 'Clear',
  'storage.clearAll': 'Clear all history',
  'storage.clearAllHint': 'This action is irreversible and will clear the database',
  'storage.clearAllBtn': 'Clear All',

  'shortcuts.copyItem': 'Copy selected',
  'shortcuts.deleteItem': 'Delete selected',
  'shortcuts.switchItem': 'Switch items',
  'shortcuts.clearSearch': 'Clear search / Deselect',
  'shortcuts.toggleWindow': 'Show / Hide window',

  'about.version': 'Version',
  'about.description': 'A lightweight, efficient cross-platform clipboard manager. Supports auto-capture, categorized storage, and quick retrieval of text, links, and images.',
  'about.techStack': 'Tech stack: Electron + React + TypeScript + Tailwind CSS',
  'about.storageEngine': 'Storage engine: SQLite (WASM)',

  'time.justNow': 'just now',
  'time.minutesAgo': '{n}m ago',
  'time.hoursAgo': '{n}h ago',
  'time.daysAgo': '{n}d ago',
  'time.weeksAgo': '{n}w ago',
  'time.monthsAgo': '{n}mo ago',
  'time.yearsAgo': '{n}y ago',
  'time.yesterday': 'Yesterday',
}

const translations: Record<Lang, Record<string, string>> = { 'zh-CN': zh, en }

export function t(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const dict = translations[lang] ?? zh
  let text = dict[key] ?? translations['zh-CN'][key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v))
    }
  }
  return text
}

let currentLang: Lang = 'zh-CN'

export function setLang(lang: Lang) {
  currentLang = lang
  try { localStorage.setItem('q-paste-language', lang) } catch {}
}

export function getLang(): Lang {
  return currentLang
}

export function loadLang(): Lang {
  try {
    const stored = localStorage.getItem('q-paste-language')
    if (stored === 'zh-CN' || stored === 'en') return stored
  } catch {}
  return 'zh-CN'
}

export function tr(key: string, params?: Record<string, string | number>): string {
  const dict = translations[currentLang] ?? translations['zh-CN']
  let text = dict[key] ?? translations['zh-CN'][key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v))
    }
  }
  return text
}

import { useSyncExternalStore } from 'react'

let listeners: (() => void)[] = []

function subscribe(cb: () => void) {
  listeners.push(cb)
  return () => { listeners = listeners.filter((l) => l !== cb) }
}

function getSnapshot() {
  return currentLang
}

export function notifyLangChange() {
  for (const cb of listeners) cb()
}

export function useT() {
  return {
    t: tr,
    lang: useSyncExternalStore(subscribe, getSnapshot),
  }
}
