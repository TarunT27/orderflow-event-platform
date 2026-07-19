import type { FastifyInstance } from 'fastify'
import { createPlatformRuntime, type PlatformRuntime } from '@/runtime.js'

export interface TestRuntime extends PlatformRuntime {
  app: FastifyInstance
}

export function createTestRuntime(options: { maxAttempts?: number } = {}): TestRuntime {
  return createPlatformRuntime({
    inMemory: true,
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
  }) as TestRuntime
}
