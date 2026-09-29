import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import TitleBar from '../src/components/TitleBar'
import { MainWindow } from '../vendor/floral-notepaper/src/components/MainWindow'

describe('Windows 标题栏拖动', () => {
  test('通过 Electron 原生拖动区移动窗口', () => {
    const markup = renderToStaticMarkup(createElement(TitleBar))
    const titleBarClass = markup.match(/^<div class="([^"]+)"/)?.[1] ?? ''

    expect(titleBarClass.split(' ')).toContain('drag-region')
    expect(titleBarClass.split(' ')).not.toContain('no-drag')
  })

  test('花笺主窗口标题栏也使用 Electron 原生拖动区', () => {
    const markup = renderToStaticMarkup(createElement(MainWindow))

    expect(markup).toContain('electron-drag-region')
  })
})
