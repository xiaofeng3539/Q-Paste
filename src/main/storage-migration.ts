import fs from 'node:fs'
import path from 'node:path'
import { ensureStorageLayout, getStorageLayout, type StorageLayout } from './storage-layout'

interface RootPointer { rootPath?: unknown }

export function readStorageRootPointer(pointerPath: string): string | null {
  try {
    const data = JSON.parse(fs.readFileSync(pointerPath, 'utf8')) as RootPointer
    if (typeof data.rootPath !== 'string' || !data.rootPath.trim() || !path.isAbsolute(data.rootPath)) return null
    const rootPath = path.resolve(data.rootPath)
    return fs.existsSync(rootPath) ? rootPath : null
  } catch {
    return null
  }
}

export function writeStorageRootPointer(pointerPath: string, rootPath: string): void {
  const target = path.resolve(rootPath)
  fs.mkdirSync(path.dirname(pointerPath), { recursive: true })
  const tempPath = `${pointerPath}.${process.pid}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify({ rootPath: target }, null, 2), 'utf8')
  fs.renameSync(tempPath, pointerPath)
}

function copyFileIfMissing(source: string, target: string): void {
  if (!fs.existsSync(source) || fs.existsSync(target)) return
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
}

function copyDirectoryIfMissing(source: string, target: string): void {
  if (!fs.existsSync(source)) return
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) copyDirectoryIfMissing(from, to)
    else copyFileIfMissing(from, to)
  }
}

export function migrateLegacyStorage({
  legacyRoot,
  legacyUserData,
  layout,
}: {
  legacyRoot: string
  legacyUserData: string
  layout: StorageLayout
}): void {
  ensureStorageLayout(layout)
  const oldRoot = path.resolve(legacyRoot)
  const oldUserData = path.resolve(legacyUserData)
  copyFileIfMissing(path.join(oldRoot, 'q-paste.db'), layout.dbPath)
  for (const name of ['q-paste.db.bak', 'q-paste.db.pre-rollback', 'history.db', 'history.bak']) {
    copyFileIfMissing(path.join(oldRoot, name), path.join(layout.backupsDir, name))
  }
  copyDirectoryIfMissing(path.join(oldRoot, 'images'), layout.imagesDir)
  copyDirectoryIfMissing(path.join(oldRoot, 'texts'), layout.textsDir)
  copyFileIfMissing(path.join(oldUserData, 'q-paste-config.json'), layout.configPath)
  if (oldRoot !== oldUserData) copyFileIfMissing(path.join(oldRoot, 'q-paste-config.json'), layout.configPath)
  copyDirectoryIfMissing(path.join(oldUserData, 'logs'), layout.logsDir)
  copyFileIfMissing(path.join(oldUserData, 'cloud-sync-state.json'), layout.syncStatePath)
}

export function resolveLegacyStorageRoot(legacyConfigPath: string, userDataPath: string): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(legacyConfigPath, 'utf8')) as { storagePath?: unknown }
    if (typeof parsed.storagePath === 'string' && parsed.storagePath.trim() && path.isAbsolute(parsed.storagePath)) {
      return path.resolve(parsed.storagePath)
    }
  } catch {}
  return path.resolve(userDataPath)
}

export function prepareStorageRoot({ pointerPath, legacyConfigPath, userDataPath }: {
  pointerPath: string
  legacyConfigPath: string
  userDataPath: string
}): { layout: StorageLayout; isNewPointer: boolean; legacyRoot: string } {
  const pointedRoot = readStorageRootPointer(pointerPath)
  const legacyRoot = resolveLegacyStorageRoot(legacyConfigPath, userDataPath)
  const layout = getStorageLayout(pointedRoot ?? legacyRoot)
  if (!pointedRoot) migrateLegacyStorage({ legacyRoot, legacyUserData: userDataPath, layout })
  else ensureStorageLayout(layout)
  return { layout, isNewPointer: !pointedRoot, legacyRoot }
}
