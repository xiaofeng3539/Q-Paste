import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from 'node:sqlite'
import type { StorageLayout } from './storage-layout'

type Row = Record<string, SQLOutputValue>
type Bindings = Record<string, SQLInputValue>

/** Matches the existing SQL call sites while statements operate directly on the on-disk database. */
export class NativeDatabase {
  private readonly connection: DatabaseSync

  constructor(file: string, readOnly = false) {
    this.connection = new DatabaseSync(file, { readOnly })
    try {
      this.connection.exec('PRAGMA busy_timeout = 1500')
      if (!readOnly) this.connection.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL')
    } catch (error) {
      this.connection.close()
      throw error
    }
  }

  run(sql: string, bindings?: Bindings): void {
    if (bindings) this.connection.prepare(sql).run(bindings)
    else this.connection.exec(sql)
  }

  exec(sql: string): Array<{ values: SQLOutputValue[][] }> {
    const rows = this.connection.prepare(sql).all()
    return [{ values: rows.map((row) => Object.values(row)) }]
  }

  prepare(sql: string) {
    const statement = this.connection.prepare(sql)
    let bindings: Bindings = {}
    let rows: Row[] | undefined
    let index = -1
    return {
      bind(values: Bindings) {
        bindings = values
        rows = undefined
        index = -1
      },
      step() {
        rows ??= Object.keys(bindings).length ? statement.all(bindings) : statement.all()
        return ++index < rows.length
      },
      getAsObject(): Row {
        return rows?.[index] ?? {}
      },
      free() {
        rows = undefined
      },
    }
  }

  transaction<T>(operation: () => T): T {
    this.run('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.run('COMMIT')
      return result
    } catch (error) {
      try { this.run('ROLLBACK') } catch {}
      throw error
    }
  }

  close(): void {
    this.connection.close()
  }
}

function inspectDatabase(file: string): number | null {
  if (!fs.statSync(file, { throwIfNoEntry: false })?.size) return null
  const db = new NativeDatabase(file, true)
  try {
    if (db.exec('PRAGMA quick_check')[0].values[0]?.[0] !== 'ok') return null
    const hasItems = db.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'items'")[0].values.length > 0
    return hasItems ? Number(db.exec('SELECT count(*) FROM items')[0].values[0][0]) : null
  } catch (error) {
    // Replacing a database that is busy or inaccessible can lose data.
    const code = (error as { errcode?: number }).errcode
    if (code === undefined || ![11, 26].includes(code & 0xff)) throw error
    return null
  } finally {
    db.close()
  }
}

export function writeDatabaseSnapshot(source: string, destination: string): void {
  const target = path.resolve(destination)
  const realSource = fs.realpathSync(source)
  const realTarget = fs.existsSync(target) ? fs.realpathSync(target) : target
  const normalize = (file: string) => process.platform === 'win32' ? file.toLowerCase() : file
  if (normalize(realSource) === normalize(realTarget)) throw new Error('Cannot back up the database over itself')
  if (fs.existsSync(target + '-wal') || fs.existsSync(target + '-shm')) {
    throw new Error('Cannot overwrite a database with an active journal')
  }
  const pending = target + '.' + randomUUID() + '.tmp'
  const db = new NativeDatabase(source, true)
  try {
    db.run('VACUUM INTO :destination', { ':destination': pending })
    const handle = fs.openSync(pending, 'r+')
    try { fs.fsyncSync(handle) } finally { fs.closeSync(handle) }
    fs.renameSync(pending, target)
  } finally {
    db.close()
    fs.rmSync(pending, { force: true })
  }
}

/** Prepare the file and leave a healthy primary in place, even when a backup contains more rows. */
export function openHistoryDatabase(layout: StorageLayout): 'healthy' | 'recovered' | 'new' | 'damaged' {
  const { dbPath, databaseDir, backupsDir } = layout
  const preUpgrade = path.join(backupsDir, 'q-paste.pre-native.db')
  if (inspectDatabase(dbPath) !== null) {
    const reader = new NativeDatabase(dbPath, true)
    try {
      if (reader.exec('PRAGMA user_version')[0].values[0]?.[0] === 0 && !fs.existsSync(preUpgrade)) {
        writeDatabaseSnapshot(dbPath, preUpgrade)
      }
    } finally { reader.close() }
    return 'healthy'
  }

  const candidates = [databaseDir, backupsDir].flatMap((dir) =>
    fs.readdirSync(dir).filter((name) => /^(?:q-paste\.db\.(?:bak|pre-rollback)|q-paste\.pre-native\.db|history\.(?:db|bak))$|\.db\.tmp$/i.test(name))
      .map((name) => path.join(dir, name)),
  )
  const ranked = candidates.flatMap((file) => {
    try {
      const count = inspectDatabase(file)
      return count === null ? [] : [{ file, count, mtime: fs.statSync(file).mtimeMs }]
    } catch { return [] }
  }).sort((a, b) => b.count - a.count || b.mtime - a.mtime)

  const recovery = ranked[0]
  const preserved: Array<[string, string]> = []
  const suffix = '.damaged-' + randomUUID()
  try {
    for (const extension of ['', '-wal', '-shm', '-journal']) {
      const source = dbPath + extension
      if (!fs.existsSync(source)) continue
      const target = dbPath + suffix + extension
      fs.renameSync(source, target)
      preserved.push([source, target])
    }
    if (recovery) {
      writeDatabaseSnapshot(recovery.file, dbPath)
      return 'recovered'
    }
  } catch (error) {
    for (const [source, target] of preserved.reverse()) fs.renameSync(target, source)
    throw error
  }
  return preserved.length ? 'damaged' : 'new'
}
