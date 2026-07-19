import { describe, expect, it } from 'vitest'
import { canTransition, transitionOrder } from '@/services/orders/state-machine.js'

describe('order state machine', () => {
  it.each([
    ['PENDING', 'INVENTORY_RESERVED'],
    ['PENDING', 'REJECTED'],
    ['INVENTORY_RESERVED', 'PAYMENT_PROCESSING'],
    ['PAYMENT_PROCESSING', 'CONFIRMED'],
    ['PAYMENT_PROCESSING', 'COMPENSATING'],
    ['COMPENSATING', 'FAILED'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true)
  })

  it('rejects transitions from a terminal state', () => {
    expect(() => transitionOrder('CONFIRMED', 'FAILED')).toThrow(/invalid order transition/i)
  })

  it('returns a new immutable state value', () => {
    expect(transitionOrder('PENDING', 'INVENTORY_RESERVED')).toBe('INVENTORY_RESERVED')
  })
})
