// 打包完成后运行：node --test tests/installer-packaging.test.cjs。
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const builder = createRequire(require.resolve('electron-builder'))
const asar = createRequire(builder.resolve('app-builder-lib'))('@electron/asar')
const output = path.resolve(process.env.QPASTE_PACKAGE_TEST_DIR || 'release/size-optimized')
const archive = path.join(output, 'win-unpacked/resources/app.asar')

describe('完整安装包体积与资源', () => {
  it('安装包小于100 MiB', () => {
    assert(fs.statSync(path.join(output, 'Q-Paste.Setup.v1.4.0.exe')).size < 100 * 1024 * 1024)
  })

  it('包含两种模式页面与实际使用的 SQL 引导代码，不包含重复或调试内核', () => {
    const files = asar.listPackage(archive).map(file => file.replace(/\\/g, '/'))
    for (const file of ['dist/index.html', 'dist/floral/index.html', 'dist-electron/main.js', 'node_modules/sql.js/dist/sql-wasm.js']) {
      assert(files.includes('/' + file), file)
    }
    assert(!files.some(file => file.includes('node_modules/sql.js/dist/sql-asm')))
    assert(!files.some(file => /node_modules\/tesseract\.js-core\/.*\.wasm/.test(file)))
  })

  it('保留离线 OCR 全部兼容内核和中英文模型', () => {
    for (const file of ['worker.min.js', 'chi_sim.traineddata.gz', 'eng.traineddata.gz',
      'core/tesseract-core.wasm.js', 'core/tesseract-core-simd.wasm.js',
      'core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js']) {
      assert(fs.statSync(path.join(output, 'win-unpacked/resources/ocr', file)).size > 0, file)
    }
    assert(!fs.existsSync(path.join(output, 'win-unpacked/resources/ocr/core/tesseract-core.wasm')))
  })
})
