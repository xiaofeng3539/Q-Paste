/**
 * 局域网文件传输服务（1:1 移植自 Tiez src-tauri/src/services/file_transfer/）。
 * - HTTP 路由：/ /ws /poll /send_text(/send-text) /upload /upload_chunk(/upload-chunk) /download/{token}
 * - 设备「发现」：手机打开页面后经 WebSocket 发送 identity 注册，断开即移除
 * - 断点续传：上传按 upload_id 依次保存分块；下载支持 HTTP Range（206）
 * - 传输队列：发送方串行（与 Tiez 一致：同一时刻仅一个上传在进行）
 */
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import mobilePageHtml from './mobile-page.html?raw'
import trustPageHtml from './trust-page.html?raw'
import { buildThemeCss, modeClass } from './theme'
import { parseMultipart, readRawBody } from './multipart'
import { attachWebSocket, isUpgradeRequest, acceptUpgrade } from './websocket'

export const FILE_TRANSFER_DEFAULT_PORT = 18888
/** 自动关闭：5 分钟无传输（与 Tiez 文案一致） */
const AUTO_CLOSE_IDLE_MS = 5 * 60 * 1000
const AUTO_CLOSE_TICK_MS = 10 * 1000
const STREAM_CHUNK_SIZE = 64 * 1024
const MAX_CHUNK_BODY_BYTES = 2 * 1024 * 1024
const MAX_CHUNK_METADATA_BYTES = 16 * 1024
const MAX_CONCURRENT_CHUNK_REQUESTS = 16
const MAX_UPLOAD_SESSIONS = 256
const UPLOAD_SESSION_IDLE_MS = 60 * 60 * 1000
const DEVICE_COOKIE = 'qpaste_lan_device'
const DEVICE_COOKIE_AGE_SECONDS = 365 * 24 * 60 * 60
const TRUST_REQUEST_COOLDOWN_MS = 3 * 1000

export interface FtMessage {
  id: number
  direction: 'in' | 'out'
  msg_type: string // text | file | image | video
  content: string
  timestamp: number
  sender_id: string
  sender_name: string
  file_path?: string
  upload_id?: string
}

export interface FtDeviceInfo {
  id: string
  name: string
  last_seen: number
}

export interface FtStatus {
  enabled: boolean
  port: number
  ip: string
}

export interface FtChunkMetadata {
  upload_id: string
  chunk_index: number
  total_chunks: number
  file_name: string
  sender_id: string
  sender_name: string
  total_size: number
  content_type?: string
}

interface UploadSession {
  meta: FtChunkMetadata
  tempPath: string
  nextChunk: number
  receivedBytes: number
  completed: boolean
  lastActivity: number
}

export interface FileTransferServerCallbacks {
  /** 接收完成后的文件目录 */
  getTransfersDir: () => string
  /** 未完成上传的临时目录 */
  getTempDir: () => string
  /** 手机拉取：返回当前 PC 剪贴板纯文本 */
  getClipboardText: () => string | Promise<string>
  /** 页面色深模式：light | dark | system */
  getColorMode: () => string
  /** 应用图标 base64 data URL（手机页头像） */
  getLogoBase64: () => string
  /** 收到手机文本（宿主负责入库/写剪贴板） */
  onReceiveText: (content: string, senderId: string, senderName: string) => void | Promise<void>
  /** 文件接收完成（宿主负责入库/写剪贴板/自动打开） */
  onFileReceived: (finalPath: string, fileName: string, contentType: string, senderId: string, senderName: string, msgType: string) => void | Promise<void>
  /** 状态变化（启停/端口） */
  onStatusChange: (status: FtStatus) => void
  /** 在线设备变化 */
  onDevicesChange: (devices: FtDeviceInfo[]) => void
  onPhoneShortcutOpen?: () => void
  deviceTrust?: {
    isTrusted: (digest: string) => boolean
    approve: (digest: string, address: string) => Promise<boolean>
  }
  /** 新聊天消息（宿主转发给渲染层） */
  onMessage: (msg: FtMessage) => void
}

function ts(): number {
  return Date.now()
}

function isSameOrigin(req: http.IncomingMessage): boolean {
  return Boolean(req.headers.host) && req.headers.origin === `http://${req.headers.host}`
}

function deviceDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function requestDeviceDigest(req: http.IncomingMessage): string | undefined {
  const prefix = `${DEVICE_COOKIE}=`
  const cookie = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))
  const token = cookie?.slice(prefix.length)
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) return deviceDigest(token)
}

