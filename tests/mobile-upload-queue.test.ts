import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, it, expect, vi } from 'vitest'

const page = readFileSync('electron/file-transfer/mobile-page.html', 'utf8')
function makeQueue(send: (task: any, progress: (percent: number) => void) => Promise<void>) {
  const start = page.indexOf('function createUploadQueue(')
  const end = page.indexOf('// 上传队列结束', start)
  expect(start).toBeGreaterThan(0)
  const factory = runInNewContext(page.slice(start, end) + '\ncreateUploadQueue', { setTimeout })
  return factory(send, () => {})
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
function makeSender(fetch: typeof globalThis.fetch) {
  const start = page.indexOf('        function matchesUpload(')
  expect(start).toBeGreaterThan(0)
  const matches = page.slice(start, page.indexOf('        function createMessageElement('))
  const uploads = page.slice(page.indexOf('        async function pollUploads('), page.indexOf('        // ── 获取电脑剪贴板'))
  return runInNewContext(matches + uploads + '\nuploadFile', {
    fetch, FormData, AbortSignal, crypto, deviceId: 'phone', deviceName: 'Mobile', lastId: 0, seenMessages: new Set(),
    extractNameFromContent: (content: string) => decodeURIComponent(content.split('?name=')[1]),
  })
}

describe('手机批量上传队列', () => {
  it('批次追加和同名文件保持顺序，不并发上传，成功后释放文件', async () => {
    const calls: string[] = []
    let release: () => void = () => {}
    const queue = makeQueue(async task => {
      calls.push(task.file.name)
      if (calls.length === 1) await new Promise<void>(resolve => { release = resolve })
    })
    queue.enqueue([{ name: 'a.jpg' }, { name: 'a.jpg' }])
    queue.enqueue([{ name: 'b.jpg' }])
    expect(calls).toEqual(['a.jpg'])
    expect(queue.tasks.map((t: any) => t.status)).toEqual(['sending', 'waiting', 'waiting'])
    release()
    await vi.waitFor(() => expect(calls).toEqual(['a.jpg', 'a.jpg', 'b.jpg']))
    expect(queue.tasks.every((t: any) => t.status === 'success' && t.file === null)).toBe(true)
  })

  it('失败不标成功、不越过失败项；重复重试点击只重发失败图片一次', async () => {
    const calls: string[] = []
    let fail = true
    const queue = makeQueue(async task => {
      calls.push(task.file.name)
      if (fail) throw new Error('连接中断')
    })
    const [first] = queue.enqueue([{ name: 'first.jpg' }, { name: 'second.jpg' }])
    await tick()
    expect(first.status).toBe('failed')
    expect(calls).toEqual(['first.jpg'])
    queue.enqueue([{ name: 'third.jpg' }])
    expect(calls).toEqual(['first.jpg'])
    fail = false
    queue.retry(first)
    queue.retry(first)
    await vi.waitFor(() => expect(calls).toEqual(['first.jpg', 'first.jpg', 'second.jpg', 'third.jpg']))
    expect(queue.tasks.every((t: any) => t.status === 'success')).toBe(true)
    queue.retry(first)
    expect(calls).toHaveLength(4)
  })

  it('单图发送及分块进度仍可用', async () => {
    const queue = makeQueue(async (_task, progress) => { progress(50); await tick(); progress(100) })
    const [task] = queue.enqueue([{ name: 'single.jpg' }])
    expect(task.progress).toBe(50)
    await tick()
    expect(task.status).toBe('success')
    expect(task.progress).toBe(100)
  })
})

describe('系统相册确认后直接发送', () => {
  it('完成响应丢失后用接收回执确认成功，不重复发送', async () => {
    const history: unknown[] = []
    let sends = 0
    const send = makeSender(async (url, options) => {
      if (String(url).startsWith('/poll')) return new Response(JSON.stringify(history))
      sends++
      const meta = JSON.parse((options!.body as FormData).get('metadata') as string)
      history.push({ id: 1, direction: 'in', sender_id: 'phone', msg_type: 'image', content: '/download/token?name=' + encodeURIComponent('20261010120000_1_' + meta.file_name) })
      throw new Error('完成响应丢失')
    })
    const task = { name: '1_照片.jpg', file: new File(['原图'], '1_照片.jpg', { type: 'image/jpeg' }) }
    await send(task, () => {})
    await send(task, () => {})
    expect(sends).toBe(1)
  })

  it('一次确认后全部按原顺序入队，单图兼容，取消选择不入队', () => {
    const start = page.indexOf('function enqueueSelectedFiles(')
    expect(start).toBeGreaterThan(0)
    const end = page.indexOf('fileInput.onchange =', start)
    const batches: unknown[][] = []
    const send = runInNewContext(page.slice(start, end) + '\nenqueueSelectedFiles', {
      uploadQueue: { enqueue: (files: unknown[]) => batches.push(files) },
    })
    const first = { name: 'same.jpg' }
    const second = { name: 'same.jpg' }
    const input = { files: [first, second], value: '相册选择' }
    send(input)
    expect(batches).toEqual([[first, second]])
    expect(input.value).toBe('')
    send({ files: [second], value: '单图' })
    send({ files: [], value: '' })
    expect(batches).toEqual([[first, second], [second]])
  })

  it('直接使用系统多选入口，不保留网页暂存操作', () => {
    expect(page).toMatch(/<label[^>]*for="image-input"[^>]*>相册<\/label>/)
    expect(page).toMatch(/<input[^>]*id="image-input"[^>]*accept="image\/\*"[^>]*multiple/)
    for (const old of ['selectedFiles', 'selection-panel', 'clear-selection', 'send-selection', 'selection-list']) {
      expect(page).not.toContain(old)
    }
  })

  it('加号菜单保留三个独立系统选择器，相册不拍照、文件不限制图片类型', () => {
    expect(/<button[^>]*id="upload-toggle"[^>]*>\+<\/button>/.test(page)).toBe(true)
    for (const [id, label] of [['image-input', '相册'], ['camera-input', '相机'], ['file-input', '文件']]) {
      expect(new RegExp(`<label[^>]*for="${id}"[^>]*>${label}</label>`).test(page)).toBe(true)
    }
    const input = (id: string) => page.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] || ''
    expect(input('image-input')).toContain('multiple')
    expect(input('image-input')).not.toContain('capture')
    expect(input('camera-input')).toContain('capture="environment"')
    expect(input('camera-input')).not.toContain('multiple')
    expect(input('file-input')).toContain('multiple')
    expect(input('file-input')).not.toContain('accept=')
  })
})
