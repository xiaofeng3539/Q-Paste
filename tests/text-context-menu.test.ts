import { describe, expect, it } from 'vitest'
import { getTextContextCopyValue, appendRichTextPasteValue, appendTextContextPasteValue, insertTextAtSelection, supportsTextContextMenu } from '../src/lib/text-context-menu'

describe('文本右键菜单', () => {
  it('复制时优先使用用户选中的文本', () => {
    expect(getTextContextCopyValue('完整内容', '选中部分')).toBe('选中部分')
    expect(getTextContextCopyValue('完整内容', '')).toBe('完整内容')
  })

  it('粘贴时保留原内容并追加剪贴板文本', () => {
    expect(appendTextContextPasteValue('第一行', '第二行')).toBe('第一行\n第二行')
  })

  it('编辑状态粘贴会替换选中部分并返回新的光标位置', () => {
    expect(insertTextAtSelection('第一行\n第二行', '替换', 4, 7))
      .toEqual({ value: '第一行\n替换', cursor: 6 })
  })

  it('链接与富文本同样支持右键文本菜单', () => {
    expect(supportsTextContextMenu('text')).toBe(true)
    expect(supportsTextContextMenu('url')).toBe(true)
    expect(supportsTextContextMenu('html')).toBe(true)
    expect(supportsTextContextMenu('image')).toBe(false)
  })

  it('富文本粘贴会安全保留为文本', () => {
    expect(appendRichTextPasteValue('<p>原内容</p>', '<新内容>\n第二行'))
      .toBe('<p>原内容</p><br>&lt;新内容&gt;<br>第二行')
  })
})
