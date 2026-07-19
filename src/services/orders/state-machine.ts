export const orderStatuses = [
  'PENDING',
  'INVENTORY_RESERVED',
  'PAYMENT_PROCESSING',
  'COMPENSATING',
  'CONFIRMED',
  'REJECTED',
  'FAILED',
] as const

export type OrderStatus = (typeof orderStatuses)[number]

const transitions: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING: ['INVENTORY_RESERVED', 'REJECTED'],
  INVENTORY_RESERVED: ['PAYMENT_PROCESSING'],
  PAYMENT_PROCESSING: ['CONFIRMED', 'COMPENSATING'],
  COMPENSATING: ['FAILED'],
  CONFIRMED: [],
  REJECTED: [],
  FAILED: [],
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return transitions[from].includes(to)
}

export function transitionOrder(from: OrderStatus, to: OrderStatus): OrderStatus {
  if (!canTransition(from, to)) throw new Error(`Invalid order transition: ${from} -> ${to}`)
  return to
}
