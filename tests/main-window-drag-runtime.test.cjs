const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

if (!process.versions.electron) {
  require('node:test').test('Windows recognizes the native caption in both main-window modes', {
    skip: process.platform !== 'win32', timeout: 35000,
  }, () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'qpaste-window-drag-'))
    const env = { ...process.env, QPASTE_DRAG_TEST_OUTPUT: output }
    delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(require('electron'), [__filename], {
      env, encoding: 'utf8', windowsHide: true, timeout: 30000,
    })
    assert.equal(result.status, 0, result.error || result.stderr || result.stdout)
  })
} else {
  const { app, BrowserWindow, screen } = require('electron')
  const output = process.env.QPASTE_DRAG_TEST_OUTPUT
  const root = process.env.QPASTE_SMOKE_APP_ROOT || path.resolve(__dirname, '..')
  app.setPath('userData', path.join(output, 'profile'))
  app.getAppPath = () => root
  const getPath = app.getPath.bind(app)
  app.getPath = (key) => key === 'documents' ? output : getPath(key)
  app.setLoginItemSettings = () => {}
  require(path.join(root, 'dist-electron/main.js'))
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  async function until(predicate) {
    for (let i = 0; i < 100; i++) {
      const result = await predicate()
      if (result) return result
      await sleep(40)
    }
    throw new Error('Timed out waiting for the main window')
  }
  app.whenReady().then(async () => {
    try {
      const win = await until(() => BrowserWindow.getAllWindows()[0])
      await until(() => !win.webContents.isLoading())
      win.show()
      const user32 = require('koffi').load('user32.dll')
      const send = user32.func('intptr_t __stdcall SendMessageW(uintptr_t window, uint32_t message, uintptr_t wparam, intptr_t lparam)')
      const handle = win.getNativeWindowHandle().readBigUInt64LE()
      const hitParameters = (point) => {
        const bounds = win.getContentBounds()
        const absolute = screen.dipToScreenPoint({ x: bounds.x + point.x, y: bounds.y + point.y })
        return (absolute.x & 0xffff) | ((absolute.y & 0xffff) << 16)
      }
      const verifyTitleBar = async (mode, buttonTitle) => {
        const hitTest = (point) => Number(send(handle, 0x84, 0, hitParameters(point)))
        await until(() => hitTest({x: 290, y: 18}) === 2)
        const button = await win.webContents.executeJavaScript(`(() => {
          const rect = document.querySelector('button[title=' + JSON.stringify(${JSON.stringify(buttonTitle)}) + ']').getBoundingClientRect()
          return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)}
        })()`)
        assert.equal(hitTest(button), 1, mode + ' mode switch must remain clickable')
        const writes = []
        const setBounds = win.setBounds
        win.setBounds = function (value) { writes.push(value); return setBounds.call(this, value) }
        try {
          send(handle, 0x00a3, 2, hitParameters({x: 290, y: 18}))
          await until(() => writes.length === 1)
        } finally {
          win.setBounds = setBounds
        }
      }
      await verifyTitleBar('Q-Paste', '切换到花笺')
      void win.webContents.executeJavaScript("void window.electronAPI.switchAppMode('floral')").catch(() => {})
      await until(() => win.webContents.getURL().includes('/dist/floral/index.html') && !win.webContents.isLoading())
      await verifyTitleBar('Floral', '切换到 Q-Paste')
      app.quit()
    } catch (error) { console.error(error); app.exit(1) }
  })
}
