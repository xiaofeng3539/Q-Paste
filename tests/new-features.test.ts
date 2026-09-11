import { describe, it, expect } from 'vitest'
import { searchIndexOf, searchIncludes, highlightSegments, pinyinFull, pinyinAbbr } from '../src/lib/search'

describe('拼音搜索', () => {
  it('支持子串匹配（大小写不敏感）', () => {
    expect(searchIndexOf('Hello World', 'world')).toBe(6)
    expect(searchIncludes('剪贴板管理', '贴板')).toBe(true)
  })

  it('支持全拼音匹配', () => {
    expect(searchIncludes('剪贴板管理工具', 'jiantieban')).toBe(true)
    expect(pinyinFull('历史').startsWith('lishi')).toBe(true)
  })

  it('支持拼音首字母缩写匹配', () => {
    expect(searchIncludes('历史记录', 'lsjl')).toBe(true)
    expect(pinyinAbbr('阿里巴巴')).toBe('albb')
  })

  it('未命中返回 -1', () => {
    expect(searchIndexOf('abc', 'zzz')).toBe(-1)
    expect(searchIncludes('纯中文', 'english')).toBe(false)
  })
})

describe('搜索高亮', () => {
  it('输出命中的片段', () => {
    const segs = highlightSegments('hello world', 'lo w')
    expect(segs.some((s) => s.hit && s.text === 'lo w')).toBe(true)
    expect(segs.filter((s) => s.hit).length).toBe(1)
  })

  it('无命中时整体返回非高亮', () => {
    const segs = highlightSegments('abc', 'zzz')
    expect(segs).toEqual([{ text: 'abc', hit: false }])
  })
})