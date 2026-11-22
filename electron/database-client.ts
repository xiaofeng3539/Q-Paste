import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { DatabaseTask, DatabaseTaskResult } from '../src/main/database-tasks'

let worker: Worker | undefined
let nextId = 0
const pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>()

export function runDatabaseTask<T extends DatabaseTask>(task: T): Promise<DatabaseTaskResult<T>> {
  if (!worker) {
    const started = new Worker(path.join(__dirname, 'database-worker.cjs'))
    worker = started
    const failed = (error: Error) => {
      if (worker !== started) return
      worker = undefined
      for (const request of pending.values()) request.reject(error)
      pending.clear()
    }
    started.on('message', ({ id, result, error }) => {
      const request = pending.get(id)
      pending.delete(id)
      if (error !== undefined) request?.reject(new Error(error))
      else request?.resolve(result)
    })
    started.on('error', failed)
    started.on('exit', (code) => failed(new Error(`Database worker exited (${code})`)))
    started.unref()
  }
  const active = worker
  return new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve: (result) => resolve(result as DatabaseTaskResult<T>), reject })
    try { active.postMessage({ id, task }) }
    catch (error) { pending.delete(id); reject(error) }
  })
}
