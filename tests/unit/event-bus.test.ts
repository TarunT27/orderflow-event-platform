import { afterEach, describe, expect, it } from 'vitest'
import { createEvent } from '@/shared/contracts.js'
import { openDatabase } from '@/shared/database.js'
import { DurableEventBus } from '@/shared/messaging.js'

describe('durable event bus', () => {
  let bus: DurableEventBus | undefined

  afterEach(() => bus?.close())

  it('deduplicates publication by stable event ID', () => {
    bus = new DurableEventBus(openDatabase(':memory:'))
    const event = createEvent({
      topic: 'inventory.reserve.requested',
      source: 'orders',
      aggregateId: 'order-1',
      correlationId: 'order-1',
      data: { orderId: 'order-1', sku: 'SKU-RED', quantity: 1 },
    })

    expect(bus.publish(event, 10)).toBe(true)
    expect(bus.publish(event, 10)).toBe(false)
    expect(bus.metrics().queued).toBe(1)
  })

  it('leases, retries, and dead-letters failed work at the attempt limit', () => {
    bus = new DurableEventBus(openDatabase(':memory:'), { maxAttempts: 2, baseDelayMs: 10 })
    const event = createEvent({
      topic: 'payment.process.requested',
      source: 'orders',
      aggregateId: 'order-2',
      correlationId: 'order-2',
      data: { orderId: 'order-2' },
    })
    bus.publish(event, 100)

    const first = bus.claim(event.topic, 100)
    expect(first?.attempts).toBe(1)
    if (first) bus.fail(first, new Error('timeout'), 100)
    expect(bus.nextAvailableAt()).toBe(110)

    const second = bus.claim(event.topic, 110)
    if (second) bus.fail(second, new Error('still unavailable'), 110)

    expect(bus.metrics()).toMatchObject({ dead: 1, retried: 1 })
    expect(bus.deadLetters()[0]?.lastError).toBe('still unavailable')
  })

  it('returns expired leases to the queue for another worker', () => {
    bus = new DurableEventBus(openDatabase(':memory:'))
    const event = createEvent({
      topic: 'inventory.reserve.requested',
      source: 'orders',
      aggregateId: 'order-3',
      correlationId: 'order-3',
      data: { orderId: 'order-3' },
    })
    bus.publish(event, 50)
    expect(bus.claim(event.topic, 50, 5)?.attempts).toBe(1)
    expect(bus.claim(event.topic, 56, 5)?.attempts).toBe(2)
  })
})
