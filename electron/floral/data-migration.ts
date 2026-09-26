import fs from 'node:fs/promises'
import path from 'node:path'

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

  const staging = `${targetRoot}.migrating`
  try {
    await fs.cp(sourceRoot, staging, { recursive: true, errorOnExist: true, force: false })
    const sourceMetadata = JSON.parse(await fs.readFile(path.join(sourceRoot, 'metadata.json'), 'utf8'))
    const copiedMetadata = JSON.parse(await fs.readFile(path.join(staging, 'metadata.json'), 'utf8'))
    const sourceCount = Array.isArray(sourceMetadata.notes) ? sourceMetadata.notes.length : -1
    const copiedCount = Array.isArray(copiedMetadata.notes) ? copiedMetadata.notes.length : -2
    if (sourceCount < 0 || sourceCount !== copiedCount) throw new Error('Floral metadata validation failed')
    await fs.mkdir(path.dirname(targetRoot), { recursive: true })
    if (destinationExists) await fs.rmdir(targetRoot)
    await fs.rename(staging, targetRoot)
    return true
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}
