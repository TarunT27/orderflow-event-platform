import { randomUUID } from 'node:crypto'
import type { Database } from '../../shared/database.js'
import { inTransaction } from '../../shared/database.js'
import type { CreateOrderInput, EventEnvelope } from '../../shared/contracts.js'
import { createEvent, getProductDefinition } from '../../shared/contracts.js'
import { addOutbox, claimInbox, initializeMessageStore } from '../../shared/messaging.js'
import { fingerprintOrder } from './idempotency.js'
import { transitionOrder, type OrderStatus } from './state-machine.js'

export interface OrderHistoryEntry {
  readonly id: number
  readonly status: OrderStatus
  readonly note: string
  readonly createdAt: string
}

export interface Order {
  readonly id: string
  readonly customerId: string
  readonly sku: string
  readonly quantity: number
  readonly unitPrice: number
  readonly total: number
  readonly currency: 'USD'
  readonly paymentToken: CreateOrderInput['paymentToken']
  readonly status: OrderStatus
  readonly createdAt: string
  readonly updatedAt: string
  readonly history: readonly OrderHistoryEntry[]
}

interface OrderRow {
  id: string
  customer_id: string
  sku: string
  quantity: number | bigint
  unit_price: number | bigint
  total: number | bigint
  payment_token: CreateOrderInput['paymentToken']
  status: OrderStatus
  created_at: string
  updated_at: string
}

export class IdempotencyConflictError extends Error {
  override readonly name = 'IdempotencyConflictError'
}

