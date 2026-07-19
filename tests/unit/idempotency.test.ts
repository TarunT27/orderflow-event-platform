import { describe, expect, it } from 'vitest'
import { fingerprintOrder } from '@/services/orders/idempotency.js'

describe('order request fingerprinting', () => {
  it('is stable when object key order differs', () => {
    const first = { customerId: 'cust-1', sku: 'SKU-RED', quantity: 2, paymentToken: 'tok_success' }
    const second = { paymentToken: 'tok_success', quantity: 2, sku: 'SKU-RED', customerId: 'cust-1' }

    expect(fingerprintOrder(first)).toBe(fingerprintOrder(second))
  })

  it('changes when a business field changes', () => {
    const base = { customerId: 'cust-1', sku: 'SKU-RED', quantity: 1, paymentToken: 'tok_success' }
    expect(fingerprintOrder(base)).not.toBe(fingerprintOrder({ ...base, quantity: 2 }))
  })
})
