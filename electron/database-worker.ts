import { parentPort } from 'node:worker_threads'
import { runDatabaseTask, type DatabaseTask } from '../src/main/database-tasks'

if (!parentPort) throw new Error('Database worker must run in a worker thread')
const port = parentPort
port.on('message', ({ id, task }: { id: number; task: DatabaseTask }) => {
  try {
    port.postMessage({ id, result: runDatabaseTask(task) })
  } catch (error) {
    port.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
})