export class OrderService {
  constructor(private readonly database: Database) {
    initializeMessageStore(database)
    database.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        sku TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        unit_price INTEGER NOT NULL CHECK(unit_price >= 0),
        total INTEGER NOT NULL CHECK(total >= 0),
        payment_token TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        order_id TEXT NOT NULL REFERENCES orders(id),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS order_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL REFERENCES orders(id),
        status TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `)
  }

  create(input: CreateOrderInput, idempotencyKey: string): Order {
    return this.createWithReplay(input, idempotencyKey).order
  }

  createWithReplay(input: CreateOrderInput, idempotencyKey: string): { order: Order; replayed: boolean } {
    if (!/^\S.{0,126}\S$|^[^\s]$/.test(idempotencyKey)) throw new Error('Idempotency key must contain 1-128 printable non-whitespace characters')
    const fingerprint = fingerprintOrder(input)
    const existing = this.database.prepare(`SELECT fingerprint, order_id FROM idempotency_keys WHERE key = ?`).get(idempotencyKey) as { fingerprint: string; order_id: string } | undefined
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new IdempotencyConflictError('Idempotency key was already used with a different order payload')
      const order = this.get(existing.order_id)
      if (!order) throw new Error('Idempotency record references a missing order')
      return { order, replayed: true }
    }

    const product = getProductDefinition(input.sku)
    if (!product) throw new Error('Unknown product')
    const orderId = randomUUID()
    const now = new Date().toISOString()
    inTransaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO orders(id, customer_id, sku, quantity, unit_price, total, payment_token, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
      `).run(orderId, input.customerId, input.sku, input.quantity, product.unitPrice, product.unitPrice * input.quantity, input.paymentToken, now, now)
      this.database.prepare(`INSERT INTO idempotency_keys(key, fingerprint, order_id, created_at) VALUES (?, ?, ?, ?)`).run(idempotencyKey, fingerprint, orderId, now)
      this.appendHistory(orderId, 'PENDING', 'Order accepted; inventory reservation queued.', now)
      addOutbox(this.database, createEvent({
        topic: 'inventory.reserve.requested',
        source: 'orders',
        aggregateId: orderId,
        correlationId: orderId,
        occurredAt: now,
        data: { orderId, sku: input.sku, quantity: input.quantity },
      }))
    })
    const order = this.get(orderId)
    if (!order) throw new Error('Order creation failed')
    return { order, replayed: false }
  }

  get(orderId: string): Order | undefined {
    const row = this.database.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as unknown as OrderRow | undefined
    return row ? this.toOrder(row) : undefined
  }

  list(limit = 50): readonly Order[] {
    const rows = this.database.prepare(`SELECT * FROM orders ORDER BY created_at DESC LIMIT ?`).all(Math.max(1, Math.min(100, limit))) as unknown as OrderRow[]
    return rows.map((row) => this.toOrder(row))
  }

  handleEvent(event: EventEnvelope): void {
    inTransaction(this.database, () => {
      if (!claimInbox(this.database, 'orders-saga', event.id)) return
      const row = this.database.prepare(`SELECT * FROM orders WHERE id = ?`).get(event.aggregateId) as unknown as OrderRow | undefined
      if (!row) throw new Error(`Order ${event.aggregateId} not found`)
      if (event.topic === 'inventory.reserved') this.onInventoryReserved(row, event)
      if (event.topic === 'inventory.rejected') this.updateStatus(row, 'REJECTED', 'Inventory rejected the reservation.')
      if (event.topic === 'payment.completed') this.updateStatus(row, 'CONFIRMED', 'Payment approved; order confirmed.')
      if (event.topic === 'payment.failed') this.onPaymentFailed(row, event)
      if (event.topic === 'inventory.released') this.updateStatus(row, 'FAILED', 'Reservation released after payment failure.')
    })
  }

  close(): void {
    this.database.close()
  }

  private onInventoryReserved(row: OrderRow, event: EventEnvelope): void {
    if (row.status !== 'PENDING') return
    const reserved = this.updateStatus(row, 'INVENTORY_RESERVED', 'Inventory reserved successfully.')
    const processing = this.updateStatus({ ...row, status: reserved }, 'PAYMENT_PROCESSING', 'Payment processing queued.')
    addOutbox(this.database, createEvent({
      topic: 'payment.process.requested',
      source: 'orders',
      aggregateId: row.id,
      correlationId: event.correlationId,
      causationId: event.id,
      data: {
        orderId: row.id,
        amount: Number(row.total),
        currency: 'USD',
        paymentToken: row.payment_token,
        state: processing,
      },
    }))
  }

  private onPaymentFailed(row: OrderRow, event: EventEnvelope): void {
    if (row.status !== 'PAYMENT_PROCESSING') return
    this.updateStatus(row, 'COMPENSATING', 'Payment declined; releasing reserved inventory.')
    addOutbox(this.database, createEvent({
      topic: 'inventory.release.requested',
      source: 'orders',
      aggregateId: row.id,
      correlationId: event.correlationId,
      causationId: event.id,
      data: { orderId: row.id, reason: 'PAYMENT_DECLINED' },
    }))
  }

  private updateStatus(row: OrderRow, target: OrderStatus, note: string): OrderStatus {
    if (row.status === target) return target
    const next = transitionOrder(row.status, target)
    const now = new Date().toISOString()
    this.database.prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`).run(next, now, row.id)
    this.appendHistory(row.id, next, note, now)
    return next
  }

  private appendHistory(orderId: string, status: OrderStatus, note: string, now: string): void {
    this.database.prepare(`INSERT INTO order_history(order_id, status, note, created_at) VALUES (?, ?, ?, ?)`).run(orderId, status, note, now)
  }

  private toOrder(row: OrderRow): Order {
    const history = this.database.prepare(`SELECT id, status, note, created_at FROM order_history WHERE order_id = ? ORDER BY id`).all(row.id) as Array<{ id: number | bigint; status: OrderStatus; note: string; created_at: string }>
    return {
      id: row.id,
      customerId: row.customer_id,
      sku: row.sku,
      quantity: Number(row.quantity),
      unitPrice: Number(row.unit_price),
      total: Number(row.total),
      currency: 'USD',
      paymentToken: row.payment_token,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      history: history.map((entry) => ({ id: Number(entry.id), status: entry.status, note: entry.note, createdAt: entry.created_at })),
    }
  }
}
