# Q-Paste 云同步 IPC 接入范例

对应 [SyncEngine.ts](./SyncEngine.ts) 与 [types.ts](./types.ts)，三段均为可直贴的完整逻辑（每段 ≤15 行）。

## 1) 主进程 `electron/main.ts` —— 注册同步服务与 IPC 通道

```ts
import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { SyncEngine } from './sync/SyncEngine'
import type { ClipboardSyncItem, SyncConfig } from './sync/types'

const syncEngine = new SyncEngine()
ipcMain.handle('sync:init', async (_e, cfg: SyncConfig) => {
  await syncEngine.init(cfg, join(app.getPath('userData'), 'sync-state.json'))
  return syncEngine.status
})
ipcMain.handle('sync:push', (_e, item: ClipboardSyncItem) => syncEngine.pushItem(item))
ipcMain.handle('sync:pull', (_e, since: number) => syncEngine.pullChanges(since))
ipcMain.handle('sync:status', () => syncEngine.status)
```

入库回调（渲染层之外也生效，建议在创建窗口后设置）：

```ts
const win = mainWindow // 已有的 BrowserWindow 引用
syncEngine.onPulled = (items) => {
  void db.insertSyncedItems(items) // 按主键 id = `${type}:${hash}` 幂等 UPSERT 本地历史表
  win.webContents.send('clipboard:sync-pulled', items)
}
```

## 2) 预加载层 `electron/preload.ts` —— contextBridge 暴露

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { ClipboardSyncItem, CloudSyncStatus, SyncConfig } from '../src/main/sync/types'

contextBridge.exposeInMainWorld('cloudSync', {
  init: (cfg: SyncConfig) => ipcRenderer.invoke('sync:init', cfg) as Promise<CloudSyncStatus>,
  push: (item: ClipboardSyncItem) => ipcRenderer.invoke('sync:push', item) as Promise<boolean>,
  pull: (since: number) => ipcRenderer.invoke('sync:pull', since) as Promise<ClipboardSyncItem[]>,
  status: () => ipcRenderer.invoke('sync:status') as Promise<CloudSyncStatus>,
})
```

## 3) 渲染层 React —— 设置页初始化 + 剪贴板事件推送

```ts
const status = await window.cloudSync.init({
  enabled: true, webdavUrl: 'https://dav.jianguoyun.com/dav/',
  username: 'me@example.com', password: 'app-password',
  basePath: 'qpaste-sync', deviceId: savedDeviceId, intervalSecs: 120,
})

// 监听剪贴板变化时增量上传（device 都走本机标识）：
const ok = await window.cloudSync.push({
  id: '', type: 'text', content: text, html: null, hash: '',
  preview: text.slice(0, 200), createdAt: Date.now(), updatedAt: Date.now(),
  deviceId: '', deletedAt: 0,
})

// 远端变更到达（主进程推送）：
useEffect(() => {
  const off = window.electron.on('clipboard:sync-pulled', (items) => setHistory(prev => mergeLWW(prev, items)))
  return off
}, [])
```
