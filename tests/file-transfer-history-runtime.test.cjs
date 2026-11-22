// Build first: node --test tests/file-transfer-history-runtime.test.cjs
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')

if (!process.versions.electron) {
  require('node:test').test('双端独立清除聊天记录，手机快捷方式打开电脑传输页', { timeout: 60000 }, () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'qpaste-chat-history-'))
    const env = { ...process.env, QPASTE_HISTORY_OUTPUT: output }
    delete env.ELECTRON_RUN_AS_NODE
    const run = require('node:child_process').spawnSync(require('electron'), [__filename], {
      env, encoding: 'utf8', windowsHide: true, timeout: 55000,
    })
    assert.equal(run.status, 0, `${run.error || ''}\n${run.stdout}\n${run.stderr}`)
    console.log(run.stdout.split('\n').filter(line => line.startsWith('LAN HTTP verified:')).join('\n'))
    assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'result.json'))).passed, true)
    console.log(`History UI evidence: ${output}`)
  })
} else {
  const { app, BrowserWindow, dialog } = require('electron')
  const workspace = path.resolve(__dirname, '..')
  const root = process.env.QPASTE_SMOKE_APP_ROOT || workspace
  const output = process.env.QPASTE_HISTORY_OUTPUT
  app.setPath('userData', path.join(output, 'profile'))
  app.getAppPath = () => root
  const getPath = app.getPath.bind(app)
  app.getPath = (key) => key === 'documents' ? output : getPath(key)
  app.setLoginItemSettings = () => {}
  const showMessageBox = dialog.showMessageBox.bind(dialog)
  let approvals = 0
  dialog.showMessageBox = async (...args) => {
    if (args.at(-1)?.message === '允许这台设备连接 Q-Paste？') {
      approvals++
      return { response: 0, checkboxChecked: false }
    }
    return showMessageBox(...args)
  }
  const Module = require('node:module'), load = Module._load
  Module._load = function (id) {
    const result = load.apply(this, arguments)
    return id === 'sql.js' ? (options) => result({ ...options, locateFile: (file) => path.join(workspace, 'node_modules/sql.js/dist', file) }) : result
  }
  require(path.join(root, 'dist-electron/main.js'))
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  async function until(read) {
    for (let i = 0; i < 150; i++) {
      const value = await read()
      if (value) return value
      await sleep(50)
    }
    throw new Error('Timed out waiting for history UI')
  }
  const evaluate = (window, code) => window.webContents.executeJavaScript(`(async () => (${code}))()`)
  app.whenReady().then(async () => {
    try {
      const main = await until(() => BrowserWindow.getAllWindows()[0])
      const pc = (code) => evaluate(main, code)
      await until(() => !main.webContents.isLoading())
      main.show()
      await until(() => pc(`Boolean(document.querySelector('button[title="设置"]'))`))
      const status = await pc(`window.electronAPI.ftToggle(true, 18879)`)
      assert.equal(status.success, true)
      const lan = await pc(`window.electronAPI.ftStatus()`)
      const ips = await pc(`window.electronAPI.ftGetAvailableIps()`)
      assert.ok(ips.includes(lan.ip), '二维码主机地址必须来自当前可用网卡')
      const response = await fetch(`http://${lan.ip}:${lan.port}/`)
      assert.equal(response.status, 200)
      console.log(`LAN HTTP verified: http://${lan.ip}:${lan.port}/; candidates: ${ips.join(', ')}`)
      await pc(`window.electronAPI.ftSendChatText('电脑历史消息')`)
      const oldId = await pc(`(await window.electronAPI.ftGetChatHistory()).at(-1).id`)
      await pc(`document.querySelector('button[title="设置"]').click()`)
      await until(() => pc(`Boolean([...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='局域网文件传输'))`))
      await pc(`[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='局域网文件传输').click()`)
      await until(() => pc(`document.querySelector('[data-testid="ft-message-list"]')?.textContent.includes('电脑历史消息')`))
      // Message-specific actions must survive event bubbling to the list menu.
      await pc(`document.querySelector('[data-testid="ft-message-list"] .select-text').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:200}))`)
      assert.ok(await pc(`document.querySelector('[role="menu"]').textContent.includes('复制文本')`))
      assert.ok(await pc(`document.querySelector('[role="menu"]').textContent.includes('清除历史记录')`))
      await pc(`document.querySelector('[data-testid="ft-message-list"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:innerWidth-2,clientY:innerHeight-2}))`)
      const menu = await pc(`(() => {const r=document.querySelector('[role="menu"]').getBoundingClientRect();return {right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};})()`)
      assert.ok(menu.right <= menu.width && menu.bottom <= menu.height)
      await sleep(150)
      fs.writeFileSync(path.join(output, 'desktop-menu.png'), (await main.webContents.capturePage()).toPNG())
      await pc(`document.querySelector('[role="menuitem"]').click()`)
      await until(() => pc(`(await window.electronAPI.ftGetChatHistory()).length === 0 && !document.querySelector('[data-testid="ft-message-list"]').textContent.includes('电脑历史消息')`))
      await pc(`[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='通用').click()`)
      await pc(`[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='局域网文件传输').click()`)
      assert.equal(await pc(`(await window.electronAPI.ftGetChatHistory()).length`), 0)
      const mobile = new BrowserWindow({ width: 430, height: 850, show: false })
      const phone = (code) => evaluate(mobile, code)
      await mobile.loadURL(`http://${lan.ip}:${lan.port}/`)
      mobile.showInactive()
      assert.equal((await fetch(`http://${lan.ip}:${lan.port}/poll`)).status, 401)
      await until(() => phone(`Boolean(document.querySelector('#trust-device'))`))
      await phone(`document.querySelector('#trust-device').click()`)
      await until(() => phone(`typeof socket !== 'undefined' && socket.readyState === 1`))
      assert.equal(approvals, 1)
      await pc(`window.electronAPI.ftSendChatText('手机待清除消息')`)
      await until(() => phone(`chatBox.textContent.includes('手机待清除消息')`))
      assert.ok(await pc(`(await window.electronAPI.ftGetChatHistory()).at(-1).id`) > oldId)
      // Scrolling cancels a long press rather than unexpectedly showing a menu.
      await phone(`(() => {chatBox.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch',isPrimary:true,clientX:12,clientY:200,bubbles:true}));chatBox.dispatchEvent(new PointerEvent('pointermove',{pointerType:'touch',clientX:12,clientY:250,bubbles:true}));})()`)
      await sleep(650)
      assert.equal(await phone(`document.getElementById('chat-history-menu').hidden`), true)
      await phone(`document.querySelector('.bubble').dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch',isPrimary:true,clientX:12,clientY:200,bubbles:true}))`)
      await sleep(650)
      assert.equal(await phone(`document.getElementById('chat-history-menu').hidden`), true)
      await phone(`chatBox.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch',isPrimary:true,clientX:12,clientY:200,bubbles:true}))`)
      await until(() => phone(`!document.getElementById('chat-history-menu').hidden`))
      await phone(`chatBox.dispatchEvent(new PointerEvent('pointerup',{pointerType:'touch',bubbles:true}))`)
      await sleep(150)
      fs.writeFileSync(path.join(output, 'mobile-menu.png'), (await mobile.webContents.capturePage()).toPNG())
      await phone(`document.getElementById('clear-chat-history').click()`)
      assert.equal(await phone(`chatBox.children.length`), 0)
      assert.ok(await pc(`(await window.electronAPI.ftGetChatHistory()).some(msg=>msg.content==='手机待清除消息')`))
      await pc(`window.electronAPI.ftSendChatText('清空后继续通信')`)
      await until(() => phone(`chatBox.textContent.includes('清空后继续通信')`))
      await pc(`window.electronAPI.ftClearChatHistory()`)
      assert.ok(await phone(`chatBox.textContent.includes('清空后继续通信')`))

      const transferUrl = `http://${lan.ip}:${lan.port}/`
      const transferVisible = async () => main.isVisible() && main.isFocused()
        && await pc(`Boolean(document.querySelector('[data-testid="ft-message-list"]'))`)
      const transferAtBottom = () => pc(`(() => {
        const panel = document.querySelector('[data-testid="ft-message-list"]')?.parentElement.closest('.overflow-y-auto');
        return Boolean(panel && panel.scrollTop > 0 && panel.scrollHeight - panel.clientHeight - panel.scrollTop <= 1);
      })()`)
      await pc(`[...document.querySelectorAll('button')].find(el => el.textContent.trim() === '通用').click()`)
      main.hide()
      assert.equal(main.isVisible(), false)
      mobile.show()
      await mobile.loadURL(transferUrl)
      await until(transferVisible)
      assert.equal(approvals, 1, '已信任的手机应直接打开传输页')
      assert.ok(await transferAtBottom(), '手机唤起应滚到桌面传输页底部')
      assert.equal(await pc(`document.body.textContent.includes('手机桌面快捷方式')`), false)

      await pc(`document.querySelector('[data-testid="ft-message-list"]').parentElement.closest('.overflow-y-auto').scrollTop = 0`)
      mobile.hide()
      await until(() => phone(`document.visibilityState === 'hidden'`))
      main.minimize()
      assert.equal(main.isMinimized(), true)
      mobile.show()
      await until(transferVisible)
      assert.equal(main.isMinimized(), false)
      await until(transferAtBottom)

      await pc(`[...document.querySelectorAll('button')].find(el => el.textContent.trim() === '通用').click()`)
      // Cover the desktop window without letting Windows occlusion hide the simulated phone page.
      await mobile.loadURL('about:blank')
      mobile.focus()
      assert.equal(main.isFocused(), false)
      const [credential] = await mobile.webContents.session.cookies.get({ url: transferUrl, name: 'qpaste_lan_device' })
      const wakeResponse = await fetch(new URL('/api/open-desktop', transferUrl), {
        method: 'POST', headers: { Origin: new URL(transferUrl).origin, Cookie: `${credential.name}=${credential.value}` },
      })
      assert.equal(wakeResponse.status, 204)
      await until(transferVisible)

      // The switch replaces the renderer that initiated it. Wait for the new page instead of its IPC reply.
      void pc(`window.electronAPI.switchAppMode('floral')`).catch(() => {})
      await until(() => main.webContents.getURL().includes('/dist/floral/index.html') && !main.webContents.isLoading())
      main.hide()
      mobile.show()
      await mobile.loadURL(`${transferUrl}shortcut/${'a'.repeat(32)}`)
      await until(transferVisible)
      await until(transferAtBottom)
      assert.equal(mobile.webContents.getURL(), transferUrl)

      fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, appRoot: root }))
      app.exit(0)
    } catch (error) { console.error(error); app.exit(1) }
  })
}
