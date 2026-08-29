/**
 * 局域网文件传输聊天视图（1:1 移植自 Tiez FileTransferChatView.tsx，适配 Electron）。
 * 交互与 Tiez 一致：QR/地址面板、消息气泡（文本链接化/图片/视频/文件卡片）、
 * 拖拽发送、加号多选文件、粘贴图片、全屏编辑、右键菜单、智能滚动。
 */
import { useState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Plus, Maximize2, Minimize2, ExternalLink, Folder, RotateCcw, Image as ImageIcon, Link as LinkIcon, Clipboard, Video, Send } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import { tr } from '../i18n'
import type { FtDeviceInfo, FtMessage, FtStatus } from '../types'

interface FileTransferChatProps {
  status: FtStatus | null
  localIp: string
}

type ContextMenuState = {
  x: number
  y: number
  filePath?: string
  content?: string
  id?: number
  type?: string
}

/** 本地绝对路径 → ft-file 流式预览 URL（Electron 自定义协议，等价 Tiez convertFileSrc） */
function ftFileUrl(p: string): string {
  return `ft-file:///${p.replace(/\\/g, '/').replace(/^\//, '')}`
}

const URL_REGEX = /((https?:\/\/|www\.)[^\s<]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,})(?:\/[^\s<]*)?)/gi

function normalizeUrl(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
}

function splitTrailingPunctuation(raw: string): { url: string; trailing: string } {
  let url = raw
  let trailing = ''
  while (url.length > 0 && /[)\]}>.,;!?]$/.test(url)) {
    trailing = url.slice(-1) + trailing
    url = url.slice(0, -1)
  }
  return { url, trailing }
}

