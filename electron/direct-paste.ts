import type { BrowserWindow } from 'electron'

export const INPUT_KEYBOARD = 1
export const KEYEVENTF_KEYUP = 0x0002
export const VK_SHIFT = 0x10
export const VK_CONTROL = 0x11
export const VK_MENU = 0x12
export const VK_LWIN = 0x5b
export const VK_RWIN = 0x5c
export const VK_V = 0x56

export interface KeyboardInputEvent {
  vk: number
  keyUp?: boolean
}

/**
 * 构造 Win32 SendInput 所需的连续 INPUT 结构体数组缓冲区。
 * 64 位 Windows 上 sizeof(INPUT) = 40，32 位上为 28。
 */
export function buildKeyboardInputBuffer(
  events: KeyboardInputEvent[],
  is64Bit = process.arch !== 'ia32',
): { buffer: Buffer; structSize: number } {
  const structSize = is64Bit ? 40 : 28
  const buffer = Buffer.alloc(structSize * events.length)
  for (let i = 0; i < events.length; i++) {
    const offset = i * structSize
    const ev = events[i]
    buffer.writeUInt32LE(INPUT_KEYBOARD, offset)
    if (is64Bit) {
      buffer.writeUInt16LE(ev.vk & 0xffff, offset + 8)
      buffer.writeUInt16LE(0, offset + 10)
      buffer.writeUInt32LE(ev.keyUp ? KEYEVENTF_KEYUP : 0, offset + 12)
    } else {
      buffer.writeUInt16LE(ev.vk & 0xffff, offset + 4)
      buffer.writeUInt16LE(0, offset + 6)
      buffer.writeUInt32LE(ev.keyUp ? KEYEVENTF_KEYUP : 0, offset + 8)
    }
  }
  return { buffer, structSize }
}

/**
 * 构造发送 Ctrl+V 的按键序列；若 Alt / Shift / Win 仍处于按下态，先释放以避免触发组合冲突。
 */
export function buildPasteEvents(heldModifiers: number[] = []): KeyboardInputEvent[] {
  const release = heldModifiers
    .filter((vk) => vk !== VK_CONTROL)
    .map((vk) => ({ vk, keyUp: true }))
  return [
    ...release,
    { vk: VK_CONTROL, keyUp: false },
    { vk: VK_V, keyUp: false },
    { vk: VK_V, keyUp: true },
    { vk: VK_CONTROL, keyUp: true },
  ]
}

interface Win32User32Api {
  GetForegroundWindow: () => number | bigint
  GetClipboardOwner: () => number | bigint
  IsWindow: (hwnd: number | bigint) => number
  SetForegroundWindow: (hwnd: number | bigint) => number
  GetAsyncKeyState: (vKey: number) => number
  SendInput: (cInputs: number, pInputs: Uint8Array, cbSize: number) => number
  GetWindowThreadProcessId: (hwnd: number | bigint, lpdwProcessId: Uint32Array) => number
  GetWindowTextW: (hwnd: number | bigint, lpString: Uint16Array, nMaxCount: number) => number
}

interface Win32Kernel32Api {
  OpenProcess: (dwDesiredAccess: number, bInheritHandle: number, dwProcessId: number) => number | bigint
  QueryFullProcessImageNameW: (hProcess: number | bigint, dwFlags: number, lpExeName: Uint16Array, lpdwSize: Uint32Array) => number
  CloseHandle: (hObject: number | bigint) => number
}

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

const KNOWN_SOURCE_APPS: Record<string, string> = {
  chrome: 'Chrome',
  msedge: 'Edge',
  firefox: 'Firefox',
  brave: 'Brave',
  opera: 'Opera',
  arc: 'Arc',
  code: 'VS Code',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  antigravity: 'Antigravity',
  orca: 'Orca',
  idea64: 'IntelliJ IDEA',
  pycharm64: 'PyCharm',
  webstorm64: 'WebStorm',
  wechat: '微信',
  weixin: '微信',
  qq: 'QQ',
  tim: 'TIM',
  feishu: '飞书',
  lark: '飞书',
  dingtalk: '钉钉',
  wxwork: '企业微信',
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
  winword: 'Word',
  excel: 'Excel',
  powerpnt: 'PowerPoint',
  onenote: 'OneNote',
  wps: 'WPS',
  et: 'WPS 表格',
  wpp: 'WPS 演示',
  notepad: '记事本',
  'notepad++': 'Notepad++',
  obsidian: 'Obsidian',
  notion: 'Notion',
  typora: 'Typora',
  windowsterminal: 'Terminal',
  powershell: 'PowerShell',
  pwsh: 'PowerShell',
  cmd: '命令提示符',
  explorer: '资源管理器',
  snippingtool: '截图工具',
  screenclippinghost: '截图工具',
  snipaste: 'Snipaste',
  pixpin: 'PixPin',
  photoshop: 'Photoshop',
  figma: 'Figma',
  'q-paste': 'Q-Paste',
}

