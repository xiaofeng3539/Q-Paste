import { describe, expect, it } from 'vitest'
import { historySummary, loadHistorySummaries, readHistoryContent } from '../src/lib/history-memory'
import type { ClipboardItem } from '../src/types'

const item = { id: 1, type: 'text', content: '正文'.repeat(10000), preview: '正文', tags: [], is_pinned: true } as ClipboardItem

describe('历史正文按需读取', () => {
  it('摘要不保留正文，保留收藏和标签等元数据', () => {
    const summary = historySummary(item)
    expect(summary.content).toBe('')
    expect(summary.content_loaded).toBe(false)
    expect(summary.is_pinned).toBe(true)
    expect(item.content.length).toBe(20000)
  })

  it('每批最多读取100条，保持原有500条窗口及排序', async () => {
    const calls: number[] = []
    const rows = await loadHistorySummaries(async ({ limit, ids, summaryOnly }) => {
      expect(summaryOnly).toBe(true)
      expect(limit).toBe(100)
      calls.push(ids![0])
      return ids!.map((id) => ({ ...item, id, content: '' })).reverse()
    }, async () => Array.from({ length: 500 }, (_, i) => i))
    expect(calls).toEqual([0, 100, 200, 300, 400])
    expect(rows.length).toBe(500)
    expect(rows[499].id).toBe(499)
  })

  it('最后一页不足100条时停止，不额外读取全文', async () => {
    let calls = 0
    const rows = await loadHistorySummaries(async () => { calls++; return [item] }, async () => [1])
    expect(calls).toBe(1)
    expect(rows[0].content).toBe('')
  })

  it('分页期间新增置顶项不会重复或漏掉快照记录', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => i)
    let captures = 0
    const rows = await loadHistorySummaries(async (request) => {
      captures++
      return request.ids!.map((id) => ({ ...item, id, content: '' }))
    }, async () => ids)
    expect(captures).toBe(3)
    expect(rows.map((row) => row.id)).toEqual(ids)
    expect(new Set(rows.map((row) => row.id)).size).toBe(201)
  })

  it('删除的记录不复活，不提前终止后续页', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => i)
    const rows = await loadHistorySummaries(async (request) => request.ids!
      .filter((id) => id !== 50).map((id) => ({ ...item, id })), async () => ids)
    expect(rows.length).toBe(100)
    expect(rows.at(-1)?.id).toBe(100)
  })

  it.each(['text', 'html', 'files', 'url', 'image'] as const)('复制%s摘要时获取完整正文', async (type) => {
    const summary = historySummary({ ...item, type })
    expect(await readHistoryContent(summary, async (id) => { expect(id).toBe(1); return item.content })).toBe(item.content)
  })

  it('已加载的空正文不会误读数据库', async () => {
    expect(await readHistoryContent({ ...item, content: '' }, async () => { throw Error('不应读取') })).toBe('')
  })
})
