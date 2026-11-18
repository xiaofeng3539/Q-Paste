import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const page = readFileSync('electron/file-transfer/mobile-page.html', 'utf8')

function fixture(statuses: string[]) {
  const children: any[] = []
  function element() {
    const el = { remove: () => children.splice(children.indexOf(el), 1) }
    children.push(el)
    return el
  }
  element() // SYSTEM READY / 普通历史消息
  const tasks = statuses.map((status) => ({ status, element: element() }))
  const menu = { hidden: false }, progress = { hidden: false }
  const renderUpload = vi.fn()
  const start = page.indexOf('        function clearMobileChatHistory(')
  expect(start).toBeGreaterThan(0)
  const end = page.indexOf('        function installChatHistoryMenu(', start)
  const clear = runInNewContext(page.slice(start, end) + '\nclearMobileChatHistory', {
    chatBox: { children }, uploadQueue: { tasks }, renderUpload,
    document: { getElementById: (id: string) => id === 'batch-progress' ? progress : menu },
  })
  return { clear, children, tasks, progress, menu, renderUpload }
}

describe('手机端独立清除聊天记录', () => {
  it('移除历史气泡和已完成任务，不需要清除电脑记录或下载文件', () => {
    const h = fixture(['success', 'success'])
    h.clear()
    expect(h.children).toHaveLength(0)
    expect(h.tasks).toHaveLength(0)
    expect(h.progress.hidden).toBe(true)
    expect(h.menu.hidden).toBe(true)
    h.clear()
    expect(h.children).toHaveLength(0)
  })
  it('保留发送中、待发送和可重试任务，不打断传输', () => {
    const h = fixture(['success', 'sending', 'waiting', 'failed'])
    h.clear()
    expect(h.children).toHaveLength(3)
    expect(h.tasks.map((task) => task.status)).toEqual(['sending', 'waiting', 'failed'])
    expect(h.progress.hidden).toBe(false)
    expect(h.renderUpload).toHaveBeenCalledWith(h.tasks[0])
  })
})
