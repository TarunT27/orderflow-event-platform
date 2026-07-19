import { afterEach, describe, expect, it } from 'vitest'
import { createEvent } from '@/shared/contracts.js'
import { openDatabase } from '@/shared/database.js'
import { InventoryService } from '@/services/inventory/service.js'
import { PaymentService } from '@/services/payments/service.js'

describe('consumer event validation', () => {
  const closeables: Array<{ close(): void }> = []

  afterEach(() => {
    for (const service of closeables.splice(0)) service.close()
  })

  it('rejects an unsupported payment scenario instead of approving it', () => {
    const payments = new PaymentService(openDatabase(':memory:'))
    closeables.push(payments)
    const event = createEvent({
      topic: 'payment.process.requested',
      source: 'orders',
      aggregateId: '00000000-0000-4000-8000-000000000001',
      correlationId: '00000000-0000-4000-8000-000000000001',
      data: {
        orderId: '00000000-0000-4000-8000-000000000001',
        amount: 4900,
        currency: 'USD',
        paymentToken: 'unexpected-provider-mode',
      },
    })

    expect(() => payments.handleEvent(event)).toThrow()
    expect(payments.getByOrderId(event.aggregateId)).toBeUndefined()
  })

  it('does not count duplicate delivery after a payment has committed', () => {
    const payments = new PaymentService(openDatabase(':memory:'))
    closeables.push(payments)
    const event = createEvent({
      topic: 'payment.process.requested',
      source: 'orders',
      aggregateId: '00000000-0000-4000-8000-000000000003',
      correlationId: '00000000-0000-4000-8000-000000000003',
      data: {
        orderId: '00000000-0000-4000-8000-000000000003',
        amount: 4900,
        currency: 'USD',
        paymentToken: 'tok_success',
      },
    })

    payments.handleEvent(event)
    payments.handleEvent(event)

    expect(payments.getAttemptCount(event.aggregateId)).toBe(1)
    expect(payments.listForOrder(event.aggregateId)).toHaveLength(1)
  })

  it('rejects malformed reservation quantities before changing stock', () => {
    const inventory = new InventoryService(openDatabase(':memory:'))
    closeables.push(inventory)
    const event = createEvent({
      topic: 'inventory.reserve.requested',
      source: 'orders',
      aggregateId: '00000000-0000-4000-8000-000000000002',
      correlationId: '00000000-0000-4000-8000-000000000002',
      data: {
        orderId: '00000000-0000-4000-8000-000000000002',
        sku: 'SKU-RED',
        quantity: -1,
      },
    })

    expect(() => inventory.handleEvent(event)).toThrow()
    expect(inventory.getProduct('SKU-RED')).toMatchObject({ available: 10, reserved: 0 })
  })
})
