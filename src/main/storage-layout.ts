import fs from 'node:fs'
import path from 'node:path'

export interface StorageLayout {
  rootDir: string
  databaseDir: string
  dbPath: string
  backupsDir: string
  imagesDir: string
  textsDir: string
  transfersDir: string
  exportsDir: string
  logsDir: string
  syncDir: string
  syncStatePath: string
  floralDir: string
  tempDir: string
  configDir: string
  configPath: string
}

export function getStorageLayout(rootDir: string): StorageLayout {
  const root = path.resolve(rootDir)
  const databaseDir = path.join(root, 'database')
  const syncDir = path.join(root, 'sync')
  const configDir = path.join(root, 'config')
  return {
    rootDir: root,
    databaseDir,
    dbPath: path.join(databaseDir, 'q-paste.db'),
    backupsDir: path.join(databaseDir, 'backups'),
    imagesDir: path.join(root, 'images'),
    textsDir: path.join(root, 'texts'),
    transfersDir: path.join(root, 'transfers'),
    exportsDir: path.join(root, 'exports'),
    logsDir: path.join(root, 'logs'),
    syncDir,
    syncStatePath: path.join(syncDir, 'cloud-sync-state.json'),
    floralDir: path.join(root, 'floral'),
    tempDir: path.join(root, 'temp'),
    configDir,
    configPath: path.join(configDir, 'q-paste-config.json'),
  }
}

export function ensureStorageLayout(layout: StorageLayout): void {
  for (const dir of [
    layout.rootDir, layout.databaseDir, layout.backupsDir, layout.imagesDir,
    layout.textsDir, layout.transfersDir, layout.exportsDir, layout.logsDir, layout.syncDir,
    layout.tempDir, layout.configDir, layout.floralDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function isPathInside(parent: string, candidate: string): boolean {
  const root = path.resolve(parent)
  const target = path.resolve(candidate)
  return target.startsWith(root + path.sep)
}