function tsFolder(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

const execFileAsync = promisify(execFile)
let availableIpsRequest: Promise<string[]> | undefined

export function getAvailableIps(): Promise<string[]> {
  return availableIpsRequest ??= readAvailableIps().finally(() => { availableIpsRequest = undefined })
}

/** 移植 utils.rs get_available_ips：过滤虚拟网卡 + 网段打分排序 */
async function readAvailableIps(): Promise<string[]> {
  let connectedIps: Set<string> | undefined
  if (os.platform() === 'win32') {
    try {
      // Windows 会保留断开网卡的静态地址，networkInterfaces() 本身不提供连接状态。
      const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        "$ErrorActionPreference='Stop'; $connected=@(Get-NetIPInterface -AddressFamily IPv4 | Where-Object { $_.ConnectionState -eq 'Connected' } | Select-Object -ExpandProperty InterfaceIndex); @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceIndex -in $connected } | Select-Object -ExpandProperty IPAddress) | ConvertTo-Json -Compress",
      ], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
      const ips: unknown = JSON.parse(stdout.trim() || '[]')
      const list = typeof ips === 'string' ? [ips] : ips
      if (!Array.isArray(list) || !list.every((ip) => typeof ip === 'string')) throw new Error('Invalid network address list')
      connectedIps = new Set(list)
    } catch (error) {
      console.warn('[Q-Paste] 无法查询网卡连接状态，回退到系统地址列表:', error)
    }
  }
  const virtualHints = ['vnet', 'vbox', 'virtual', 'vmnet', 'tailscale', 'zerotier', 'pseudo', 'clash', 'wsl', 'vethernet', 'docker', 'hyper-v', 'radmin']
  const score = (name: string, ip: string): number => {
    let s = 0
    if (name.includes('wi-fi') || name.includes('wlan')) s += 10
    if (name.includes('ethernet')) s += 5
    if (ip.startsWith('192.168.')) s += 3
    if (ip.startsWith('10.')) s += 2
    return s
  }
  const candidates: Array<{ name: string; ip: string }> = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    const nameLower = name.toLowerCase()
    if (virtualHints.some((h) => nameLower.includes(h))) continue
    for (const addr of addrs ?? []) {
      if (addr.internal || addr.family !== 'IPv4') continue
      if (connectedIps && !connectedIps.has(addr.address)) continue
      if (addr.address.startsWith('192.168.') || addr.address.startsWith('10.') || addr.address.startsWith('172.')) {
        candidates.push({ name: nameLower, ip: addr.address })
      }
    }
  }
  candidates.sort((a, b) => score(b.name, b.ip) - score(a.name, a.ip))
  return candidates.map((c) => c.ip)
}

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.webm': 'video/webm', '.wmv': 'video/x-ms-wmv', '.flv': 'video/x-flv',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.json': 'application/json', '.zip': 'application/zip', '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/** 供渲染层预览任意传输文件时复用 */
export function guessMime(p: string): string {
  const ext = path.extname(p).toLowerCase()
  return MIME_MAP[ext] ?? 'application/octet-stream'
}

function isImageName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(name)
}
function isVideoName(name: string): boolean {
  return /\.(mp4|mkv|avi|mov|wmv|flv|webm)$/i.test(name)
}

export class FileTransferServer {
  private server: http.Server | null = null
  private startPromise: Promise<number> | null = null
  private startGeneration = 0
  private port = 0
  private displayIp = ''
  private enabled = false
  private autoClose = false
  private autoCloseTimer: ReturnType<typeof setInterval> | null = null
  private lastActivity = 0
  /** 配对码（已停用，骨架保留：恢复时由 start(opts.pin) 赋值并放开 checkPin） */
  private pin = ''
  private bindHost = '0.0.0.0'

  /** 聊天历史（内存，重启清空 —— 与 Tiez ChatState 一致） */
  private messages: FtMessage[] = []
  private nextMessageId = 1
  private onlineDevices = new Map<string, FtDeviceInfo>()
  private uploadSessions = new Map<string, UploadSession>()
  private uploadLocks = new Map<string, Promise<void>>()
  private chunkRequests = 0
  private trustPromptOpen = false
  private nextTrustRequestAt = 0
  private sharedFiles = new Map<string, string>() // token → 本地路径
  private wsClients = new Map<net.Socket, { send: (t: string) => void; deviceId: string | null }>()

  constructor(private readonly cb: FileTransferServerCallbacks) {}

  get status(): FtStatus {
    return { enabled: this.enabled, port: this.port, ip: this.displayIp }
  }

  getChatHistory(): FtMessage[] {
    return [...this.messages]
  }

  clearChatHistory(): void {
    this.messages = []
  }

