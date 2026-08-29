/**
 * 最小 RFC6455 WebSocket 服务端实现（仅文本帧），供手机端消息推送。
 * 兼容浏览器必发的 Ping（回 Pong）与 Close 握手；无需第三方依赖。
 */
import { createHash, randomBytes } from 'node:crypto'
import type { Socket } from 'node:net'

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export function isUpgradeRequest(req: import('http').IncomingMessage): boolean {
  return (
    (req.headers.upgrade ?? '').toLowerCase() === 'websocket' &&
    !!req.headers['sec-websocket-key']
  )
}

export function acceptUpgrade(socket: Socket, req: import('http').IncomingMessage): void {
  const key = req.headers['sec-websocket-key'] as string
  const accept = createHash('sha1').update(key + WS_MAGIC).digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )
}

/** 服务端 → 客户端文本帧（服务端帧不掩码） */
export function encodeTextFrame(payload: string): Buffer {
  const data = Buffer.from(payload, 'utf8')
  const len = data.length
  let header: Buffer
  if (len < 126) {
    header = Buffer.from([0x81, len])
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([header, data])
}

function encodeControl(opcode: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  return Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload])
}

export interface WsSessionEvents {
  onText: (text: string) => void
  onClose: () => void
}

/** 挂接帧解析循环；返回发送器 */
export function attachWebSocket(socket: Socket, events: WsSessionEvents): { sendText: (t: string) => void } {
  let buffer = Buffer.alloc(0)
  let closed = false

  const cleanup = () => {
    if (closed) return
    closed = true
    events.onClose()
  }

  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    // 逐帧消费
    for (;;) {
      if (buffer.length < 2) return
      const fin = (buffer[0] & 0x80) !== 0
      const opcode = buffer[0] & 0x0f
      const masked = (buffer[1] & 0x80) !== 0
      let len = buffer[1] & 0x7f
      let offset = 2
      if (len === 126) {
        if (buffer.length < offset + 2) return
        len = buffer.readUInt16BE(offset)
        offset += 2
      } else if (len === 127) {
        if (buffer.length < offset + 8) return
        len = Number(buffer.readBigUInt64BE(offset))
        offset += 8
      }
      const maskKey = masked ? buffer.subarray(offset, offset + 4) : null
      if (masked) offset += 4
      if (buffer.length < offset + len) return

      let payload = Buffer.from(buffer.subarray(offset, offset + len))
      if (maskKey) {
        for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4]
      }
      buffer = buffer.subarray(offset + len)
      if (buffer.length === 0) buffer = Buffer.alloc(0)

      if (!fin) continue // 不处理分片延续帧（浏览器消息均在 64KB 读取上限内整帧到达）
      if (opcode === 0x8) {
        // Close：回 Close 帧后断开
        if (!closed) {
          try {
            socket.write(encodeControl(0x8))
          } catch {}
        }
        cleanup()
        socket.end()
        return
      }
      if (opcode === 0x9) {
        try {
          // Pong = FIN|0xA
          socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]))
        } catch {}
        continue
      }
      if (opcode === 0x1) {
        events.onText(payload.toString('utf8'))
      }
    }
  })
  socket.on('close', cleanup)
  socket.on('error', cleanup)

  return {
    sendText: (t: string) => {
      if (closed || socket.destroyed) return
      try {
        socket.write(encodeTextFrame(t))
      } catch {}
    },
  }
}

/** 仅供测试生成掩码客户端帧 */
export function encodeClientFrame(payload: string): Buffer {
  const data = Buffer.from(payload, 'utf8')
  const mask = randomBytes(4)
  const masked = Buffer.from(data)
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4]
  const header = Buffer.from([0x81, 0x80 | data.length])
  return Buffer.concat([header, mask, masked])
}