/**
 * 将 Windows 进程名（或可执行路径）与窗口标题整理为可读的应用显示名。
 */
export function formatSourceAppName(exePathOrName: string, windowTitle = ''): string {
  const cleanedPath = (exePathOrName || '').trim()
  const baseName = cleanedPath.split(/[\\/]/).pop() || ''
  const stem = baseName.replace(/\.exe$/i, '').trim()
  const lower = stem.toLowerCase()

  // UWP 宿主进程：取窗口标题作为应用名
  if (lower === 'applicationframehost' || lower === 'wwahost') {
    const title = windowTitle.trim()
    if (title) {
      const short = title.split(/\s+[-—|]\s+/).pop()?.trim() || title
      return short.slice(0, 32)
    }
  }

  if (lower && KNOWN_SOURCE_APPS[lower]) {
    return KNOWN_SOURCE_APPS[lower]
  }
  if (stem) {
    return stem.slice(0, 32)
  }
  const title = windowTitle.trim()
  return title ? title.slice(0, 32) : ''
}

let cachedUser32: Win32User32Api | null | undefined
let cachedKernel32: Win32Kernel32Api | null | undefined

function loadUser32(): Win32User32Api | null {
  if (cachedUser32 !== undefined) return cachedUser32
  if (process.platform !== 'win32') {
    cachedUser32 = null
    return null
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi') as typeof import('koffi')
    const user32 = koffi.load('user32.dll')
    cachedUser32 = {
      GetForegroundWindow: user32.func('uintptr_t __stdcall GetForegroundWindow()'),
      GetClipboardOwner: user32.func('uintptr_t __stdcall GetClipboardOwner()'),
      IsWindow: user32.func('int __stdcall IsWindow(uintptr_t hwnd)'),
      SetForegroundWindow: user32.func('int __stdcall SetForegroundWindow(uintptr_t hwnd)'),
      GetAsyncKeyState: user32.func('int16_t __stdcall GetAsyncKeyState(int vKey)'),
      SendInput: user32.func('uint32_t __stdcall SendInput(uint32_t cInputs, uint8_t* pInputs, int cbSize)'),
      GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hwnd, _Out_ uint32_t* lpdwProcessId)'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(uintptr_t hwnd, _Out_ uint16_t* lpString, int nMaxCount)'),
    }
  } catch {
    cachedUser32 = null
  }
  return cachedUser32
}

function loadKernel32(): Win32Kernel32Api | null {
  if (cachedKernel32 !== undefined) return cachedKernel32
  if (process.platform !== 'win32') {
    cachedKernel32 = null
    return null
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi') as typeof import('koffi')
    const kernel32 = koffi.load('kernel32.dll')
    cachedKernel32 = {
      OpenProcess: kernel32.func('uintptr_t __stdcall OpenProcess(uint32_t dwDesiredAccess, int bInheritHandle, uint32_t dwProcessId)'),
      QueryFullProcessImageNameW: kernel32.func('int __stdcall QueryFullProcessImageNameW(uintptr_t hProcess, uint32_t dwFlags, _Out_ uint16_t* lpExeName, _Inout_ uint32_t* lpdwSize)'),
      CloseHandle: kernel32.func('int __stdcall CloseHandle(uintptr_t hObject)'),
    }
  } catch {
    cachedKernel32 = null
  }
  return cachedKernel32
}

function readUtf16Buffer(buf: Uint16Array, length: number): string {
  if (length <= 0) return ''
  return Buffer.from(buf.buffer, buf.byteOffset, length * 2).toString('utf16le').replace(/\0+$/, '')
}

