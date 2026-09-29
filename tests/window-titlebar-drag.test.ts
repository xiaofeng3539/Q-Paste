import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import TitleBar from '../src/components/TitleBar'
import { MainWindow } from '../vendor/floral-notepaper/src/components/MainWindow'

describe('Windows 标题栏拖动', () => {
  test('Q-Paste 标题栏保留指针事件以驱动平滑移动', () => {
    const markup = renderToStaticMarkup(createElement(TitleBar))
    const titleBarClass = markup.match(/^<div class="([^"]+)"/)?.[1] ?? ''

    expect(titleBarClass.split(' ')).toContain('no-drag')
    expect(titleBarClass.split(' ')).not.toContain('drag-region')
  })

  test('花笺标题栏保留指针事件以驱动平滑移动', () => {
    const markup = renderToStaticMarkup(createElement(MainWindow))

    expect(markup).toContain('cursor-default electron-no-drag')
  })
})
