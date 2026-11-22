// Build first, then run with the bundled Electron runtime and an isolated profile.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

if (!process.versions.electron) {
  require('node:test').test('Electron 45 迁移旧库并通过 Windows 消息捕获剪贴板', {
    skip: process.platform !== 'win32', timeout: 45000,
  }, async () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'qpaste-native-core-'))
    const profile = path.join(output, 'profile')
    const root = path.join(output, 'data')
    fs.mkdirSync(profile, { recursive: true })
    fs.mkdirSync(path.join(root, 'database'), { recursive: true })
    fs.writeFileSync(path.join(profile, 'q-paste-storage-root.json'), JSON.stringify({ rootPath: root }))
    const SQL = await require('sql.js')()
    const old = new SQL.Database()
    old.run(`CREATE TABLE items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
      preview TEXT NOT NULL DEFAULT '', char_count INTEGER NOT NULL DEFAULT 0,
      storage_size INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    )`)
    old.run("INSERT INTO items VALUES (7, 'text', '旧库内容', '旧库内容', 4, 12, '2026-11-01 12:00:00')")
    fs.writeFileSync(path.join(root, 'database', 'q-paste.db'), old.export())
    old.close()
    const env = { ...process.env, QPASTE_NATIVE_OUTPUT: output }
    delete env.ELECTRON_RUN_AS_NODE
    const run = require('node:child_process').spawnSync(require('electron'), [__filename], {
      env, encoding: 'utf8', windowsHide: true, timeout: 40000,
    })
    assert.equal(run.status, 0, `${run.error || ''}\n${run.stdout}\n${run.stderr}`)
    assert.ok(fs.existsSync(path.join(output, 'verified')))
  })
} else {
  const { app, BrowserWindow, clipboard, ClipboardItem, dialog, nativeImage } = require('electron')
  const { DatabaseSync } = require('node:sqlite')
  const { pathToFileURL } = require('node:url')
  const output = process.env.QPASTE_NATIVE_OUTPUT
  const workspace = path.resolve(__dirname, '..')
  const root = process.env.QPASTE_SMOKE_APP_ROOT || workspace
  const snapshot = path.join(output, 'snapshot.db')
  app.setPath('userData', path.join(output, 'profile'))
  app.getAppPath = () => root
  app.setLoginItemSettings = () => {}
  const getPath = app.getPath.bind(app)
  app.getPath = (key) => key === 'documents' ? output : getPath(key)
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: snapshot })

  // Deliver real window messages with a fake clipboard payload so the user's clipboard stays private and intact.
  let reads = 0
  let entries = [new ClipboardItem({ 'text/plain': '启动前的剪贴板' })]
  clipboard.read = async () => { reads++; return entries }
  clipboard.write = async (next) => { entries = next }
  require(path.join(root, 'dist-electron/main.js'))
  const user32 = require('koffi').load('user32.dll')
  const post = user32.func('int __stdcall PostMessageW(uintptr_t window, uint32_t message, uintptr_t wparam, intptr_t lparam)')
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  async function until(read, description, attempts = 150) {
    for (let i = 0; i < attempts; i++) {
      const value = await read()
      if (value) return value
      await sleep(40)
    }
    throw new Error('Timeout: ' + description)
  }
  app.whenReady().then(async () => {
    try {
      assert.match(process.versions.electron, /^45\./)
      const win = await until(() => BrowserWindow.getAllWindows()[0], 'main window')
      const js = (code) => win.webContents.executeJavaScript(`(async()=> (${code}))()`)
      await until(() => js('Boolean(window.electronAPI)'), 'preload')
      await until(() => reads > 0, 'clipboard seed')
      assert.equal(await js('window.electronAPI.getItemContent(7)'), '旧库内容')
      assert.ok(fs.existsSync(path.join(output, 'data', 'database', 'backups', 'q-paste.pre-native.db')))
      const before = reads
      await sleep(1700)
      assert.equal(reads, before, 'Windows should wait for notifications')
      const handle = win.getNativeWindowHandle().readBigUInt64LE()
      const capture = async (types, expected) => {
        entries = [new ClipboardItem(types)]
        assert.ok(post(handle, 0x031d, 0, 0))
        return until(async () => (await js('window.electronAPI.getItems({limit:20,offset:0})')).find(expected), 'capture')
      }
      await capture({ 'text/plain': '本次复制的文本' }, (item) => item.content === '本次复制的文本')
      await capture({ 'text/plain': '富文本内容', 'text/html': '<b>富文本内容</b>' }, (item) => item.type === 'html')
      const file = path.join(output, '中文 文件.txt')
      fs.writeFileSync(file, '')
      const fileEntry = await capture({ 'text/uri-list': pathToFileURL(file).href }, (item) => item.type === 'files')
      assert.deepEqual(JSON.parse(fileEntry.content), [file])
      const png = nativeImage.createFromPath(path.join(workspace, 'build', 'icon.png')).toPNG()
      const image = await capture({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) }, (item) => item.type === 'image')
      assert.equal(await js(`window.electronAPI.getItemContent(${image.id})`), 'data:image/png;base64,' + png.toString('base64'))
      const live = new DatabaseSync(path.join(output, 'data', 'database', 'q-paste.db'))
      try {
        live.exec('BEGIN IMMEDIATE')
        for (const text of ['忙时复制一', '忙时复制二', '忙时复制三']) {
          const previousReads = reads
          entries = [new ClipboardItem({ 'text/plain': text })]
          assert.ok(post(handle, 0x031d, 0, 0))
          await until(() => reads > previousReads, 'a blocked history writer must not delay clipboard reads', 10)
          await sleep(25)
        }
        live.exec('COMMIT')
      } finally { live.close() }
      await until(async () => {
        const records = await js('window.electronAPI.getItems({limit:20,offset:0})')
        return records.filter((item) => item.content.startsWith('忙时复制')).length === 3
      }, 'all three snapshots persist')
      const longText = { type: 'text', content: 'x'.repeat(70_000), preview: '大文本', charCount: 70_000, storageSize: 70_000, createdAt: '2026-11-21 12:00:00' }
      const longItem = await js(`window.electronAPI.insertItem(${JSON.stringify(longText)})`)
      assert.ok(longItem.id)
      assert.equal(await js(`window.electronAPI.writeFiles([${JSON.stringify(file)}])`), true)
      assert.equal(await (await entries[0].getType('text/uri-list')).text(), pathToFileURL(file).href)
      assert.equal((await js('window.electronAPI.exportDb()')).success, true)
      const db = new DatabaseSync(snapshot, { readOnly: true })
      try {
        assert.equal(db.prepare('SELECT COUNT(*) AS total FROM items').get().total, 9)
        const { content } = db.prepare('SELECT content FROM items WHERE id = ?').get(longItem.id)
        assert.equal(fs.readFileSync(path.join(snapshot + '.texts', path.basename(content)), 'utf8'), longText.content)
      } finally { db.close() }
      fs.writeFileSync(path.join(output, 'verified'), 'ok')
      app.quit()
    } catch (error) { console.error(error); app.exit(1) }
  })
}
