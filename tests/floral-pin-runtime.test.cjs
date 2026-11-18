// Build first, then: node --test tests/floral-pin-runtime.test.cjs
// Optional QPASTE_SMOKE_APP_ROOT points at a packaged resources/app.asar.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')

if (!process.versions.electron) {
  const { test } = require('node:test')
  test('固定磁贴保留正文并按内容自适应尺寸', { timeout: 60000 }, () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'qpaste-pin-regression-'))
    const env = { ...process.env, QPASTE_SMOKE_OUTPUT: output }
    delete env.ELECTRON_RUN_AS_NODE
    const run = require('node:child_process').spawnSync(require('electron'), [__filename], {
      env, encoding: 'utf8', windowsHide: true, timeout: 55000,
    })
    assert.equal(run.status, 0, `${run.error || ''}\n${run.stdout}\n${run.stderr}`)
    assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'result.json'))).passed, true)
    console.log(`Runtime evidence: ${output}`)
  })
} else {
  const { app, BrowserWindow, ipcMain } = require('electron')
  const workspace = path.resolve(__dirname, '..')
  const root = process.env.QPASTE_SMOKE_APP_ROOT || workspace
  const output = process.env.QPASTE_SMOKE_OUTPUT
  app.setPath('userData', path.join(output, 'profile'))
  app.getAppPath = () => root
  const getPath = app.getPath.bind(app)
  app.getPath = (key) => key === 'documents' ? output : getPath(key)
  // Never alter the real user's autostart registration during an integration test.
  app.setLoginItemSettings = () => {}
  const Module = require('node:module'), load = Module._load
  Module._load = function (id) {
    const result = load.apply(this, arguments)
    return id === 'sql.js'
      ? (options) => result({ ...options, locateFile: (file) => path.join(workspace, 'node_modules/sql.js/dist', file) })
      : result
  }
  const handlers = new Map(), handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (name, fn) => { handlers.set(name, fn); handle(name, fn) }
  require(path.join(root, 'dist-electron/main.js'))
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  async function until(read) {
    for (let i = 0; i < 150; i++) {
      const value = await read()
      if (value) return value
      await sleep(100)
    }
    throw new Error('Timed out waiting for the window')
  }
  app.whenReady().then(async () => {
    try {
      const main = await until(() => BrowserWindow.getAllWindows()[0])
      await until(() => !main.webContents.isLoading())
      const invoke = (command, args = {}) => handlers.get('floral:invoke')({ sender: main.webContents }, command, args)
      await invoke('config_save', { config: { theme: 'dark', tileColorMode: 'custom', tileColor: '#421bac' } })
      await invoke('open_notepad_window') // Same host entry point as Alt+N.
      const pad = await until(() => BrowserWindow.getAllWindows().find((w) => w !== main))
      const js = (code) => pad.webContents.executeJavaScript(`(async () => (${code}))()`)
      await until(() => !pad.webContents.isLoading())
      await until(() => js("Boolean(document.querySelector('textarea'))"))
      await sleep(500)
      await js(`(() => {
        const input = document.querySelector('textarea');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '固定后必须可见：测试正文');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`)
      await sleep(100)
      // Focusing an already-visible draft must not reset its unsaved text.
      await invoke('open_notepad_window')
      await sleep(100)
      assert.equal(await js("document.querySelector('textarea').value"), '固定后必须可见：测试正文')
      await js(`document.querySelector('button[title="转为磁贴"]').click()`)
      await until(() => js(`Boolean(document.querySelector('[data-surface-mode="tile"]'))`))
      await invoke('open_notepad_window')
      const next = await until(() => BrowserWindow.getAllWindows().find((w) => w !== main && w !== pad))
      await until(() => !next.webContents.isLoading())
      await until(() => next.webContents.executeJavaScript("Boolean(document.querySelector('textarea'))"))
      assert.equal(await next.webContents.executeJavaScript("document.querySelector('textarea').value"), '')
      assert.equal(await js(`document.querySelector('[data-surface-mode="tile"]').innerText`), '固定后必须可见：测试正文')
      assert.equal(await js(`getComputedStyle(document.querySelector('[data-surface-mode="tile"] .font-body')).color`), 'rgb(255, 255, 255)')
      fs.writeFileSync(path.join(output, 'pinned.png'), (await pad.webContents.capturePage()).toPNG())
      const dimensions = []
      async function checkTile(name, content) {
        const note = await invoke('notes_create', { request: { title: name, content, category: '' } })
        const known = new Set(BrowserWindow.getAllWindows())
        await invoke('open_tile_window', { noteId: note.id }) // Main-window pin button entry point.
        const tile = await until(() => BrowserWindow.getAllWindows().find((w) => !known.has(w)))
        await until(() => !tile.webContents.isLoading())
        await until(() => tile.webContents.executeJavaScript(`document.querySelector('[data-tile-body] .font-display')?.textContent === ${JSON.stringify(name)}`))
        await sleep(800)
        const bounds = tile.getBounds()
        const layout = await tile.webContents.executeJavaScript(`(() => {
          const el = document.querySelector('[data-tile-scroll]');
          return { width:el.clientWidth, scrollWidth:el.scrollWidth, height:el.clientHeight, scrollHeight:el.scrollHeight };
        })()`)
        assert.ok(layout.scrollWidth <= layout.width + 1, 'Long links must wrap, not clip horizontally')
        fs.writeFileSync(path.join(output, `${name}.png`), (await tile.webContents.capturePage()).toPNG())
        dimensions.push({ name, bounds, layout })
        return { tile, bounds, layout }
      }
      const short = await checkTile('short', '待办：买牛奶')
      assert.ok(short.bounds.height <= 150, 'Short notes should no longer use the fixed square size')
      const links = await checkTile('links', '下载链接：小飞机\nhttps://share.example.com/s/very-long-download-link-1234567890\n\n视频教程：\nhttps://www.example.com/video/long-id-1234567890\n\n使用教程：按步骤操作即可。')
      assert.ok(links.bounds.width > short.bounds.width, 'Long links should get more width')
      assert.ok(links.bounds.height > short.bounds.height, 'More text should get more height')
      assert.ok(links.layout.scrollHeight <= links.layout.height + 2, 'Moderate text should be fully visible')
      const dragStart = links.tile.getBounds()
      await invoke('config_save', { config: { tileDoubleClickToEdit: true } })
      await sleep(100)
      assert.equal(await links.tile.webContents.executeJavaScript(`getComputedStyle(document.querySelector('[data-surface-mode="tile"]')).webkitAppRegion`), 'drag', 'Double-click editing must not disable native dragging')
      let dragBoundsWrites = 0
      const setBounds = links.tile.setBounds.bind(links.tile)
      links.tile.setBounds = (...args) => { dragBoundsWrites++; return setBounds(...args) }
      await links.tile.webContents.executeJavaScript(`(() => {
        const tile=document.querySelector('[data-surface-mode="tile"]');
        tile.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,buttons:1,screenX:100,screenY:100}));
        for(let i=0;i<80;i++) window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,screenX:110+i,screenY:110+i}));
        window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,buttons:0}));
      })()`)
      await sleep(200)
      assert.equal(dragBoundsWrites, 0, 'Dragging must not rewrite window dimensions or trigger reflow')
      if (process.platform === 'win32') {
        let resizeEvents = 0
        const countResize = () => resizeEvents++
        links.tile.on('resize', countResize)
        await new Promise((resolve, reject) => require('node:child_process').execFile('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'floral-native-drag.ps1'),
          '-WindowHandle', links.tile.getNativeWindowHandle().readBigUInt64LE().toString(),
        ], { windowsHide: true }, (error, stdout, stderr) => error ? reject(new Error(`${error}\n${stdout}\n${stderr}`)) : resolve()))
        links.tile.removeListener('resize', countResize)
        assert.equal(resizeEvents, 0, 'Actual Windows dragging must not resize/reflow the document')
        assert.equal(dragBoundsWrites, 0)
        const moved = links.tile.getBounds()
        assert.ok(moved.x !== dragStart.x || moved.y !== dragStart.y, 'Native input must really move the window')
        assert.ok(Math.abs(moved.width - dragStart.width) <= 1)
        assert.ok(Math.abs(moved.height - dragStart.height) <= 1)
        const layoutAfterDrag = await links.tile.webContents.executeJavaScript(`(() => {
          const el=document.querySelector('[data-tile-scroll]'); return {width:el.clientWidth,height:el.clientHeight};
        })()`)
        assert.equal(layoutAfterDrag.width, links.layout.width)
        assert.equal(layoutAfterDrag.height, links.layout.height)
      }
      links.tile.setBounds = setBounds
      const dragEnd = links.tile.getBounds()
      assert.ok(Math.abs(dragEnd.width - dragStart.width) <= 1, 'Repeated dragging must never accumulate width error')
      assert.ok(Math.abs(dragEnd.height - dragStart.height) <= 1, 'Repeated dragging must never accumulate height error')
      const longUrl = await checkTile('long-url', 'https://example.com/' + 'unbroken-link-segment'.repeat(25))
      assert.ok(longUrl.layout.scrollHeight <= longUrl.layout.height + 2, 'Long unbroken URL must wrap to fit')
      await invoke('config_save', { config: { tileRenderMarkdown: true } })
      const markdown = await checkTile('markdown', '# 标题\n\n**正文加粗**\n\n- 第一项\n- 第二项\n\n[长链接](https://example.com/long)')
      assert.ok(markdown.layout.scrollHeight <= markdown.layout.height + 2)
      await invoke('config_save', { config: { tileRenderMarkdown: false } })
      const huge = await checkTile('huge', '多段正文测试，保留全部内容。\n'.repeat(120))
      const area = require('electron').screen.getDisplayMatching(huge.bounds).workArea
      assert.ok(huge.bounds.height <= area.height - 32)
      assert.ok(huge.layout.scrollHeight > huge.layout.height, 'Oversized notes must remain scrollable')
      assert.ok(huge.bounds.y >= area.y && huge.bounds.y + huge.bounds.height <= area.y + area.height)
      await invoke('config_save', { config: { tileDoubleClickToEdit: true } })
      huge.tile.show(); huge.tile.focus()
      await sleep(150)
      const beforeEdit = huge.tile.getBounds()
      if (process.platform === 'win32') {
        await new Promise((resolve, reject) => require('node:child_process').execFile('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'floral-native-drag.ps1'),
          '-WindowHandle', huge.tile.getNativeWindowHandle().readBigUInt64LE().toString(), '-DoubleClick',
        ], { windowsHide: true }, (error) => error ? reject(error) : resolve()))
      } else huge.tile.webContents.send('floral:event:surface-native-double-click', null)
      await until(() => huge.tile.webContents.executeJavaScript(`Boolean(document.querySelector('textarea'))`))
      const afterEdit = huge.tile.getBounds()
      assert.ok(afterEdit.width >= beforeEdit.width && afterEdit.height >= beforeEdit.height, 'Double-click editing must not shrink an already-fitted tile')
      await sleep(1000)
      assert.equal(huge.tile.getBounds().width, afterEdit.width, 'Pending auto-fit must not resize the editor')
      assert.equal(huge.tile.getBounds().height, afterEdit.height)
      fs.writeFileSync(path.join(output, 'editing.png'), (await huge.tile.webContents.capturePage()).toPNG())
      // A manual resize must not immediately be undone by automatic fitting.
      short.tile.setSize(360, 260)
      await sleep(500)
      assert.equal(short.tile.getBounds().width, 360)
      assert.equal(short.tile.getBounds().height, 260)
      await short.tile.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('floral-notepaper:surface-mode', { detail: { mode: 'pad' } }))`)
      await until(() => short.tile.webContents.executeJavaScript(`Boolean(document.querySelector('textarea'))`))
      assert.ok(short.tile.getBounds().width >= 360 && short.tile.getBounds().height >= 440, 'Editing a compact tile must restore usable editor bounds')
      fs.writeFileSync(path.join(output, 'dimensions.json'), JSON.stringify(dimensions, null, 2))
      fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, appRoot: root }))
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  })
}