  getOnlineDevices(): FtDeviceInfo[] {
    return [...this.onlineDevices.values()]
  }

  private touch(): void {
    this.lastActivity = Date.now()
  }

  private sendJson2(res: http.ServerResponse, code: number, payload: unknown): void {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(payload))
  }

  private emitStatus(): void {
    this.cb.onStatusChange({ ...this.status })
  }

  private emitDevices(): void {
    this.cb.onDevicesChange(this.getOnlineDevices())
  }

  private broadcast(payload: unknown): void {
    const text = JSON.stringify(payload)
    for (const client of this.wsClients.values()) client.send(text)
  }

  /** 绑定端口：被占用自动 +1 递增（移植 bind_listener） */
  private bindListener(startPort: number): Promise<{ server: http.Server; port: number }> {
    return new Promise((resolve, reject) => {
      let attempt = startPort
      const tryBind = (): void => {
        const srv = http.createServer()
        const onError = (err: NodeJS.ErrnoException): void => {
          srv.close()
          srv.removeListener('listening', onListening)
          if (err.code === 'EADDRINUSE') {
            if (attempt >= 65535) {
              // 兜底：交给系统分配
              const fallback = http.createServer()
              fallback.listen(0, '0.0.0.0', () => {
                resolve({ server: fallback, port: (fallback.address() as net.AddressInfo).port })
              })
              return
            }
            attempt += 1
            tryBind()
            return
          }
          reject(err)
        }
        const onListening = (): void => {
          srv.removeListener('error', onError)
          resolve({ server: srv, port: attempt })
        }
        srv.once('error', onError)
        srv.once('listening', onListening)
        srv.listen(attempt, this.bindHost)
      }
      tryBind()
    })
  }

  async start(preferredPort = FILE_TRANSFER_DEFAULT_PORT, autoClose: boolean, opts?: { pin?: string; host?: string }): Promise<number> {
    if (this.enabled) {
      // 运行中重复调用：同步开关状态（不重绑端口）
      this.autoClose = autoClose
      if (autoClose) { this.touch(); this.startAutoCloseTimer() } else { this.stopAutoCloseTimer() }
      return this.port
    }
    if (this.startPromise) return this.startPromise
    const starting = this.startListening(preferredPort, autoClose, opts, this.startGeneration)
    this.startPromise = starting
    try {
      return await starting
    } finally {
      if (this.startPromise === starting) this.startPromise = null
    }
  }

  private async startListening(preferredPort: number, autoClose: boolean, opts: { pin?: string; host?: string } | undefined, generation: number): Promise<number> {
    const detectedIp = !this.displayIp || this.displayIp === '0.0.0.0' ? (await getAvailableIps())[0] : undefined
    if (generation !== this.startGeneration) throw new Error('文件传输服务启动已取消')
    // 配对码功能已移除：opts.pin 保留骨架，固定置空（恢复：此处读取 opts.pin 并放开 checkPin）
    this.pin = ''
    this.bindHost = opts?.host?.trim() || '0.0.0.0'
    const { server, port } = await this.bindListener(preferredPort)
    if (generation !== this.startGeneration) {
      server.close()
      throw new Error('文件传输服务启动已取消')
    }
    this.server = server
    this.port = port
    this.enabled = true
    this.autoClose = autoClose
    this.touch()
    // 等价 Tiez get_local_ip_addr：启动即探测展示用 IP
    if (!this.displayIp || this.displayIp === '0.0.0.0') {
      this.displayIp = detectedIp ?? '127.0.0.1'
    }
    server.on('request', (req, res) => this.handleRequest(req, res))
    server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket as net.Socket, head))
    this.startAutoCloseTimer()
    this.emitStatus()
    return port
  }

  stop(): void {
    this.startGeneration += 1
    this.startPromise = null
    if (this.server) {
      for (const [socket] of this.wsClients) socket.destroy()
      this.wsClients.clear()
      this.onlineDevices.clear()
      this.sharedFiles.clear()
      this.server.close()
      this.server = null
    }
    this.stopAutoCloseTimer()
    this.enabled = false
    this.port = 0
    this.displayIp = ''
    this.emitStatus()
    this.emitDevices()
  }

  setDisplayIp(ip: string): void {
    this.displayIp = ip
    this.emitStatus()
  }

  setAutoClose(enabled: boolean): void {
    this.autoClose = enabled
    if (enabled) {
      this.touch()
      this.startAutoCloseTimer()
    } else {
      this.stopAutoCloseTimer()
    }
  }

  private startAutoCloseTimer(): void {
    if (this.autoCloseTimer) return
    this.autoCloseTimer = setInterval(() => {
      if (!this.enabled || !this.autoClose || this.chunkRequests > 0) return
      // 5 分钟无任何活动（传输/消息/连接）→ 自动停止并同步状态到 UI
      if (Date.now() - this.lastActivity >= AUTO_CLOSE_IDLE_MS) {
        console.log('[Q-Paste][FT] 5 分钟无活动，服务已自动关闭')
        this.stop()
      }
    }, AUTO_CLOSE_TICK_MS)
  }

  private stopAutoCloseTimer(): void {
    if (this.autoCloseTimer) clearInterval(this.autoCloseTimer)
    this.autoCloseTimer = null
  }

  /** PC → 手机：发送本地文件（等价 send_file_to_client + append_message 的令牌包装） */
  sendFileToClient(filePath: string): FtMessage | null {
    this.touch()
    if (!this.enabled || !this.displayIp || this.displayIp === '0.0.0.0') return null
    const token = randomUUID()
    this.sharedFiles.set(token, filePath)
    const lower = filePath.toLowerCase()
    const msgType = isImageName(lower) ? 'image' : isVideoName(lower) ? 'video' : 'file'
    return this.appendMessage('out', msgType, filePath, 'pc', '电脑', filePath)
  }

  /** PC → 手机：发送文本（send_chat_message） */
  sendChatText(content: string): FtMessage {
    return this.appendMessage('out', 'text', content, 'pc', '电脑', undefined)
  }

  /** 手机下载 PC 文件的短链（get_download_url 的 /download/{token}?name= 形态） */
  getDownloadUrl(filePath: string): string {
    const token = `fallback_${randomUUID()}`
    this.sharedFiles.set(token, filePath)
    const filename = path.basename(filePath)
    return `/download/${token}?name=${encodeURIComponent(filename)}`
  }

  /** 追加聊天消息并广播（移植 append_message：文件路径包装为 /download 令牌） */
  private appendMessage(direction: 'in' | 'out', msgType: string, content: string, senderId: string, senderName: string, filePath?: string, uploadId?: string): FtMessage {
    let finalContent = content
    if ((msgType === 'image' || msgType === 'video' || msgType === 'file') && !finalContent.startsWith('data:') && !finalContent.startsWith('/download/')) {
      if (filePath) {
        const token = `${Date.now()}_${randomUUID()}`
        this.sharedFiles.set(token, filePath)
        finalContent = `/download/${token}?name=${encodeURIComponent(path.basename(filePath))}`
      }
    }
    const msg: FtMessage = {
      id: this.nextMessageId++,
      direction,
      msg_type: msgType,
      content: finalContent,
      timestamp: ts(),
      sender_id: senderId,
      sender_name: senderName,
      file_path: filePath,
      ...(uploadId ? { upload_id: uploadId } : {}),
    }
    this.messages.push(msg)
    this.broadcast(msg)
    this.cb.onMessage(msg)
    return msg
  }

  /** 文件接收完成的统一登记（移植 register_received_file，剪贴板/入库交由宿主回调） */
  private async registerReceivedFile(finalPath: string, fileName: string, contentType: string, senderId: string, senderName: string, uploadId?: string): Promise<void> {
    const isImage = contentType.startsWith('image/') || isImageName(fileName)
    const isVideo = contentType.startsWith('video/') || isVideoName(fileName)
    const msgType = isImage ? 'image' : isVideo ? 'video' : 'file'
    this.appendMessage('in', msgType, finalPath, senderId, senderName, finalPath, uploadId)
    await this.cb.onFileReceived(finalPath, fileName, contentType, senderId, senderName, msgType)
  }

  /* ---------------- 路由处理 ---------------- */

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const urlPath = (req.url ?? '/').split('?')[0]
    const method = (req.method ?? 'GET').toUpperCase()
    Promise.resolve(this.route(method, urlPath, req, res)).catch((err) => {
      console.error('[Q-Paste][FT] request error:', err)
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Internal error')
    })
  }

  /** 配对码校验（入口已关闭：恒通过。恢复：还原下方注释逻辑） */
  private checkPin(req: http.IncomingMessage): boolean {
    // const q = new URL(req.url ?? '/', 'http://localhost').searchParams.get('pin') ?? ''
    // const header = (req.headers['x-pin'] as string) ?? ''
    // return q === this.pin || header === this.pin
    return true
  }

  private isTrustedDevice(req: http.IncomingMessage): boolean {
    const trust = this.cb.deviceTrust
    if (!trust) return true
    const digest = requestDeviceDigest(req)
    return Boolean(digest && trust.isTrusted(digest))
  }

  private async requestDeviceTrust(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    req.resume()
    const trust = this.cb.deviceTrust
    if (!trust) { res.writeHead(404).end(); return }
    if (!isSameOrigin(req)) { res.writeHead(403).end(); return }
    if (this.isTrustedDevice(req)) { res.writeHead(204).end(); return }
    if (this.trustPromptOpen || ts() < this.nextTrustRequestAt) {
      res.writeHead(429).end()
      return
    }

    this.trustPromptOpen = true
    this.touch()
    const generation = this.startGeneration
    const token = randomBytes(32).toString('base64url')
    try {
      const approved = await trust.approve(deviceDigest(token), req.socket.remoteAddress ?? '')
      if (!approved || generation !== this.startGeneration) {
        res.writeHead(403).end()
        return
      }
      res.writeHead(204, {
        'Set-Cookie': `${DEVICE_COOKIE}=${token}; Path=/; Max-Age=${DEVICE_COOKIE_AGE_SECONDS}; HttpOnly; SameSite=Strict`,
      }).end()
    } finally {
      this.nextTrustRequestAt = ts() + TRUST_REQUEST_COOLDOWN_MS
      this.trustPromptOpen = false
    }
  }

  private async route(method: string, urlPath: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (this.cb.deviceTrust) {
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Referrer-Policy', 'same-origin')
      res.setHeader('X-Content-Type-Options', 'nosniff')
    }
    if (method === 'GET' && (urlPath === '/' || urlPath === '/index.html')) return this.serveIndex(req, res)
    // Keep shortcuts saved with the previous QR code working.
    if (method === 'GET' && /^\/shortcut\/[a-f0-9]{32}$/.test(urlPath)) {
      res.writeHead(302, { Location: '/', 'Referrer-Policy': 'no-referrer' }).end()
      return
    }
    if (method === 'POST' && urlPath === '/api/trust-device') return this.requestDeviceTrust(req, res)
    if (!this.isTrustedDevice(req)) {
      req.resume()
      res.writeHead(401).end('Device approval required')
      return
    }
    if (this.cb.deviceTrust && method === 'POST' && !isSameOrigin(req)) {
      req.resume()
      res.writeHead(403).end()
      return
    }
    if (method === 'POST' && urlPath === '/api/open-desktop') {
      if (!isSameOrigin(req)) {
        res.writeHead(403).end()
        return
      }
      this.touch()
      this.cb.onPhoneShortcutOpen?.()
      res.writeHead(204).end()
      return
    }
    // 配对码端点（已停用，骨架保留）：恒返回未启用，兼容旧缓存页面
    if (method === 'GET' && urlPath === '/api/pin-required') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ required: false }))
      return
    }
    if (method === 'GET' && urlPath === '/api/pin-check') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (!this.checkPin(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'pin required' }))
      return
    }
    if (method === 'GET' && urlPath === '/api/clipboard') {
      this.sendJson2(res, 200, { ok: true, content: await this.cb.getClipboardText(), updatedAt: Date.now() })
      return
    }
    if (method === 'GET' && urlPath === '/poll') return this.servePoll(req, res)
    if (method === 'POST' && (urlPath === '/send_text' || urlPath === '/send-text')) return this.serveSendText(req, res)
    if (method === 'POST' && urlPath === '/upload') return this.serveUpload(req, res)
    if (method === 'POST' && (urlPath === '/upload_chunk' || urlPath === '/upload-chunk')) return this.serveUploadChunk(req, res)
    if (method === 'GET' && urlPath.startsWith('/download/')) return this.serveDownload(req, res, decodeURIComponent(urlPath.slice('/download/'.length)))
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
  }

  private serveIndex(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.isTrustedDevice(req)) {
      const nonce = randomBytes(16).toString('base64')
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`,
      }).end(trustPageHtml.replace('__NONCE__', nonce))
      return
    }
    const html = mobilePageHtml
      .replace('__THEME__', 'mica')
      .replace('__MODE_CLASS__', modeClass(this.cb.getColorMode()))
      .replace('__THEME_CSS__', buildThemeCss(this.cb.getColorMode()))
      .replace('__LOGO__', this.cb.getLogoBase64())
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, must-revalidate',
    })
    res.end(html)
  }

  /** 轮询兜底：id > last_id 的消息；图片本地路径转 /download 令牌（移植 poll_messages） */
  private servePoll(req: http.IncomingMessage, res: http.ServerResponse): void {
    const q = new URL(req.url ?? '/', 'http://localhost').searchParams
    const lastId = Number(q.get('last_id') ?? 0) || 0
    const out: FtMessage[] = []
    for (const m of this.messages) {
      if (m.id <= lastId) continue
      const clone: FtMessage = { ...m }
      if (clone.msg_type === 'image' && !clone.content.startsWith('data:') && !clone.content.startsWith('/download/')) {
        const token = `temp_${clone.id}`
        this.sharedFiles.set(token, clone.content)
        clone.content = `/download/${token}?name=${encodeURIComponent(path.basename(clone.content))}`
      }
      out.push(clone)
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(out))
  }

  private async serveSendText(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.touch()
    let body: Buffer
    try {
      body = await readRawBody(req, 16 * 1024 * 1024)
    } catch {
      res.writeHead(413); res.end(); return
    }
    let payload: { content?: string; sender_id?: string; sender_name?: string }
    try {
      payload = JSON.parse(body.toString('utf8'))
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Bad JSON'); return
    }
    const content = typeof payload.content === 'string' ? payload.content : ''
    if (!content) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Empty content'); return
    }
    const senderId = payload.sender_id?.trim() || 'mobile'
    const senderName = payload.sender_name?.trim() || '手机'
    this.appendMessage('in', 'text', content, senderId, senderName)
    await this.cb.onReceiveText(content, senderId, senderName)
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Text received')
  }

  /** 单次上传（协议兜底；手机页面全走分块） */
  private async serveUpload(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.touch()
    const parts = await parseMultipart(req)
    if (parts === null) {
      res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Body too large, use chunked upload')
      return
    }
    let senderId = 'mobile'
    let senderName = '手机'
    let success = false
    for (const part of parts) {
      if (part.name === 'sender_id' && part.data.length > 0) senderId = part.data.toString('utf8') || senderId
      else if (part.name === 'sender_name' && part.data.length > 0) senderName = part.data.toString('utf8') || senderName
      else if (part.name === 'file') {
        const fileName = part.filename || 'unknown.txt'
        const targetPath = this.uniqueSavePath(fileName)
        try {
          fs.writeFileSync(targetPath, part.data)
          await this.registerReceivedFile(targetPath, fileName, part.contentType || 'application/octet-stream', senderId, senderName)
          success = true
        } catch (err) {
          console.error('[Q-Paste][FT] upload write failed:', err)
        }
      }
    }
    res.writeHead(success ? 200 : 500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(success ? 'Upload successful' : 'Upload failed')
  }

  /** 分块上传：同一个上传 ID 的磁盘写入按序执行。 */
  private async serveUploadChunk(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.touch()
    if (this.chunkRequests >= MAX_CONCURRENT_CHUNK_REQUESTS) {
      req.resume()
      res.writeHead(503).end('Too many concurrent uploads')
      return
    }
    this.chunkRequests += 1
    try {
      const parts = await parseMultipart(req, MAX_CHUNK_BODY_BYTES)
      if (parts === null) {
        res.writeHead(400).end('Bad multipart')
        return
      }
      let meta: FtChunkMetadata | undefined
      let data: Buffer | undefined
      for (const part of parts) {
        if (part.name === 'metadata') {
          if (part.data.length <= MAX_CHUNK_METADATA_BYTES) {
            try { meta = JSON.parse(part.data.toString('utf8')) as FtChunkMetadata } catch { meta = undefined }
          }
        } else if (part.name === 'data' || part.name === 'file') {
          data = part.data
        }
      }
      if (!data || !meta || typeof meta.upload_id !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(meta.upload_id)
        || !Number.isSafeInteger(meta.total_chunks) || !Number.isSafeInteger(meta.chunk_index)
        || meta.chunk_index < 0 || meta.chunk_index >= meta.total_chunks
        || !Number.isSafeInteger(meta.total_size) || meta.total_size < 0
        || typeof meta.file_name !== 'string' || typeof meta.sender_id !== 'string' || typeof meta.sender_name !== 'string'
        || (meta.content_type !== undefined && typeof meta.content_type !== 'string')) {
        res.writeHead(400).end('Invalid chunk')
        return
      }

      const uploadKey = meta.upload_id.toLowerCase()
      let previous: Promise<void> | undefined
      while ((previous = this.uploadLocks.get(uploadKey))) await previous
      let release!: () => void
      this.uploadLocks.set(uploadKey, new Promise<void>((resolve) => { release = resolve }))
      try {
        await this.writeUploadChunk(uploadKey, meta, data, res)
      } finally {
        this.uploadLocks.delete(uploadKey)
        release()
      }
    } finally {
      this.chunkRequests -= 1
    }
  }

  private async writeUploadChunk(key: string, meta: FtChunkMetadata, data: Buffer, res: http.ServerResponse): Promise<void> {
    let session = this.uploadSessions.get(key)
    if (!session) {
      if (meta.chunk_index !== 0) {
        res.writeHead(410).end('Upload session expired')
        return
      }
      const now = ts()
      for (const [id, upload] of this.uploadSessions) {
        if (this.uploadLocks.has(id) || now - upload.lastActivity < UPLOAD_SESSION_IDLE_MS) continue
        this.uploadSessions.delete(id)
        if (!upload.completed) {
          const cleanup = fs.promises.rm(upload.tempPath, { force: true }).catch((error) => {
            console.warn('[Q-Paste][FT] could not remove expired upload:', error)
          })
          this.uploadLocks.set(id, cleanup)
          void cleanup.then(() => this.uploadLocks.delete(id))
        }
      }
      if (this.uploadSessions.size >= MAX_UPLOAD_SESSIONS) {
        const completed = [...this.uploadSessions].find(([id, upload]) => upload.completed && !this.uploadLocks.has(id))
        if (completed) this.uploadSessions.delete(completed[0])
      }
      if (this.uploadSessions.size >= MAX_UPLOAD_SESSIONS) {
        res.writeHead(503).end('Too many incomplete uploads')
        return
      }
      const tempDir = this.cb.getTempDir()
      session = { meta, tempPath: path.join(tempDir, `.tmp_${key}`), nextChunk: 0, receivedBytes: 0, completed: false, lastActivity: now }
      this.uploadSessions.set(key, session)
    }
    const original = session.meta
    if (original.upload_id !== meta.upload_id || original.file_name !== meta.file_name || original.sender_id !== meta.sender_id
      || original.total_chunks !== meta.total_chunks || original.total_size !== meta.total_size
      || meta.chunk_index > session.nextChunk) {
      res.writeHead(409).end('Chunk does not match upload session')
      return
    }
    session.lastActivity = ts()
    const isFinal = meta.chunk_index === meta.total_chunks - 1
    if (session.completed || (meta.chunk_index < session.nextChunk && !isFinal)) {
      res.writeHead(200).end(session.completed ? 'Upload complete' : 'Chunk received')
      return
    }

    if (meta.chunk_index === session.nextChunk) {
      const totalBytes = session.receivedBytes + data.length
      if (meta.total_size > 0 && (totalBytes > meta.total_size || (isFinal && totalBytes !== meta.total_size))) {
        res.writeHead(400).end('Chunk size does not match upload')
        return
      }
      if (!session.nextChunk) await fs.promises.mkdir(path.dirname(session.tempPath), { recursive: true })
      const handle = await fs.promises.open(session.tempPath, session.nextChunk ? 'r+' : 'w')
      try {
        for (let offset = 0; offset < data.length;) {
          const { bytesWritten } = await handle.write(data, offset, data.length - offset, session.receivedBytes + offset)
          if (!bytesWritten) throw new Error('Unable to write upload chunk')
          offset += bytesWritten
        }
        if (isFinal) await handle.truncate(totalBytes)
      } finally {
        await handle.close()
      }
      session.receivedBytes = totalBytes
      session.nextChunk += 1
    }

    if (isFinal) {
      const finalPath = await this.finalizeUpload(session.tempPath, original.file_name)
      session.completed = true
      session.lastActivity = ts()
      // Once committed, a retry must not write the completed file or emit a second receipt.
      try {
        await this.registerReceivedFile(finalPath, original.file_name, original.content_type || 'application/octet-stream', original.sender_id, original.sender_name, original.upload_id)
      } catch (err) {
        console.error('[Q-Paste][FT] upload notification failed:', err)
      }
      res.writeHead(200).end('Upload complete')
      return
    }
    res.writeHead(200).end('Chunk received')
  }

  private async finalizeUpload(tempPath: string, fileName: string): Promise<string> {
    // Reserving the name before an asynchronous move keeps concurrent uploads separate.
    let target: string
    for (;;) {
      target = this.uniqueSavePath(fileName)
      try {
        const reservation = await fs.promises.open(target, 'wx')
        await reservation.close()
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    try {
      try {
        await fs.promises.rename(tempPath, target)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
        await fs.promises.copyFile(tempPath, target)
        await fs.promises.rm(tempPath, { force: true }).catch((cleanupError) => {
          console.warn('[Q-Paste][FT] could not remove finalized upload temp file:', cleanupError)
        })
      }
    } catch (error) {
      await fs.promises.rm(target, { force: true })
      throw error
    }
    return target
  }

  /** 保存路径唯一化：{yyyyMMddHHmmss}_{原名}（与 Tiez 命名一致；同秒冲突时追加序号） */
  private uniqueSavePath(fileName: string): string {
    const dir = this.cb.getTransfersDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const safeName = path.basename(fileName).replace(/[\\/:*?"<>|]/g, '_') || 'unknown.txt'
    const base = `${tsFolder()}_${safeName}`
    let target = path.join(dir, base)
    let n = 1
    while (fs.existsSync(target)) {
      target = path.join(dir, `${tsFolder()}_${n++}_${safeName}`)
    }
    return target
  }

  /** PC → 手机文件下载代理：令牌 → 本地文件，支持 Range 206 断点续传 */
  private serveDownload(req: http.IncomingMessage, res: http.ServerResponse, token: string): void {
    this.touch()
    const filePath = this.sharedFiles.get(token)
    if (!filePath || !fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('File not found')
      return
    }
    const stat = fs.statSync(filePath)
    const totalSize = stat.size
    const filename = path.basename(filePath)
    const mime = guessMime(filePath)
    const inline = mime.startsWith('image/') || mime.startsWith('video/')
    const encodedName = encodeURIComponent(filename)
    const disposition = inline
      ? `inline; filename="${filename}"; filename*=UTF-8''${encodedName}`
      : `attachment; filename="${filename}"; filename*=UTF-8''${encodedName}`
    const commonHeaders: Record<string, string> = {
      'Content-Type': mime,
      'Content-Disposition': disposition,
      'Accept-Ranges': 'bytes',
    }
    if (this.cb.deviceTrust) commonHeaders['Content-Security-Policy'] = 'sandbox'

    const range = req.headers.range
    if (range && range.startsWith('bytes=')) {
      const [startStr, endStr] = range.slice('bytes='.length).split('-')
      const start = Number(startStr) || 0
      const end = Math.min(Number(endStr) || totalSize - 1, totalSize - 1)
      if (start < totalSize && start <= end) {
        const contentLength = end - start + 1
        res.writeHead(206, {
          ...commonHeaders,
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Content-Length': String(contentLength),
        })
        const stream = fs.createReadStream(filePath, { start, end, highWaterMark: STREAM_CHUNK_SIZE })
        stream.pipe(res)
        return
      }
    }

    res.writeHead(200, { ...commonHeaders, 'Content-Length': String(totalSize) })
    if (req.method === 'HEAD') { res.end(); return }
    fs.createReadStream(filePath, { highWaterMark: STREAM_CHUNK_SIZE }).pipe(res)
  }

  /* ---------------- WebSocket：设备身份注册与消息推送 ---------------- */

  private handleUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer): void {
    if (!isUpgradeRequest(req) || (req.url ?? '').split('?')[0] !== '/ws') {
      socket.destroy()
      return
    }
    const trust = this.cb.deviceTrust
    const digest = trust && requestDeviceDigest(req)
    const isTrusted = (): boolean => !trust || Boolean(digest && trust.isTrusted(digest))
    if (trust && (!isSameOrigin(req) || !isTrusted())) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return
    }
    // 配对码 WS 校验已停用（骨架保留：恢复时校验 ?pin= 并 destroy 不匹配连接）
    acceptUpgrade(socket, req)
    const session = attachWebSocket(socket, {
      onText: (text) => {
        if (!isTrusted()) { socket.destroy(); return }
        try {
          const parsed = JSON.parse(text) as { type?: string; device_id?: string; device_name?: string }
          if (parsed.type === 'identity' && parsed.device_id) {
            const deviceId = parsed.device_id
            const deviceName = parsed.device_name?.trim() || 'Mobile'
            this.touch()
            this.onlineDevices.set(deviceId, { id: deviceId, name: deviceName, last_seen: Date.now() })
            const entry = this.wsClients.get(socket)
            if (entry) entry.deviceId = deviceId
            this.broadcast({ type: 'devices_update', devices: this.getOnlineDevices() })
            this.emitDevices()
          }
        } catch {}
      },
      onClose: () => {
        const entry = this.wsClients.get(socket)
        this.wsClients.delete(socket)
        if (entry?.deviceId && ![...this.wsClients.values()].some((client) => client.deviceId === entry.deviceId)) {
          this.onlineDevices.delete(entry.deviceId)
          this.broadcast({ type: 'devices_update', devices: this.getOnlineDevices() })
          this.emitDevices()
        }
      },
    })
    this.wsClients.set(socket, {
      send: (text) => { if (isTrusted()) session.sendText(text); else socket.destroy() },
      deviceId: null,
    })
    if (head.length > 0) socket.emit('data', head) // 归还 upgrade 请求携带的首包数据
  }
}
