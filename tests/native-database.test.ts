import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import initSqlJs from 'sql.js'
import { afterEach, describe, expect, it } from 'vitest'
import { NativeDatabase, openHistoryDatabase, writeDatabaseSnapshot } from '../src/main/native-database'
import { ensureStorageLayout, getStorageLayout } from '../src/main/storage-layout'
import { runDatabaseTask } from '../src/main/database-tasks'

const temporaryRoots: string[] = []
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'q-paste-native-db-'))
  temporaryRoots.push(root)
  const layout = getStorageLayout(root)
  ensureStorageLayout(layout)
  const SQL = await initSqlJs()
  const old = new SQL.Database()
  old.run('CREATE TABLE items (id INTEGER PRIMARY KEY, content TEXT NOT NULL)')
  old.run('INSERT INTO items VALUES (7, :text)', { ':text': '旧记录' })
  fs.writeFileSync(layout.dbPath, old.export())
  old.close()
  return layout
}

describe('原生 SQLite 历史库', () => {
  it('backs up external content and ignores export time in the cloud fingerprint', async () => {
    const layout = await fixture()
    const db = new NativeDatabase(layout.dbPath)
    try {
      db.run('DROP TABLE items')
      db.run(`CREATE TABLE items (id INTEGER PRIMARY KEY, type TEXT, content TEXT, preview TEXT, char_count INTEGER,
        storage_size INTEGER, created_at TEXT, is_pinned INTEGER, pinned_at TEXT, alias TEXT, tags TEXT,
        is_sensitive INTEGER, sort_order INTEGER, vault_sort_order INTEGER)`)
      const ref = 'texts/txt_123_00000000-0000-0000-0000-000000000000.txt'
      fs.writeFileSync(path.join(layout.rootDir, ref), '完整正文'.repeat(20000), 'utf8')
      fs.writeFileSync(path.join(layout.imagesDir, 'test.jpg'), Buffer.from([1, 2, 3]))
      db.run("INSERT INTO items VALUES (1, 'text', :ref, '', 0, 0, '', 1, '', '别名', '[\"标签\"]', 0, 10, 5)", { ':ref': ref })
      db.run("INSERT INTO items VALUES (2, 'image', 'images/test.jpg', '', 0, 0, '', 0, '', '', '[]', 0, 0, 0)")
      db.run("INSERT INTO items VALUES (3, 'text', 'private', '', 0, 0, '', 0, '', '', '[]', 1, 0, 0)")
      const task = { kind: 'backup-json' as const, layout, version: '1.4.0' }
      expect(runDatabaseTask({ kind: 'search', layout, ids: [2, 3, 1], query: '完整正文' })).toEqual([1])
      expect(runDatabaseTask({ kind: 'search', layout, ids: [1, 2, 3], query: 'PriVaTe' })).toEqual([3])
      expect((runDatabaseTask({ kind: 'sync-export', layout }) as Array<{ content: string }>).map(row => row.content))
        .toEqual(['完整正文'.repeat(20000), 'data:image/jpeg;base64,AQID'])
      const target = path.join(layout.exportsDir, 'backup.json')
      const snapshot = path.join(layout.exportsDir, 'backup.db')
      expect(runDatabaseTask({ kind: 'backup-db', layout, target: snapshot })).toBe(true)
      expect(fs.readFileSync(path.join(`${snapshot}.images`, 'test.jpg'))).toEqual(Buffer.from([1, 2, 3]))
      expect(fs.readFileSync(path.join(`${snapshot}.texts`, path.basename(ref)), 'utf8')).toBe('完整正文'.repeat(20000))
      runDatabaseTask({ ...task, target })
      const local = JSON.parse(fs.readFileSync(target, 'utf8'))
      expect(local.items[0]).toMatchObject({ content: '完整正文'.repeat(20000), alias: '别名', tags: '["标签"]', vault_sort_order: 5 })
      expect(local.items[1].content).toBe('data:image/jpeg;base64,AQID')
      expect(local.items).toHaveLength(3)
      const cloud = runDatabaseTask(task) as { payload: string; hash: string }
      expect(JSON.parse(cloud.payload).items).toHaveLength(2)
      expect(runDatabaseTask({ ...task, previousHash: cloud.hash })).toEqual({ hash: cloud.hash, payload: null })
      db.run('DELETE FROM items')
      const importTask = { kind: 'import-json' as const, layout, file: target }
      expect(runDatabaseTask(importTask)).toEqual({ count: 3, duplicates: 0, skipped: 0 })
      expect(runDatabaseTask(importTask)).toEqual({ count: 0, duplicates: 3, skipped: 0 })
      expect(db.exec("SELECT content, alias, tags, vault_sort_order FROM items WHERE alias = '别名'")[0].values)
        .toEqual([[local.items[0].content, '别名', '["标签"]', 5]])
      const restoredImage = String(db.exec("SELECT content FROM items WHERE type = 'image'")[0].values[0][0])
      expect(fs.readFileSync(path.join(layout.rootDir, restoredImage))).toEqual(Buffer.from([1, 2, 3]))
      const remote = { receipt: 'remote-v1', type: 'text', content: '从其他设备同步', preview: '', charCount: 8,
        storageSize: 24, createdAt: '2026-11-22 10:00:00' }
      const syncTask = { kind: 'sync-import' as const, layout, items: [remote] }
      expect(() => runDatabaseTask({ ...syncTask, items: [remote, { ...remote, receipt: 'broken', type: 'image' }] })).toThrow()
      expect(db.exec("SELECT count(*) FROM items WHERE content = '从其他设备同步'")[0].values).toEqual([[0]])
      expect(runDatabaseTask(syncTask)).toHaveLength(1)
      expect(runDatabaseTask(syncTask)).toEqual([])
      db.run('UPDATE items SET content = :ref WHERE id = 1', { ':ref': ref })
      fs.unlinkSync(path.join(layout.rootDir, ref))
      expect(() => runDatabaseTask({ ...task, target })).toThrow(/1/)
      expect(() => runDatabaseTask({ kind: 'backup-db', layout, target: snapshot })).toThrow()
      expect(fs.readFileSync(path.join(`${snapshot}.texts`, path.basename(ref)), 'utf8')).toBe(local.items[0].content)
      expect(JSON.parse(fs.readFileSync(target, 'utf8')).items[0].content).toBe(local.items[0].content)
    } finally { db.close() }
  })

  it('直接打开 sql.js 旧库，提交增量写入并备份未 checkpoint 的数据', async () => {
    const layout = await fixture()
    const db = new NativeDatabase(layout.dbPath)
    try {
      expect(db.exec('SELECT id, content FROM items')[0].values).toEqual([[7, '旧记录']])
      db.run('INSERT INTO items VALUES (:id, :text)', { ':id': 8, ':text': '新记录' })
      expect(fs.existsSync(layout.dbPath + '-wal')).toBe(true)
      const target = path.join(layout.backupsDir, 'export.db')
      writeDatabaseSnapshot(layout.dbPath, target)
      const snapshot = new NativeDatabase(target, true)
      try {
        expect(snapshot.exec('SELECT id, content FROM items ORDER BY id')[0].values).toEqual([[7, '旧记录'], [8, '新记录']])
      } finally { snapshot.close() }
    } finally { db.close() }
  })

  it('健康的主库优先，避免从旧备份复活已删除记录', async () => {
    const layout = await fixture()
    fs.copyFileSync(layout.dbPath, path.join(layout.backupsDir, 'q-paste.db.bak'))
    const db = new NativeDatabase(layout.dbPath)
    db.run('DELETE FROM items')
    db.close()
    expect(openHistoryDatabase(layout)).toBe('healthy')
    const reopened = new NativeDatabase(layout.dbPath)
    try { expect(reopened.exec('SELECT count(*) FROM items')[0].values).toEqual([[0]]) }
    finally { reopened.close() }
  })

  it('恢复损坏的主库时保留原文件', async () => {
    const layout = await fixture()
    fs.copyFileSync(layout.dbPath, path.join(layout.backupsDir, 'q-paste.db.bak'))
    fs.writeFileSync(layout.dbPath, 'damaged')
    expect(openHistoryDatabase(layout)).toBe('recovered')
    const preserved = fs.readdirSync(layout.databaseDir).find((name) => name.includes('.damaged-'))
    expect(preserved && fs.readFileSync(path.join(layout.databaseDir, preserved), 'utf8')).toBe('damaged')
    const db = new NativeDatabase(layout.dbPath)
    try { expect(db.exec('SELECT id, content FROM items')[0].values).toEqual([[7, '旧记录']]) }
    finally { db.close() }
  })
})
