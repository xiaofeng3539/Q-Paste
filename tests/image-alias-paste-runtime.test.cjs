const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')

if (!process.versions.electron) {
  const { test } = require('node:test')
  for (const name of ['alias', 'floral']) test(`图片功能：${name}`, { timeout: 40000 }, () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), `qpaste-image-${name}-`))
    const env = { ...process.env, QPASTE_IMAGE_OUTPUT: output, QPASTE_IMAGE_CASE: name }
    delete env.ELECTRON_RUN_AS_NODE
    const run = require('node:child_process').spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', windowsHide: true, timeout: 35000 })
    assert.equal(run.status, 0, `${run.error || ''}\n${run.stdout}\n${run.stderr}`)
    console.log(`Image evidence: ${output}`)
  })
} else {
  const { app, BrowserWindow, nativeImage } = require('electron')
  const workspace = path.resolve(__dirname, '..'), root = process.env.QPASTE_SMOKE_APP_ROOT || workspace
  const output = process.env.QPASTE_IMAGE_OUTPUT
  app.setPath('userData', path.join(output, 'profile'))
  app.getAppPath = () => root
  const getPath = app.getPath.bind(app)
  app.getPath = (key) => key === 'documents' ? output : getPath(key)
  app.setLoginItemSettings = () => {}
  const Module = require('node:module'), load = Module._load
  Module._load = function (id) {
    const value = load.apply(this, arguments)
    return id === 'sql.js' ? (options) => value({ ...options, locateFile: (file) => path.join(workspace, 'node_modules/sql.js/dist', file) }) : value
  }
  require(path.join(root, 'dist-electron/main.js'))
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  async function until(fn) {
    for (let i = 0; i < 120; i++) { const value = await fn(); if (value) return value; await sleep(50) }
    throw new Error('Timed out waiting for image UI')
  }
  app.whenReady().then(async () => {
    try {
      const window = await until(() => BrowserWindow.getAllWindows()[0])
      const js = (code) => window.webContents.executeJavaScript(`(async () => (${code}))()`)
      await until(() => !window.webContents.isLoading())
      await until(() => js('Boolean(window.electronAPI)'))
      window.show(); window.focus()
      const bitmap = Buffer.alloc(64 * 40 * 4)
      for (let i = 0; i < bitmap.length; i += 4) {
        bitmap[i] = 180; bitmap[i + 1] = 130; bitmap[i + 2] = 40; bitmap[i + 3] = 255
      }
      const png = nativeImage.createFromBitmap(bitmap, { width: 64, height: 40 }).toPNG()
      if (process.env.QPASTE_IMAGE_CASE === 'alias') {
        const item = await js(`window.electronAPI.insertItem({type:'image',content:${JSON.stringify('data:image/png;base64,' + png.toString('base64'))},preview:'图片测试',charCount:0,storageSize:${png.length},createdAt:'2026-11-16 12:00:00'})`)
        const select = async () => {
          await until(() => js(`Boolean(document.querySelector('[data-id="${item.id}"] button'))`))
          await js(`document.querySelector('[data-id="${item.id}"] button').click()`)
          await sleep(100)
        }
        await window.reload(); await until(() => !window.webContents.isLoading()); await select()
        assert.ok(await js(`Boolean(document.querySelector('button[title="设置别名..."]'))`), '图片详情必须提供设置别名入口')
        await js(`document.querySelector('button[title="设置别名..."]').click()`)
        await js(`(() => {const el=document.querySelector('input[placeholder="设置别名..."]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'考试安排图片');el.dispatchEvent(new Event('input',{bubbles:true}));})()`)
        await sleep(50)
        await js(`document.querySelector('input[placeholder="设置别名..."]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`)
        await until(() => js(`(await window.electronAPI.getItems({ids:[${item.id}],limit:1,offset:0,summaryOnly:true}))[0].alias==='考试安排图片'`))
        await window.reload(); await until(() => !window.webContents.isLoading()); await select()
        assert.equal(await js(`document.querySelector('button[title="设置别名..."]').textContent`), '考试安排图片')
        assert.ok(await js(`document.querySelector('[data-id="${item.id}"]').textContent.includes('考试安排图片')`))
        assert.equal(await js(`(await window.electronAPI.getItems({search:'考试安排图片',limit:10,offset:0})).length`), 1)
        fs.writeFileSync(path.join(output, 'alias.png'), (await window.webContents.capturePage()).toPNG())
      } else {
        await js(`window.electronAPI.floralInvoke('config_save',{config:{defaultViewMode:'edit',noteAutoSave:true}})`)
        const note = await js(`window.electronAPI.floralInvoke('notes_create',{request:{title:'图片粘贴测试',content:'',category:''}})`)
        await window.loadFile(path.join(root, 'dist/floral/index.html'))
        await until(() => js(`Boolean(document.querySelector('[data-note-id="${note.id}"]'))`))
        await js(`document.querySelector('[data-note-id="${note.id}"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))`)
        await until(() => js(`Boolean(document.querySelector('textarea:not([disabled])'))`))
        assert.equal(await js(`(() => {const el=document.querySelector('textarea:not([disabled])');const dt=new DataTransfer();dt.setData('text/plain','普通文字');return el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));})()`), true, '普通文字粘贴不能被图片处理拦截')
        assert.equal(await js(`Boolean(document.querySelector('.markdown-selectable'))`), false, '普通文字粘贴不能切换编辑模式')
        await js(`(() => {const el=document.querySelector('textarea:not([disabled])');el.focus();const dt=new DataTransfer();for(let i=0;i<2;i++)dt.items.add(new File([Uint8Array.from(${JSON.stringify([...png])})],'fixture'+i+'.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));})()`)
        await until(() => js(`document.querySelector('textarea')?.value.includes('![](images/')`))
        await sleep(1200)
        const visible = () => js(`[...document.querySelectorAll('.markdown-selectable img')].filter(img=>img.complete&&img.naturalWidth===64).length===2`)
        const automatic = await visible()
        if (!automatic) {
          await js(`[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='分栏').click()`)
          await until(visible)
        }
        await until(() => js(`(await window.electronAPI.floralInvoke('notes_get',{id:${JSON.stringify(note.id)}})).content.split('![](images/').length===3`))
        await sleep(150)
        fs.writeFileSync(path.join(output, 'preview.png'), (await window.webContents.capturePage()).toPNG())
        assert.ok(automatic, '粘贴后必须直接显示图片预览，不能只留下 Markdown 地址（手动分栏可以加载图片）')
        const thumbnailWidth = await js(`document.querySelector('.markdown-selectable img').getBoundingClientRect().width`)
        await js(`document.querySelector('.markdown-selectable img').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}))`)
        assert.ok(await js(`Boolean(document.querySelector('dialog[open]'))`), '双击预览图片必须打开大图')
        await until(() => js(`Boolean(document.querySelector('dialog[open] img')?.complete)`))
        assert.ok(await js(`document.querySelector('dialog[open] img').getBoundingClientRect().width > ${thumbnailWidth}`), '大图必须比缩略图更大')
        assert.equal(await js(`document.querySelector('dialog[open] img').naturalWidth`), 64)
        const initialWidth = await js(`document.querySelector('dialog[open] img').getBoundingClientRect().width`)
        await js(`document.querySelector('dialog[open]').dispatchEvent(new WheelEvent('wheel',{deltaY:-100,clientX:700,clientY:400,bubbles:true,cancelable:true}))`)
        await until(() => js(`document.querySelector('dialog[open]').textContent.includes('110%')`))
        assert.ok(await js(`Math.abs(document.querySelector('dialog[open] img').getBoundingClientRect().width / ${initialWidth} - 1.1) < 0.01`), '滚轮必须实际放大图片')
        const beforeDrag = await js(`document.querySelector('dialog[open] img').getBoundingClientRect().x`)
        await js(`document.querySelector('dialog[open] img').dispatchEvent(new MouseEvent('mousedown',{button:0,clientX:500,clientY:400,bubbles:true,cancelable:true}))`)
        await js(`(() => {window.dispatchEvent(new MouseEvent('mousemove',{clientX:580,clientY:440}));window.dispatchEvent(new MouseEvent('mouseup'));})()`)
        assert.ok(await js(`Math.abs(document.querySelector('dialog[open] img').getBoundingClientRect().x - ${beforeDrag} - 80)<1`), '拖拽必须平移图片')
        fs.writeFileSync(path.join(output, 'pan-zoom.png'), (await window.webContents.capturePage()).toPNG())
        await js(`document.querySelector('dialog[open] img').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}))`)
        await until(() => js(`document.querySelector('dialog[open]').textContent.includes('100%')`))
        assert.equal(await js(`document.querySelector('dialog[open] img').style.transform`), 'translate(calc(-50% + 0px), calc(-50% + 0px)) scale(1)')
        await js(`document.querySelector('dialog[open]').dispatchEvent(new WheelEvent('wheel',{deltaY:100,bubbles:true,cancelable:true}))`)
        await until(() => js(`document.querySelector('dialog[open]').textContent.includes('90%')`))
        await js(`document.querySelector('dialog[open] button[title="重置"]').click()`)
        await until(() => js(`document.querySelector('dialog[open]').textContent.includes('100%')`))
        await js(`document.querySelector('dialog[open] button[aria-label="关闭图片预览"]').click()`)
        await until(() => js(`!document.querySelector('dialog[open]')`))
        await js(`document.querySelector('.markdown-selectable img').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}))`)
        await until(() => js(`Boolean(document.querySelector('dialog[open]'))`))
        fs.writeFileSync(path.join(output, 'enlarged.png'), (await window.webContents.capturePage()).toPNG())
        window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'})
        window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})
        await until(() => js(`!document.querySelector('dialog[open]')`))
        await js(`document.querySelector('.markdown-selectable img').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`)
        await until(() => js(`Boolean(document.querySelector('dialog[open]'))`))
        await js(`document.querySelector('dialog[open]').click()`)
        await until(() => js(`!document.querySelector('dialog[open]')`))
        await window.reload(); await until(() => !window.webContents.isLoading())
        await until(() => js(`Boolean([...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='预览'))`))
        await js(`[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='预览').click()`)
        await until(visible)
      }
      fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true }))
      app.exit(0)
    } catch (error) { console.error(error); app.exit(1) }
  })
}
