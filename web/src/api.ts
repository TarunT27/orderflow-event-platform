import type { CreateOrderInput, DeadLetter, OpsSnapshot, Order, OrderEvent, Product, QueueMetrics } from './types.js'

interface ApiEnvelope<T> {
  success?: boolean
  data?: T
  error?: { message?: string } | string
}

const apiRoot = '/api/v1'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiRoot}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  const payload = (await response.json().catch(() => undefined)) as ApiEnvelope<T> | T | undefined
  if (!response.ok) {
    const envelope = payload as ApiEnvelope<T> | undefined
    const message = typeof envelope?.error === 'string' ? envelope.error : envelope?.error?.message
    throw new Error(message ?? `Request failed with status ${response.status}`)
  }

  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as ApiEnvelope<T>).data as T
  }

  return payload as T
}

function asList<T>(value: T[] | { items?: T[]; orders?: T[]; products?: T[] } | undefined): T[] {
  if (Array.isArray(value)) return value
  if (!value) return []
  return value.items ?? value.orders ?? value.products ?? []
}

function normalizeOrder(order: Order): Order {
  if (order.events) return { ...order, events: [...order.events] }
  if (!order.history) return { ...order }

  const historyEvents: OrderEvent[] = order.history.map((entry) => {
    const typeByStatus: Record<string, string> = {
      PENDING: 'order.created',
      INVENTORY_RESERVED: 'inventory.reserved',
      PAYMENT_PROCESSING: 'payment.processing',
      CONFIRMED: 'order.confirmed',
      REJECTED: 'order.rejected',
      FAILED: 'order.failed',
    }
    return {
      ...(entry.id === undefined ? {} : { id: String(entry.id) }),
      ...(entry.createdAt === undefined ? {} : { occurredAt: entry.createdAt }),
      ...(entry.note === undefined ? {} : { note: entry.note }),
      type: typeByStatus[entry.status] ?? `order.${entry.status.toLowerCase()}`,
    }
  })
  return { ...order, events: historyEvents }
}

export async function getProducts(): Promise<Product[]> {
  const data = await request<Product[] | { items?: Product[]; products?: Product[] }>('/products')
  return asList(data).map((product) => {
    const price = product.price ?? product.unitPrice
    return {
      ...product,
      ...(price === undefined ? {} : { price }),
      name: product.name || product.sku,
      available: Number(product.available ?? 0),
      reserved: Number(product.reserved ?? 0),
    }
  })
}

export async function getOrders(): Promise<Order[]> {
  const data = await request<Order[] | { items?: Order[]; orders?: Order[] }>('/orders')
  return asList(data).map(normalizeOrder)
}

export async function getOrder(orderId: string): Promise<Order> {
  return normalizeOrder(await request<Order>(`/orders/${encodeURIComponent(orderId)}`))
}

export async function createOrder(input: CreateOrderInput, idempotencyKey: string): Promise<Order> {
  const order = await request<Order>('/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  })
  return normalizeOrder(order)
}

function normalizeQueue(value: Partial<QueueMetrics> | undefined): QueueMetrics {
  const queueWithAlias = value as (Partial<QueueMetrics> & { queued?: number }) | undefined
  return {
    ready: Number(value?.ready ?? queueWithAlias?.queued ?? 0),
    processing: Number(value?.processing ?? 0),
    retried: Number(value?.retried ?? 0),
    dead: Number(value?.dead ?? 0),
  }
}

export async function getOps(): Promise<OpsSnapshot> {
  const data = await request<
    Partial<OpsSnapshot> & { dlq?: DeadLetter[]; deadLetters?: DeadLetter[]; queue?: Partial<QueueMetrics> }
  >('/ops')
  return {
    queue: normalizeQueue(data.queue),
    deadLetters: (data.deadLetters ?? data.dlq ?? []).map((item) => {
      const error = item.error ?? item.lastError
      const orderId = item.orderId ?? item.event?.aggregateId
      return {
        ...item,
        ...(error === undefined ? {} : { error }),
        ...(orderId === undefined ? {} : { orderId }),
      }
    }),
  }
}
