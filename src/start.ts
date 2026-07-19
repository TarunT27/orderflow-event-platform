import { resolve } from 'node:path'
import { buildGateway } from './gateway/app.js'
import { createPlatformRuntime } from './runtime.js'

const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 4000)
const runtime = createPlatformRuntime({
  dataDir: process.env.DATA_DIR ?? './data',
  maxAttempts: Number(process.env.MAX_DELIVERY_ATTEMPTS ?? 3),
  pollMs: Number(process.env.WORKER_POLL_MS ?? 100),
})
const app = buildGateway(runtime.dependencies, {
  logger: true,
  staticRoot: resolve('dist/web'),
  demoMode: process.env.DEMO_MODE !== 'false',
})
runtime.app = app
runtime.startWorkers()

let shuttingDown = false
const shutdown = async (signal: string) => {
  if (shuttingDown) return
  shuttingDown = true
  app.log.info({ signal }, 'graceful shutdown started')
  runtime.stopWorkers()
  const forcedExit = setTimeout(() => {
    app.log.error({ signal }, 'graceful shutdown timed out')
    process.exit(1)
  }, 10_000)
  try {
    await app.close()
    runtime.close()
    process.exitCode = 0
  } catch (error) {
    app.log.error(error, 'graceful shutdown failed')
    process.exitCode = 1
  } finally {
    clearTimeout(forcedExit)
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

try {
  await app.listen({ host, port })
} catch (error) {
  app.log.error(error)
  runtime.close()
  process.exit(1)
}
