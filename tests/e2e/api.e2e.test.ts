import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntime, type TestRuntime } from '../support/test-runtime.js'
import { buildGateway } from '@/gateway/app.js'

describe('HTTP API', () => {
  let runtime: TestRuntime | undefined

  afterEach(async () => {
    await runtime?.app.close()
    runtime?.close()
    rmSync(resolve('work/static-fixture'), { recursive: true, force: true })
  })

  it('validates order input and requires an idempotency key', async () => {
    runtime = createTestRuntime()
    runtime.app = buildGateway(runtime.dependencies)
    const response = await runtime.app.inject({ method: 'POST', url: '/api/v1/orders', payload: { quantity: 0 } })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: { code: 'validation_error' } })

    const missingKey = await runtime.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: { customerId: 'cust-api', sku: 'SKU-RED', quantity: 1, paymentToken: 'tok_success' },
    })
    expect(missingKey.statusCode).toBe(422)
  })

  it('creates and retrieves an eventually confirmed order', async () => {
    runtime = createTestRuntime()
    runtime.app = buildGateway(runtime.dependencies)
    const createResponse = await runtime.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { 'idempotency-key': 'api-happy' },
      payload: { customerId: 'cust-api', sku: 'SKU-RED', quantity: 1, paymentToken: 'tok_success' },
    })
    expect(createResponse.statusCode).toBe(202)
    await runtime.drain()

    const orderId = createResponse.json().data.id as string
    const getResponse = await runtime.app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}` })
    expect(getResponse.statusCode).toBe(200)
    expect(getResponse.json()).toMatchObject({ data: { id: orderId, status: 'CONFIRMED' } })
  })

  it('returns the same order for an identical replay and 409 for a mismatched replay', async () => {
    runtime = createTestRuntime()
    runtime.app = buildGateway(runtime.dependencies)
    const request = {
      method: 'POST' as const,
      url: '/api/v1/orders',
      headers: { 'idempotency-key': 'api-replay' },
      payload: { customerId: 'cust-api', sku: 'SKU-RED', quantity: 1, paymentToken: 'tok_success' },
    }
    const first = await runtime.app.inject(request)
    const second = await runtime.app.inject(request)
    const conflict = await runtime.app.inject({ ...request, payload: { ...request.payload, quantity: 2 } })

    expect(second.json().data.id).toBe(first.json().data.id)
    expect(second.headers['idempotent-replay']).toBe('true')
    expect(conflict.statusCode).toBe(409)
  })

  it('exposes operational queue and DLQ metrics', async () => {
    runtime = createTestRuntime({ maxAttempts: 1 })
    runtime.app = buildGateway(runtime.dependencies)
    await runtime.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { 'idempotency-key': 'api-dlq' },
      payload: { customerId: 'cust-api', sku: 'SKU-RED', quantity: 1, paymentToken: 'tok_always_error' },
    })
    await runtime.drain({ advanceTime: true })

    const response = await runtime.app.inject({ method: 'GET', url: '/api/v1/ops' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ data: { queue: { dead: 1 } } })
  })

  it('serves health, inventory, order collection, and Prometheus metrics', async () => {
    runtime = createTestRuntime()
    runtime.app = buildGateway(runtime.dependencies)

    const [live, ready, products, orders, metrics] = await Promise.all([
      runtime.app.inject({ method: 'GET', url: '/health/live' }),
      runtime.app.inject({ method: 'GET', url: '/health/ready' }),
      runtime.app.inject({ method: 'GET', url: '/api/v1/products' }),
      runtime.app.inject({ method: 'GET', url: '/api/v1/orders?limit=invalid' }),
      runtime.app.inject({ method: 'GET', url: '/metrics' }),
    ])

    expect(live.json()).toMatchObject({ data: { status: 'ok' } })
    expect(ready.json()).toMatchObject({ data: { status: 'ready' } })
    expect(products.json().data).toHaveLength(3)
    expect(orders.json().data).toEqual([])
    expect(metrics.headers['content-type']).toContain('text/plain')
    expect(metrics.body).toContain('orderflow_queue_messages')
  })

  it('returns validation and not-found errors for invalid order identifiers', async () => {
    runtime = createTestRuntime()
    runtime.app = buildGateway(runtime.dependencies)

    const invalid = await runtime.app.inject({ method: 'GET', url: '/api/v1/orders/not-a-uuid' })
    const missing = await runtime.app.inject({ method: 'GET', url: '/api/v1/orders/00000000-0000-4000-8000-000000000000' })

    expect(invalid.statusCode).toBe(422)
    expect(missing.statusCode).toBe(404)
  })

  it('hides operations routes when demo mode is disabled', async () => {
    runtime = createTestRuntime()
    runtime.app = buildGateway(runtime.dependencies, { demoMode: false })

    const snapshot = await runtime.app.inject({ method: 'GET', url: '/api/v1/ops' })
    const redrive = await runtime.app.inject({ method: 'POST', url: '/api/v1/ops/dlq/00000000-0000-4000-8000-000000000000/redrive' })

    expect(snapshot.statusCode).toBe(404)
    expect(redrive.statusCode).toBe(404)
  })

  it('validates, locates, and redrives a DLQ message through the operations API', async () => {
    runtime = createTestRuntime({ maxAttempts: 1 })
    runtime.app = buildGateway(runtime.dependencies)
    const create = await runtime.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { 'idempotency-key': 'api-redrive' },
      payload: { customerId: 'cust-api', sku: 'SKU-RED', quantity: 1, paymentToken: 'tok_always_error' },
    })
    await runtime.drain({ advanceTime: true })
    const deadLetterId = runtime.bus.deadLetters()[0]?.id

    const invalid = await runtime.app.inject({ method: 'POST', url: '/api/v1/ops/dlq/not-a-uuid/redrive', payload: {} })
    const invalidBody = await runtime.app.inject({
      method: 'POST',
      url: `/api/v1/ops/dlq/${deadLetterId}/redrive`,
      payload: { paymentToken: 'not-a-scenario' },
    })
    const missing = await runtime.app.inject({ method: 'POST', url: '/api/v1/ops/dlq/00000000-0000-4000-8000-000000000000/redrive', payload: {} })
    const redriven = await runtime.app.inject({
      method: 'POST',
      url: `/api/v1/ops/dlq/${deadLetterId}/redrive`,
      payload: { paymentToken: 'tok_success' },
    })

    expect(invalid.statusCode).toBe(422)
    expect(invalidBody.statusCode).toBe(422)
    expect(missing.statusCode).toBe(404)
    expect(redriven.statusCode).toBe(202)
    expect(runtime.orders.get(create.json().data.id)?.status).toBe('CONFIRMED')
  })

  it('returns a generic error when order persistence unexpectedly fails', async () => {
    runtime = createTestRuntime()
    vi.spyOn(runtime.orders, 'createWithReplay').mockImplementation(() => {
      throw new Error('private database detail')
    })
    runtime.app = buildGateway(runtime.dependencies)

    const response = await runtime.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { 'idempotency-key': 'api-internal-error' },
      payload: { customerId: 'cust-api', sku: 'SKU-RED', quantity: 1, paymentToken: 'tok_success' },
    })

    expect(response.statusCode).toBe(500)
    expect(response.body).not.toContain('private database detail')
    expect(response.json()).toMatchObject({ error: { code: 'internal_error' } })
  })

  it('serves the built dashboard and keeps unknown API routes JSON-only', async () => {
    const staticRoot = resolve('work/static-fixture')
    mkdirSync(staticRoot, { recursive: true })
    writeFileSync(resolve(staticRoot, 'index.html'), '<!doctype html><title>OrderFlow fixture</title>')
    runtime = createTestRuntime()
    runtime.app = buildGateway(runtime.dependencies, { staticRoot })

    const page = await runtime.app.inject({ method: 'GET', url: '/dashboard' })
    const missingApi = await runtime.app.inject({ method: 'POST', url: '/api/v1/not-real' })

    expect(page.statusCode).toBe(200)
    expect(page.body).toContain('OrderFlow fixture')
    expect(missingApi.statusCode).toBe(404)
    expect(missingApi.json()).toMatchObject({ error: { code: 'not_found' } })
  })
})
