import fs from 'node:fs/promises'
import path from 'node:path'
import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'

export class FloralMigrationGate {
  private pending = new Set<Promise<unknown>>()
  private migration: Promise<unknown> | undefined

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.migration ? this.migration.catch(() => undefined).then(operation) : operation()
    this.pending.add(result)
    return result.finally(() => this.pending.delete(result))
  }

  migrate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.migration ? [...this.pending, this.migration] : [...this.pending]
    const result = Promise.allSettled(previous).then(operation)
    this.migration = result
    return result.finally(() => {
      if (this.migration === result) this.migration = undefined
    })
  }
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function verifyCopiedFiles(source: string, target: string): Promise<void> {
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(target, entry.name)
    if (entry.isDirectory()) await verifyCopiedFiles(from, to)
    else if (entry.isFile() && await hashFile(from) !== await hashFile(to)) {
      throw new Error('花笺迁移后的文件校验失败')
    }
  }
}

export async function copyExistingFloralData(source: string, destination: string): Promise<boolean> {
  const sourceRoot = path.resolve(source)
  const targetRoot = path.resolve(destination)
  if (sourceRoot === targetRoot || targetRoot.startsWith(sourceRoot + path.sep)) return false
  try {
    await fs.access(path.join(sourceRoot, 'metadata.json'))
    await fs.access(path.join(sourceRoot, 'notes'))
  } catch { return false }
  let destinationExists = false
  try {
    const existing = await fs.readdir(targetRoot)
    if (existing.length > 0) return false
    destinationExists = true
  } catch { /* destination is new */ }

  const staging = `${targetRoot}.migrating-${randomUUID()}`
  try {
    await fs.cp(sourceRoot, staging, { recursive: true, errorOnExist: true, force: false })
    const sourceMetadata = JSON.parse(await fs.readFile(path.join(sourceRoot, 'metadata.json'), 'utf8'))
    if (!Array.isArray(sourceMetadata.notes)) throw new Error('无效的花笺笔记索引')
    await verifyCopiedFiles(sourceRoot, staging)
    await fs.mkdir(path.dirname(targetRoot), { recursive: true })
    if (destinationExists) await fs.rmdir(targetRoot)
    await fs.rename(staging, targetRoot)
    return true
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}