function readSourceAppFromHwnd(hwnd: bigint): string {
  const user32 = loadUser32()
  const kernel32 = loadKernel32()
  if (!user32 || !kernel32 || hwnd === 0n) return ''
  try {
    const handleArg = process.arch === 'ia32' ? Number(hwnd) : hwnd
    const pidOut = new Uint32Array(1)
    user32.GetWindowThreadProcessId(handleArg, pidOut)
    const pid = pidOut[0]
    let windowTitle = ''
    const titleBuf = new Uint16Array(256)
    const titleLen = user32.GetWindowTextW(handleArg, titleBuf, titleBuf.length)
    if (titleLen > 0) windowTitle = readUtf16Buffer(titleBuf, titleLen)

    let exePath = ''
    if (pid > 0) {
      const hProc = toBigIntHandle(kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid))
      if (hProc !== 0n) {
        try {
          const procArg = process.arch === 'ia32' ? Number(hProc) : hProc
          const pathBuf = new Uint16Array(512)
          const sizeOut = new Uint32Array([pathBuf.length])
          if (kernel32.QueryFullProcessImageNameW(procArg, 0, pathBuf, sizeOut)) {
            exePath = readUtf16Buffer(pathBuf, sizeOut[0])
          }
        } finally {
          const procArg = process.arch === 'ia32' ? Number(hProc) : hProc
          kernel32.CloseHandle(procArg)
        }
      }
    }
    return formatSourceAppName(exePath, windowTitle)
  } catch {
    return ''
  }
}

/**
 * 读取当前复制来源应用名：优先读取当前前台窗口，若为空则回退剪贴板拥有者窗口。
 */
export function captureForegroundSourceApp(): string {
  const user32 = loadUser32()
  if (!user32) return ''
  try {
    const fg = toBigIntHandle(user32.GetForegroundWindow())
    const fromFg = readSourceAppFromHwnd(fg)
    if (fromFg) return fromFg
    const owner = toBigIntHandle(user32.GetClipboardOwner())
    return readSourceAppFromHwnd(owner)
  } catch {
    return ''
  }
}

export function readWindowHandle(window: BrowserWindow | null): bigint {
  if (!window || window.isDestroyed()) return 0n
  try {
    const buffer = window.getNativeWindowHandle()
    return buffer.length >= 8 ? buffer.readBigUInt64LE() : BigInt(buffer.readUInt32LE())
  } catch {
    return 0n
  }
}

function toBigIntHandle(value: number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value || 0)
}

/**
 * 捕获当前前台窗口句柄；如果前台就是 Q-Paste 自身（或无效）则返回 null。
 */
export function captureExternalForegroundWindow(ownWindow: BrowserWindow | null): bigint | null {
  const api = loadUser32()
  if (!api) return null
  try {
    const fg = toBigIntHandle(api.GetForegroundWindow())
    const own = readWindowHandle(ownWindow)
    if (fg === 0n || (own !== 0n && fg === own)) return null
    return fg
  } catch {
    return null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 隐藏主窗口、恢复上一个前台窗口焦点并发送 Ctrl+V。
 * 遇到非 Windows、目标窗口已关闭或 UIPI 提权窗口拦截时优雅降级返回 `{ pasted: false }`。
 */
export async function pasteToPreviousWindow(
  targetHwnd: bigint | null,
  ownWindow: BrowserWindow | null,
): Promise<{ pasted: boolean }> {
  const api = loadUser32()
  if (!api) return { pasted: false }

  const ownHwnd = readWindowHandle(ownWindow)
  if (ownWindow && !ownWindow.isDestroyed() && ownWindow.isVisible()) {
    ownWindow.hide()
  }

  // 等待 Windows 完成窗口隐藏与前台焦点回切
  await sleep(50)

  if (targetHwnd && targetHwnd !== 0n && targetHwnd !== ownHwnd) {
    try {
      const handleArg = process.arch === 'ia32' ? Number(targetHwnd) : targetHwnd
      if (api.IsWindow(handleArg)) {
        const currentFg = toBigIntHandle(api.GetForegroundWindow())
        if (currentFg !== targetHwnd) {
          api.SetForegroundWindow(handleArg)
          await sleep(45)
        }
      }
    } catch {
      // 忽略焦点切换异常，继续尝试向当前前台粘贴
    }
  }

  // 检查当前前台是否仍为自身（若是则取消粘贴避免误粘给自己）
  try {
    const fgNow = toBigIntHandle(api.GetForegroundWindow())
    if (ownHwnd !== 0n && fgNow === ownHwnd) {
      return { pasted: false }
    }
    const modifiersToCheck = [VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN]
    const heldModifiers = modifiersToCheck.filter((vk) => (api.GetAsyncKeyState(vk) & 0x8000) !== 0)
    const events = buildPasteEvents(heldModifiers)
    const { buffer, structSize } = buildKeyboardInputBuffer(events)
    const sent = api.SendInput(events.length, buffer, structSize)
    return { pasted: sent === events.length }
  } catch {
    return { pasted: false }
  }
}