export default function FileTransferChat({ status, localIp }: FileTransferChatProps) {
  const [messages, setMessages] = useState<FtMessage[]>([])
  const [input, setInput] = useState('')
  const [appLogo, setAppLogo] = useState('')
  const [onlineDevices, setOnlineDevices] = useState<FtDeviceInfo[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [showFullScreen, setShowFullScreen] = useState(false)
  const [showExpandBtn, setShowExpandBtn] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [isUserScrolling, setIsUserScrolling] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatBoxRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const prevMessagesLengthRef = useRef(0)
  const actualPort = status?.port ? String(status.port) : ''

  const fetchMessages = () => {
    window.electronAPI?.ftGetChatHistory().then(setMessages).catch(() => {})
  }

  useEffect(() => {
    fetchMessages()
    window.electronAPI?.ftGetAppLogo().then(setAppLogo).catch(() => {})
    const offDevices = window.electronAPI?.onFtDevicesUpdated(setOnlineDevices)
    const offMsg = window.electronAPI?.onFtNewMessage(fetchMessages)
    return () => {
      offDevices?.()
      offMsg?.()
    }
  }, [])

  // 智能滚动：用户上翻时不打扰
  useEffect(() => {
    const chatBox = chatBoxRef.current
    if (!chatBox) return
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = chatBox
      setIsUserScrolling(scrollHeight - scrollTop - clientHeight >= 50)
    }
    chatBox.addEventListener('scroll', handleScroll)
    return () => chatBox.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const hasNew = messages.length > prevMessagesLengthRef.current
    prevMessagesLengthRef.current = messages.length
    if (hasNew && !isUserScrolling) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isUserScrolling])

  // 输入框自适应高度（>120px 显示全屏编辑按钮）
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '32px'
    const scrollHeight = el.scrollHeight
    setShowExpandBtn(scrollHeight > 120)
    el.style.height = `${Math.min(Math.max(32, scrollHeight), 120)}px`
  }, [input])

  // 右键菜单点击外部关闭
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [contextMenu])

  const send = () => {
    if (!input.trim()) return
    void window.electronAPI?.ftSendChatText(input)
    setInput('')
    setShowFullScreen(false)
    if (textareaRef.current) textareaRef.current.style.height = '32px'
    setTimeout(fetchMessages, 150)
  }

  const sendPaths = (paths: string[]) => {
    const valid = paths.filter((p) => p && p.trim())
    if (valid.length === 0) return
    // 与 Tiez 一致：先放占位消息（_preparing），发送后刷新历史替换
    setMessages((prev) => [
      ...prev,
      ...valid.map((p) => ({
        id: Date.now() + Math.random(),
        direction: 'out' as const,
        msg_type: 'file',
        content: 'Preparing...',
        timestamp: Date.now(),
        _fileName: p.split(/[/\\]/).pop() || 'File',
        _preparing: true,
      })),
    ])
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    for (const p of valid) void window.electronAPI?.ftSendFile(p)
    setTimeout(fetchMessages, 500)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const paths: string[] = []
    for (const file of Array.from(e.dataTransfer.files)) {
      try {
        const p = window.electronAPI?.ftPathForFile(file)
        if (p) paths.push(p)
      } catch {}
    }
    sendPaths(paths)
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    const imageFiles = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
    if (imageFiles.length === 0) return
    e.preventDefault()
    for (const file of imageFiles) {
      const reader = new FileReader()
      reader.onload = async (ev) => {
        const base64 = ev.target?.result as string
        if (!base64) return
        try {
          const savedPath = await window.electronAPI.ftSaveTempImage(base64)
          void window.electronAPI.ftSendFile(savedPath)
        } catch (err) {
          console.error('Failed to paste image', err)
        }
      }
      reader.readAsDataURL(file)
    }
  }

  const getAvatarConfig = (m: FtMessage) => {
    if (m.sender_id === 'pc' || m.direction === 'out') {
      return { isImg: !!appLogo, content: appLogo || 'PC', initial: 'PC' }
    }
    const gradients = [
      'linear-gradient(135deg,#667eea,#764ba2)', 'linear-gradient(135deg,#f093fb,#f5576c)',
      'linear-gradient(135deg,#4facfe,#00f2fe)', 'linear-gradient(135deg,#43e97b,#38f9d7)',
      'linear-gradient(135deg,#fa709a,#fee140)', 'linear-gradient(135deg,#30cfd0,#330867)',
      'linear-gradient(135deg,#a8edea,#fed6e3)', 'linear-gradient(135deg,#ff9a9e,#fecfef)',
    ]
    const id = m.sender_id || 'mobile'
    let hash = 0
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash)
    let initial = 'M'
    if (m.sender_name) {
      const name = m.sender_name.toLowerCase()
      if (name.includes('iphone')) initial = 'iP'
      else if (name.includes('ipad')) initial = 'iD'
      else if (name.includes('android')) initial = 'An'
      else if (name.includes('手机')) initial = 'M'
      else initial = m.sender_name.charAt(0).toUpperCase()
    }
    return { isImg: false, content: gradients[Math.abs(hash) % gradients.length], initial }
  }

  const renderTextWithLinks = (text: string): ReactNode => {
    const parts: ReactNode[] = []
    let lastIndex = 0
    text.replace(URL_REGEX, (match, _g, _p, offset: number) => {
      if (match.includes('@')) return match
      const prevChar = offset > 0 ? text[offset - 1] : ''
      if (prevChar && /[a-z0-9@]/i.test(prevChar)) return match
      if (offset > lastIndex) parts.push(text.slice(lastIndex, offset))
      const { url, trailing } = splitTrailingPunctuation(match)
      const href = normalizeUrl(url)
      parts.push(
        <a
          key={`link-${offset}`}
          href={href}
          className="wt-link"
          style={{ color: 'var(--accent)', textDecoration: 'underline' }}
          onClick={(e) => {
            e.preventDefault()
            if (window.getSelection()?.toString()) return
            void window.electronAPI?.openUrl(href)
          }}
        >
          {url}
        </a>,
      )
      if (trailing) parts.push(trailing)
      lastIndex = offset + match.length
      return match
    })
    return parts.length > 0 ? parts : text
  }

  const messageImageSrc = (m: FtMessage): string => {
    if (m.content.startsWith('data:')) return m.content
    if (m.file_path) return ftFileUrl(m.file_path)
    if (m.content.startsWith('/download/')) return localIp && actualPort ? `http://${localIp}:${actualPort}${m.content}` : m.content
    return m.content.startsWith('ft-file:/') || /^[a-zA-Z]:[/\\]/.test(m.content) ? ftFileUrl(m.content) : m.content
  }

  const menuOpen = (cm: ContextMenuState) => {
    if (!cm.filePath) return
    void window.electronAPI?.ftOpenPath(cm.filePath)
    setContextMenu(null)
  }

  return (
    <div
      className="relative flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 overflow-hidden"
      style={{ height: '480px' }}
      onDragOver={(e) => {
        e.preventDefault()
        if (!isDragging) setIsDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setIsDragging(false)
      }}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-zinc-900/60 dark:bg-black/60 backdrop-blur-sm pointer-events-none">
          <Folder size={56} className="text-white" strokeWidth={1.5} />
          <div className="text-xl font-bold text-white">Drop to Send</div>
        </div>
      )}

      {localIp && actualPort && (
        <div className="flex items-center gap-4 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="rounded-md bg-white p-1 border border-zinc-200 dark:border-zinc-700">
            <QRCodeCanvas value={`http://${localIp}:${actualPort}`} size={64} />
          </div>
          <div className="flex flex-col gap-0.5 font-mono text-[11px]">
            <div><span className="opacity-60">LOCAL IP: </span><span>{localIp}</span></div>
            <div><span className="opacity-60">PORT: </span><span>{actualPort}</span></div>
            <div>
              <span className="opacity-60">ONLINE: </span>
              <span style={{ color: 'var(--accent)' }}>{onlineDevices.length} {tr('ft.devicesConnected')}</span>
            </div>
          </div>
        </div>
      )}

      <div ref={chatBoxRef} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="opacity-50 text-center mt-10 text-xs font-mono">{tr('ft.waitingConnection')}</div>
        )}
        {messages.map((m) => {
          const avatar = getAvatarConfig(m)
          const sent = m.direction === 'out'
          return (
            <div key={m.id} className={`flex gap-2.5 max-w-[85%] ${sent ? 'self-end flex-row-reverse' : 'self-start'}`}>
              <div
                className="w-8 h-8 rounded-md flex items-center justify-center font-bold text-[13px] flex-shrink-0 overflow-hidden text-white"
                style={{ background: avatar.isImg ? 'transparent' : avatar.content }}
              >
                {avatar.isImg ? <img src={avatar.content} className="w-full h-full object-cover" alt="" /> : avatar.initial}
              </div>
              <div className={`px-3.5 py-2.5 text-[13px] leading-relaxed break-all rounded-lg border ${
                sent
                  ? 'bg-[var(--accent)] text-white border-transparent'
                  : 'bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border-zinc-200 dark:border-zinc-700'
              }`}>
                {!sent && m.sender_name && (
                  <div className="text-[10px] opacity-70 mb-1 font-bold">{m.sender_name}</div>
                )}
                {m.msg_type === 'text' && (
                  <div
                    className="whitespace-pre-wrap select-text"
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextMenu({ x: e.clientX, y: e.clientY, content: m.content, type: 'text' })
                    }}
                  >
                    {renderTextWithLinks(m.content)}
                  </div>
                )}
                {m.msg_type === 'image' && (
                  <>
                    <img
                      src={messageImageSrc(m)}
                      className="max-w-full max-h-[300px] rounded-lg border border-black/10 mb-1 object-contain cursor-pointer"
                      alt="Image"
                      onClick={() => menuOpen({ x: 0, y: 0, filePath: m.file_path || m.content })}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setContextMenu({ x: e.clientX, y: e.clientY, filePath: m.file_path || m.content, content: m.content, id: m.id, type: 'image' })
                      }}
                    />
                    <div className="text-[11px] opacity-70 flex items-center gap-1 mt-1"><ImageIcon size={12} /><span>Image</span></div>
                  </>
                )}
                {m.msg_type === 'video' && (
                  <>
                    <video
                      src={m.file_path ? ftFileUrl(m.file_path) : m.content.startsWith('/download/') ? (localIp && actualPort ? `http://${localIp}:${actualPort}${m.content}` : m.content) : ftFileUrl(m.content)}
                      className="w-full max-w-full rounded-lg bg-black max-h-[300px]"
                      controls
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setContextMenu({ x: e.clientX, y: e.clientY, filePath: m.file_path || m.content, content: m.content, id: m.id, type: 'video' })
                      }}
                    />
                    <div className="text-[11px] opacity-70 flex items-center gap-1 mt-1"><Video size={12} /><span>Video</span></div>
                  </>
                )}
                {(m.msg_type === 'file' || (m.msg_type !== 'text' && m.msg_type !== 'image' && m.msg_type !== 'video')) && (
                  <div
                    className="flex items-center gap-3 cursor-default"
                    style={{ cursor: !sent && !m._preparing ? 'pointer' : 'default' }}
                    onClick={() => {
                      if (!sent && !m._preparing) menuOpen({ x: 0, y: 0, filePath: m.file_path || m.content })
                    }}
                    onContextMenu={(e) => {
                      if (m._preparing) return
                      e.preventDefault()
                      setContextMenu({ x: e.clientX, y: e.clientY, filePath: m.file_path || m.content, content: m.content, id: m.id, type: 'file' })
                    }}
                  >
                    <div className="text-2xl flex-shrink-0">{m._preparing ? '📤' : sent ? '📄' : '✅'}</div>
                    <div className="flex flex-col min-w-0">
                      <div className="font-mono text-xs font-bold whitespace-nowrap overflow-hidden text-ellipsis max-w-[220px]">
                        {m._preparing
                          ? m._fileName
                          : m.content.includes('name=')
                            ? decodeURIComponent(m.content.split('name=')[1])
                            : m.content.split(/[/\\]/).pop() || 'File Transfer'}
                      </div>
                      {!m._preparing && (
                        <div className="text-[10px] opacity-70">
                          {sent ? tr('ft.readyForDownload') : tr('ft.savedClickToOpen')}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex items-end gap-2 px-3 py-2.5 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <button
          className="w-8 h-8 flex-shrink-0 rounded-md border border-zinc-200 dark:border-zinc-700 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-600 dark:text-zinc-300"
          title={tr('ft.sendFile')}
          onClick={async () => {
            const paths = await window.electronAPI?.ftPickFiles()
            if (paths && paths.length > 0) sendPaths(paths)
          }}
        >
          <Plus size={16} />
        </button>
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            className="w-full min-h-[32px] max-h-[120px] px-3 py-1.5 text-xs rounded-md bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 outline-none focus:border-zinc-400 dark:focus:border-zinc-600 resize-none leading-5 transition-colors"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            onPaste={handlePaste}
            placeholder={tr('ft.typeMessage')}
            rows={1}
          />
          {showExpandBtn && (
            <button
              className="absolute right-1.5 bottom-1.5 w-6 h-6 rounded border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-500"
              onClick={() => setShowFullScreen(true)}
              title="Full Screen Edit"
            >
              <Maximize2 size={13} />
            </button>
          )}
        </div>
        <button
          className="w-9 h-8 flex-shrink-0 rounded-md flex items-center justify-center text-white transition-opacity disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
          onClick={send}
        >
          <Send size={16} />
        </button>
      </div>

      {showFullScreen && (
        <div className="absolute inset-0 z-40 flex flex-col p-4 bg-zinc-50 dark:bg-zinc-900">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold opacity-70">FULL SCREEN EDIT</div>
            <button className="p-1 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200" onClick={() => setShowFullScreen(false)} title="Minimize">
              <Minimize2 size={16} />
            </button>
          </div>
          <textarea
            className="flex-1 w-full p-4 text-sm rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 resize-none outline-none"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            placeholder="Type your message..."
          />
          <div className="flex justify-end gap-3 mt-3">
            <button className="h-8 px-4 rounded-md text-xs bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200" onClick={() => setShowFullScreen(false)}>CANCEL</button>
            <button className="h-8 px-4 rounded-md text-xs text-white" style={{ background: 'var(--accent)' }} onClick={send}>SEND</button>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          className="fixed z-50 min-w-[180px] py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg text-xs text-zinc-700 dark:text-zinc-200"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {(contextMenu.type === 'file' || contextMenu.type === 'image' || contextMenu.type === 'video') && (
            <>
              <FtMenuItem icon={<ExternalLink size={14} />} label={tr('ft.open')} onClick={() => { menuOpen(contextMenu) }} />
              <FtMenuItem
                icon={<Folder size={14} />}
                label={tr('ft.showInExplorer')}
                onClick={() => {
                  if (contextMenu.filePath) void window.electronAPI?.ftOpenPath(contextMenu.filePath.split(/[/\\]/).slice(0, -1).join('/') || contextMenu.filePath)
                  setContextMenu(null)
                }}
              />
              <div className="h-px bg-zinc-200 dark:bg-zinc-700 my-1 mx-2 opacity-60" />
            </>
          )}
          {contextMenu.type === 'image' && (
            <>
              <FtMenuItem
                icon={<RotateCcw size={14} style={{ transform: 'rotate(90deg)' }} />}
                label={tr('ft.saveImageAs')}
                onClick={() => {
                  if (contextMenu.filePath) {
                    void window.electronAPI.ftSaveFileAs(contextMenu.filePath, contextMenu.filePath.split(/[/\\]/).pop() || 'image.png')
                  }
                  setContextMenu(null)
                }}
              />
              <FtMenuItem
                icon={<ImageIcon size={14} />}
                label={tr('ft.copyImage')}
                onClick={() => {
                  if (contextMenu.filePath) {
                    void window.electronAPI.ftReadFileDataUrl(contextMenu.filePath).then((dataUrl) => {
                      if (dataUrl) void window.electronAPI.writeImage(dataUrl)
                    })
                  }
                  setContextMenu(null)
                }}
              />
              <FtMenuItem
                icon={<LinkIcon size={14} />}
                label={tr('ft.copyImageLink')}
                onClick={() => {
                  void navigator.clipboard.writeText(contextMenu.content?.startsWith('/download/') && localIp && actualPort ? `http://${localIp}:${actualPort}${contextMenu.content}` : contextMenu.content || '')
                  setContextMenu(null)
                }}
              />
            </>
          )}
          {contextMenu.type === 'video' && (
            <>
              <FtMenuItem
                icon={<RotateCcw size={14} style={{ transform: 'rotate(90deg)' }} />}
                label={tr('ft.saveVideoAs')}
                onClick={() => {
                  if (contextMenu.filePath) {
                    void window.electronAPI.ftSaveFileAs(contextMenu.filePath, contextMenu.filePath.split(/[/\\]/).pop() || 'video.mp4')
                  }
                  setContextMenu(null)
                }}
              />
              <FtMenuItem
                icon={<Video size={14} />}
                label={tr('ft.copyVideo')}
                onClick={() => {
                  if (contextMenu.filePath) void window.electronAPI.writeFiles([contextMenu.filePath])
                  setContextMenu(null)
                }}
              />
              <FtMenuItem
                icon={<LinkIcon size={14} />}
                label={tr('ft.copyVideoLink')}
                onClick={() => {
                  void navigator.clipboard.writeText(contextMenu.filePath || contextMenu.content || '')
                  setContextMenu(null)
                }}
              />
            </>
          )}
          {contextMenu.type === 'text' && (
            <FtMenuItem
              icon={<Clipboard size={14} />}
              label={tr('ft.copyText')}
              onClick={() => {
                void navigator.clipboard.writeText(contextMenu.content || '')
                setContextMenu(null)
              }}
            />
          )}
          {contextMenu.type === 'file' && (
            <FtMenuItem
              icon={<LinkIcon size={14} />}
              label={tr('ft.copyLink')}
              onClick={() => {
                void navigator.clipboard.writeText(contextMenu.content || '')
                setContextMenu(null)
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

function FtMenuItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 cursor-pointer" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </div>
  )
}
