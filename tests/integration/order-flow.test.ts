import { afterEach, describe, expect, it } from 'vitest'
import { createTestRuntime, type TestRuntime } from '../support/test-runtime.js'

describe('event-driven order workflow', () => {
  let runtime: TestRuntime | undefined

  afterEach(() => runtime?.close())

  it('confirms an order through inventory and payment events', async () => {
    runtime = createTestRuntime()
    const order = runtime.orders.create(
      { customerId: 'cust-1', sku: 'SKU-RED', quantity: 2, paymentToken: 'tok_success' },
      'idem-happy',
    )

    await runtime.drain()

    expect(runtime.orders.get(order.id)?.status).toBe('CONFIRMED')
    expect(runtime.inventory.getProduct('SKU-RED')?.available).toBe(8)
    expect(runtime.payments.getByOrderId(order.id)?.status).toBe('APPROVED')
  })

  it('replays the same request without duplicate side effects', async () => {
    runtime = createTestRuntime()
    const input = { customerId: 'cust-1', sku: 'SKU-RED', quantity: 1, paymentToken: 'tok_success' as const }
    const first = runtime.orders.create(input, 'idem-replay')
    const replay = runtime.orders.create({ ...input }, 'idem-replay')
    await runtime.drain()

    expect(replay.id).toBe(first.id)
    expect(runtime.orders.list()).toHaveLength(1)
    expect(runtime.inventory.listReservations(first.id)).toHaveLength(1)
    expect(runtime.payments.listForOrder(first.id)).toHaveLength(1)
  })

  it('rejects an idempotency key reused with a different payload', () => {
    runtime = createTestRuntime()
    const input = { customerId: 'cust-1', sku: 'SKU-RED', quantity: 1, paymentToken: 'tok_success' as const }
    runtime.orders.create(input, 'idem-conflict')

    expect(() => runtime?.orders.create({ ...input, quantity: 2 }, 'idem-conflict')).toThrow(/idempotency key/i)
  })

  it('rejects out-of-stock orders without charging', async () => {
    runtime = createTestRuntime()
    const order = runtime.orders.create(
      { customerId: 'cust-1', sku: 'SKU-BLUE', quantity: 2, paymentToken: 'tok_success' },
      'idem-oos',
    )
    await runtime.drain()

    expect(runtime.orders.get(order.id)?.status).toBe('REJECTED')
    expect(runtime.payments.getByOrderId(order.id)).toBeUndefined()
  })

  it('retries transient payment failures and eventually confirms', async () => {
    runtime = createTestRuntime()
    const order = runtime.orders.create(
      { customerId: 'cust-1', sku: 'SKU-RED', quantity: 1, paymentToken: 'tok_retry_twice' },
      'idem-retry',
    )
    await runtime.drain({ advanceTime: true })

    expect(runtime.orders.get(order.id)?.status).toBe('CONFIRMED')
    expect(runtime.payments.getAttemptCount(order.id)).toBe(3)
    expect(runtime.bus.metrics().retried).toBe(2)
  })

  it('compensates inventory exactly once after a payment decline', async () => {
    runtime = createTestRuntime()
    const order = runtime.orders.create(
      { customerId: 'cust-1', sku: 'SKU-RED', quantity: 3, paymentToken: 'tok_decline' },
      'idem-decline',
    )
    await runtime.drain()

    expect(runtime.orders.get(order.id)?.status).toBe('FAILED')
    expect(runtime.inventory.getProduct('SKU-RED')?.available).toBe(10)
    expect(runtime.inventory.listReservations(order.id)[0]?.status).toBe('RELEASED')
  })

  it('moves poison payment work to the DLQ after bounded retries', async () => {
    runtime = createTestRuntime({ maxAttempts: 3 })
    const order = runtime.orders.create(
      { customerId: 'cust-1', sku: 'SKU-RED', quantity: 1, paymentToken: 'tok_always_error' },
      'idem-poison',
    )
    await runtime.drain({ advanceTime: true })

    const deadLetters = runtime.bus.deadLetters()
    expect(deadLetters).toHaveLength(1)
    expect(deadLetters[0]).toMatchObject({ topic: 'payment.process.requested', attempts: 3 })
    expect(runtime.orders.get(order.id)?.status).toBe('PAYMENT_PROCESSING')
  })

  it('never oversells the final unit when orders compete for stock', async () => {
    runtime = createTestRuntime()
    const first = runtime.orders.create(
      { customerId: 'cust-a', sku: 'SKU-BLUE', quantity: 1, paymentToken: 'tok_success' },
      'idem-final-a',
    )
    const second = runtime.orders.create(
      { customerId: 'cust-b', sku: 'SKU-BLUE', quantity: 1, paymentToken: 'tok_success' },
      'idem-final-b',
    )
    await runtime.drain()

    expect([runtime.orders.get(first.id)?.status, runtime.orders.get(second.id)?.status].sort()).toEqual(['CONFIRMED', 'REJECTED'])
    expect(runtime.inventory.getProduct('SKU-BLUE')).toMatchObject({ onHand: 1, reserved: 1, available: 0 })
  })

  it('redrives a reviewed payment dead letter without duplicating the reservation', async () => {
    runtime = createTestRuntime({ maxAttempts: 2 })
    const order = runtime.orders.create(
      { customerId: 'cust-ops', sku: 'SKU-RED', quantity: 2, paymentToken: 'tok_always_error' },
      'idem-redrive',
    )
    await runtime.drain({ advanceTime: true })
    const deadLetter = runtime.bus.deadLetters()[0]
    expect(deadLetter).toBeDefined()

    runtime.dependencies.redrive?.(deadLetter?.id ?? '', 'tok_success')
    await runtime.drain({ advanceTime: true })

    expect(runtime.orders.get(order.id)?.status).toBe('CONFIRMED')
    expect(runtime.inventory.listReservations(order.id)).toHaveLength(1)
    expect(runtime.payments.listForOrder(order.id)).toHaveLength(1)
    expect(runtime.bus.metrics().dead).toBe(0)
  })
})
