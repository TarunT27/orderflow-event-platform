import { randomUUID } from 'node:crypto'
import { z } from 'zod'

export const paymentTokens = ['tok_success', 'tok_retry_twice', 'tok_decline', 'tok_always_error'] as const
export type PaymentToken = (typeof paymentTokens)[number]

export const products = [
  { sku: 'SKU-RED', name: 'Signal Lamp', description: 'A warm desk light for focused work.', unitPrice: 4900, initialStock: 10, accent: '#ff8a5b' },
  { sku: 'SKU-BLUE', name: 'Relay Speaker', description: 'Compact spatial audio for small rooms.', unitPrice: 7900, initialStock: 1, accent: '#55c2ff' },
  { sku: 'SKU-GREEN', name: 'Circuit Keyboard', description: 'Low-profile mechanical keyboard.', unitPrice: 12900, initialStock: 5, accent: '#67e8a5' },
] as const

export const skuSchema = z.enum(products.map((product) => product.sku) as [string, ...string[]])

export const createOrderSchema = z.object({
  customerId: z.string().trim().min(1).max(100),
  sku: skuSchema,
  quantity: z.number().int().min(1).max(20),
  paymentToken: z.enum(paymentTokens),
})

export type CreateOrderInput = z.infer<typeof createOrderSchema>

export const eventTopics = [
  'inventory.reserve.requested',
  'inventory.reserved',
  'inventory.rejected',
  'payment.process.requested',
  'payment.completed',
  'payment.failed',
  'inventory.release.requested',
  'inventory.released',
] as const

export type EventTopic = (typeof eventTopics)[number]

export interface EventEnvelope<TData extends Record<string, unknown> = Record<string, unknown>> {
  readonly specVersion: '1.0'
  readonly id: string
  readonly topic: EventTopic
  readonly source: 'orders' | 'inventory' | 'payments' | 'operations'
  readonly aggregateId: string
  readonly correlationId: string
  readonly causationId?: string
  readonly occurredAt: string
  readonly version: 1
  readonly data: TData
}

export function createEvent<TData extends Record<string, unknown>>(input: {
  topic: EventTopic
  source: EventEnvelope['source']
  aggregateId: string
  correlationId: string
  causationId?: string
  data: TData
  id?: string
  occurredAt?: string
}): EventEnvelope<TData> {
  return {
    specVersion: '1.0',
    id: input.id ?? randomUUID(),
    topic: input.topic,
    source: input.source,
    aggregateId: input.aggregateId,
    correlationId: input.correlationId,
    ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    version: 1,
    data: structuredClone(input.data),
  }
}

export function getProductDefinition(sku: string) {
  return products.find((product) => product.sku === sku)
}
