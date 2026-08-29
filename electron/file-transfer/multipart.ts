/**
 * 极简 multipart/form-data 解析器（内存缓冲式）。
 * 手机端实际全部分块上传（每块 512KB），单次 /upload 仅作协议兜底，
 * 故缓冲上限 64MB，超出返回 null 由调用方回 413 提示改用分块。
 */

export interface MultipartPart {
  name: string
  filename?: string
  contentType?: string
  data: Buffer
}

const MAX_BODY_BYTES = 64 * 1024 * 1024

function parseContentDisposition(value: string): { name?: string; filename?: string } {
  const out: { name?: string; filename?: string } = {}
  const re = /([a-zA-Z]+)="((?:[^"\\]|\\.)*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(value)) !== null) {
    if (m[1] === 'name') out.name = m[2]
    if (m[1] === 'filename') out.filename = m[2]
  }
  return out
}

/** 读取完整请求体；超过上限抛 BODY_TOO_LARGE */
export function readRawBody(req: import('http').IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > maxBytes) {
        req.destroy()
        reject(new Error('BODY_TOO_LARGE'))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** 按名称取第一个匹配的 part */
export async function parseMultipart(req: import('http').IncomingMessage): Promise<MultipartPart[] | null> {
  const ctype = req.headers['content-type'] ?? ''
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype)
  if (!m) return null
  const boundary = '--' + (m[1] ?? m[2]).trim()

  let body: Buffer
  try {
    body = await readRawBody(req)
  } catch (err) {
    if (err instanceof Error && err.message === 'BODY_TOO_LARGE') return null
    throw err
  }

  const parts: MultipartPart[] = []
  let pos = body.indexOf(boundary)
  if (pos < 0) return null

  while (pos >= 0) {
    const lineEnd = pos + boundary.length
    // 终止边界 "--boundary--"
    if (body.slice(lineEnd, lineEnd + 2).toString('latin1') === '--') break
    // 跳过 boundary 行后的 CRLF
    const headStart = body.indexOf(Buffer.from('\r\n'), lineEnd)
    if (headStart < 0) break
    const headersEnd = body.indexOf(Buffer.from('\r\n\r\n'), headStart)
    if (headersEnd < 0) break

    const rawHeaders = body.slice(headStart + 2, headersEnd).toString('utf8')
    const dataStart = headersEnd + 4
    const next = body.indexOf(boundary, dataStart)
    if (next < 0) break
    // part 数据以 CRLF 结尾（boundary 前），去掉末尾 CRLF
    let dataEnd = next
    if (dataEnd >= 2 && body[dataEnd - 2] === 13 && body[dataEnd - 1] === 10) dataEnd -= 2

    let name: string | undefined
    let filename: string | undefined
    let contentType: string | undefined
    for (const line of rawHeaders.split('\r\n')) {
      const [key, ...rest] = line.split(':')
      const value = rest.join(':').trim()
      if (key.toLowerCase() === 'content-disposition') {
        const parsed = parseContentDisposition(value)
        name = parsed.name
        filename = parsed.filename
      } else if (key.toLowerCase() === 'content-type') {
        contentType = value
      }
    }

    if (name !== undefined) {
      parts.push({ name, filename, contentType, data: body.slice(dataStart, dataEnd) })
    }
    pos = next
  }

  return parts
}
