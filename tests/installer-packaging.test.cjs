// 打包完成后运行：node --test tests/installer-packaging.test.cjs。
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { version } = require('../package.json')

const builder = createRequire(require.resolve('electron-builder'))
const asar = createRequire(builder.resolve('app-builder-lib'))('@electron/asar')
const output = path.resolve(process.env.QPASTE_PACKAGE_TEST_DIR || 'release')
const archive = path.join(output, 'win-unpacked/resources/app.asar')

describe('完整安装包体积与资源', () => {
  it('Electron 45 安装包小于 130 MiB', () => {
    assert(fs.statSync(path.join(output, `Q-Paste.Setup.v${version}.exe`)).size < 130 * 1024 * 1024)
  })

  it('包含两种模式页面、数据库线程和 Windows 剪贴板模块', () => {
    const files = asar.listPackage(archive).map(file => file.replace(/\\/g, '/'))
    for (const file of ['dist/index.html', 'dist/floral/index.html', 'dist-electron/main.js', 'dist-electron/database-worker.cjs']) {
      assert(files.includes('/' + file), file)
    }
    assert(!files.some(file => file.includes('node_modules/sql.js/')))
    assert(files.some(file => file.includes('/@koromix/koffi-win32-x64/') && file.endsWith('.node')))
    assert(!files.some(file => /\/node_modules\/(?:zlibjs\/bin|koffi\/(?:doc|vendor)|(?:pinyin-pro|sortablejs)\/dist)\//.test(file)))
    assert(!files.some(file => /node_modules\/tesseract\.js-core\/.*\.wasm/.test(file)))
  })

  it('离线 OCR 只打包 LSTM 内核，保留 SIMD 与非 SIMD 兼容路径', () => {
    for (const file of ['worker.min.js', 'chi_sim.traineddata.gz', 'eng.traineddata.gz',
      'core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js']) {
      assert(fs.statSync(path.join(output, 'win-unpacked/resources/ocr', file)).size > 0, file)
    }
    const coreDir = path.join(output, 'win-unpacked/resources/ocr/core')
    assert.deepEqual(fs.readdirSync(coreDir).sort(), ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'])
  })

  it('花笺使用系统中文字体，保留离线公式字体', () => {
    const files = asar.listPackage(archive).map(file => file.replace(/\\/g, '/'))
    assert(!files.some(file => file.startsWith('/dist/floral/') && file.includes('HarmonyOS_Sans_SC')))
    assert(files.some(file => file.startsWith('/dist/floral/assets/KaTeX_Main-Regular-') && file.endsWith('.woff2')))
  })
})
