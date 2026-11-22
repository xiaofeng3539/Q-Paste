import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import TitleBar from '../src/components/TitleBar'
import { MainWindow } from '../vendor/floral-notepaper/src/components/MainWindow'

describe('Windows 标题栏拖动', () => {
  test('Q-Paste 标题栏由系统拖动，按钮仍然可点击', () => {
    const markup = renderToStaticMarkup(createElement(TitleBar))
    const titleBarClass = markup.match(/^<div class="([^"]+)"/)?.[1] ?? ''

    expect(titleBarClass.split(' ')).toContain('drag-region')
    expect(markup).toMatch(/<button[^>]+class="no-drag/)
  })

  test('花笺标题栏由系统拖动，按钮仍然可点击', () => {
    const markup = renderToStaticMarkup(createElement(MainWindow))

    expect(markup).toContain('cursor-default electron-drag-region')
    expect(markup).toMatch(/<button[^>]+class="electron-no-drag/)
  })
})
