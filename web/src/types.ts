export const paymentScenarios = ['tok_success', 'tok_retry_twice', 'tok_decline', 'tok_always_error'] as const

export type PaymentScenario = (typeof paymentScenarios)[number]

export type OrderStatus =
  | 'PENDING'
  | 'INVENTORY_RESERVED'
  | 'PAYMENT_PROCESSING'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'FAILED'
  | string

export interface Product {
  sku: string
  name: string
  description?: string
  price?: number
  unitPrice?: number
  available: number
  reserved: number
}

export interface OrderEvent {
  id?: string
  type: string
  occurredAt?: string
  createdAt?: string
  attempt?: number
  note?: string
}

export interface OrderHistoryEntry {
  id?: number | string
  status: string
  note?: string
  createdAt?: string
}

export interface Order {
  id: string
  customerId: string
  sku: string
  quantity: number
  paymentToken?: PaymentScenario | string
  status: OrderStatus
  createdAt?: string
  updatedAt?: string
  events?: OrderEvent[]
  history?: OrderHistoryEntry[]
  paymentAttempts?: number
}

export interface DeadLetter {
  id?: string
  topic: string
  attempts: number
  error?: string
  lastError?: string
  failedAt?: string
  createdAt?: string
  orderId?: string
  event?: { aggregateId?: string; type?: string }
}

export interface QueueMetrics {
  ready: number
  processing: number
  retried: number
  dead: number
}

export interface OpsSnapshot {
  queue: QueueMetrics
  deadLetters: DeadLetter[]
}

export interface CreateOrderInput {
  customerId: string
  sku: string
  quantity: number
  paymentToken: PaymentScenario
}

export type LoadState = 'idle' | 'loading' | 'ready' | 'error'
