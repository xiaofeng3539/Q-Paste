import { describe, it, expect } from 'vitest'
import { searchIndexOf, searchIncludes, highlightSegments, pinyinFull, pinyinAbbr } from '../src/lib/search'
import { applyTextTool } from '../src/components/DetailView'

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

describe('文本工具', () => {
  it('大小写转换', () => {
    expect(applyTextTool('upper', 'abc')).toBe('ABC')
    expect(applyTextTool('lower', 'ABC')).toBe('abc')
    expect(applyTextTool('title', 'hello world')).toBe('Hello World')
  })

  it('JSON 格式化', () => {
    expect(applyTextTool('json', '{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(applyTextTool('json', 'not json')).toBe('内容不是有效的 JSON')
  })

  it('Base64 编解码（含中文）', () => {
    const encoded = applyTextTool('base64encode', '你好')
    expect(encoded).toBe('5L2g5aW9')
    expect(applyTextTool('base64decode', encoded)).toBe('你好')
  })

  it('URL 编解码', () => {
    expect(applyTextTool('urlencode', 'a b')).toBe('a%20b')
    expect(applyTextTool('urldecode', 'a%20b')).toBe('a b')
  })

  it('提取链接与反转', () => {
    expect(applyTextTool('extractUrls', 'see https://a.com and https://b.com/xx')).toBe('https://a.com\nhttps://b.com/xx')
    expect(applyTextTool('reverse', 'abc')).toBe('cba')
  })
})