import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { z } from 'zod'
import { createOrderSchema, paymentTokens } from '../shared/contracts.js'
import type { DurableEventBus } from '../shared/messaging.js'
import type { InventoryService } from '../services/inventory/service.js'
import { IdempotencyConflictError, type OrderService } from '../services/orders/service.js'
import type { PaymentService } from '../services/payments/service.js'

export interface GatewayDependencies {
  readonly orders: OrderService
  readonly inventory: InventoryService
  readonly payments: PaymentService
  readonly bus: DurableEventBus
  readonly drain?: () => Promise<void>
  readonly redrive?: (id: string, paymentToken?: string) => unknown
}

export interface GatewayOptions {
  readonly logger?: boolean
  readonly staticRoot?: string
  readonly demoMode?: boolean
}

const idempotencySchema = z.string().min(1).max(128).regex(/^\S(?:.*\S)?$/)

export function buildGateway(dependencies: GatewayDependencies, options: GatewayOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 32 * 1024,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  })
  void app.register(cors, { origin: false })
  void app.register(rateLimit, { max: 100, timeWindow: '1 minute' })

  app.get('/health/live', async () => ({ data: { status: 'ok' } }))
  app.get('/health/ready', async () => ({ data: { status: 'ready', queue: dependencies.bus.metrics() } }))

  app.get('/api/v1/products', async () => ({ data: dependencies.inventory.listProducts() }))
  app.get('/api/v1/orders', async (request, reply) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(request.query)
    if (!query.success) return validationError(reply, query.error)
    return { data: dependencies.orders.list(query.data.limit) }
  })

  app.get('/api/v1/orders/:id', async (request, reply) => {
    const parsed = z.object({ id: z.string().uuid() }).safeParse(request.params)
    if (!parsed.success) return validationError(reply, parsed.error)
    const order = dependencies.orders.get(parsed.data.id)
    if (!order) return reply.code(404).send({ error: { code: 'not_found', message: 'Order not found' } })
    return { data: order }
  })

  app.post('/api/v1/orders', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = createOrderSchema.safeParse(request.body)
    const key = idempotencySchema.safeParse(request.headers['idempotency-key'])
    if (!body.success) return validationError(reply, body.error)
    if (!key.success) return validationError(reply, key.error)
    try {
      const result = dependencies.orders.createWithReplay(body.data, key.data)
      if (result.replayed) reply.header('idempotent-replay', 'true')
      reply.header('location', `/api/v1/orders/${result.order.id}`)
      return reply.code(result.replayed ? 200 : 202).send({ data: result.order })
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return reply.code(409).send({ error: { code: 'idempotency_conflict', message: error.message } })
      }
      request.log.error({ err: error }, 'order creation failed')
      return reply.code(500).send({ error: { code: 'internal_error', message: 'Unable to create order' } })
    }
  })

  app.get('/api/v1/ops', async (_request, reply) => {
    if (options.demoMode === false) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } })
    const orders = dependencies.orders.list(100)
    const statusCounts = Object.fromEntries(
      ['PENDING', 'INVENTORY_RESERVED', 'PAYMENT_PROCESSING', 'COMPENSATING', 'CONFIRMED', 'REJECTED', 'FAILED']
        .map((status) => [status, orders.filter((order) => order.status === status).length]),
    )
    return {
      data: {
        queue: dependencies.bus.metrics(),
        deadLetters: dependencies.bus.deadLetters(),
        recentEvents: dependencies.bus.recent(40),
        orders: statusCounts,
      },
    }
  })

  app.post('/api/v1/ops/dlq/:id/redrive', async (request, reply) => {
    if (options.demoMode === false || !dependencies.redrive) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } })
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params)
    const body = z.object({ paymentToken: z.enum(paymentTokens).optional() }).safeParse(request.body ?? {})
    if (!params.success) return validationError(reply, params.error)
    if (!body.success) return validationError(reply, body.error)
    const event = dependencies.redrive(params.data.id, body.data.paymentToken)
    if (!event) return reply.code(404).send({ error: { code: 'not_found', message: 'Dead-letter message not found' } })
    await dependencies.drain?.()
    return reply.code(202).send({ data: { redriven: true, event } })
  })

  app.get('/metrics', async (_request, reply) => {
    const metrics = dependencies.bus.metrics()
    const text = [
      '# HELP orderflow_queue_messages Durable event messages by status.',
      '# TYPE orderflow_queue_messages gauge',
      ...Object.entries(metrics).map(([status, value]) => `orderflow_queue_messages{status="${status}"} ${value}`),
    ].join('\n')
    return reply.type('text/plain; version=0.0.4').send(`${text}\n`)
  })

  if (options.staticRoot && existsSync(options.staticRoot)) {
    void app.register(fastifyStatic, { root: resolve(options.staticRoot), wildcard: false })
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) return reply.sendFile('index.html')
      return reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } })
    })
  }
  return app
}

function validationError(reply: { code(statusCode: number): { send(payload: unknown): unknown } }, error: z.ZodError) {
  return reply.code(422).send({
    error: {
      code: 'validation_error',
      message: 'Request validation failed',
      details: error.issues.map((issue) => ({ field: issue.path.join('.') || 'idempotency-key', message: issue.message })),
    },
  })
}
