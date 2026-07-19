import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Database } from '../../shared/database.js'
import { inTransaction } from '../../shared/database.js'
import { createEvent, paymentTokenSchema, type EventEnvelope } from '../../shared/contracts.js'
import { addOutbox, claimInbox, initializeMessageStore } from '../../shared/messaging.js'
import { RetryableError } from '../../shared/retry.js'

export interface Payment {
  readonly id: string
  readonly orderId: string
  readonly amount: number
  readonly currency: 'USD'
  readonly status: 'APPROVED' | 'DECLINED'
  readonly createdAt: string
}

interface PaymentRow {
  id: string
  order_id: string
  amount: number | bigint
  currency: 'USD'
  status: Payment['status']
  created_at: string
}

const paymentCommandSchema = z.object({
  orderId: z.string().uuid(),
  amount: z.number().int().nonnegative(),
  currency: z.literal('USD'),
  paymentToken: paymentTokenSchema,
})

export class PaymentService {
  constructor(private readonly database: Database) {
    initializeMessageStore(database)
    database.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL UNIQUE,
        amount INTEGER NOT NULL CHECK(amount >= 0),
        currency TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('APPROVED','DECLINED')),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payment_attempts (
        order_id TEXT PRIMARY KEY,
        attempts INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `)
  }

  getByOrderId(orderId: string): Payment | undefined {
    const row = this.database.prepare(`SELECT * FROM payments WHERE order_id = ?`).get(orderId) as unknown as PaymentRow | undefined
    return row ? this.toPayment(row) : undefined
  }

  listForOrder(orderId: string): readonly Payment[] {
    const rows = this.database.prepare(`SELECT * FROM payments WHERE order_id = ?`).all(orderId) as unknown as PaymentRow[]
    return rows.map((row) => this.toPayment(row))
  }

  getAttemptCount(orderId: string): number {
    const row = this.database.prepare(`SELECT attempts FROM payment_attempts WHERE order_id = ?`).get(orderId) as { attempts: number | bigint } | undefined
    return Number(row?.attempts ?? 0)
  }

  handleEvent(event: EventEnvelope): void {
    if (event.topic !== 'payment.process.requested') return
    const command = paymentCommandSchema.parse(event.data)
    const orderId = command.orderId
    const token = command.paymentToken
    // A payment ledger row is the semantic idempotency guard. Check it before
    // counting a delivery so redelivery after commit cannot inflate attempts.
    if (this.getByOrderId(orderId)) return
    const attempt = this.recordAttempt(orderId)
    if (token === 'tok_retry_twice' && attempt <= 2) throw new RetryableError(`Simulated payment timeout on attempt ${attempt}`)
    if (token === 'tok_always_error') throw new RetryableError(`Simulated payment provider outage on attempt ${attempt}`)

    inTransaction(this.database, () => {
      if (!claimInbox(this.database, 'payment-worker', event.id)) return
      if (this.database.prepare(`SELECT id FROM payments WHERE order_id = ?`).get(orderId)) return
      const status: Payment['status'] = token === 'tok_decline' ? 'DECLINED' : 'APPROVED'
      const paymentId = randomUUID()
      const now = new Date().toISOString()
      this.database.prepare(`
        INSERT INTO payments(id, order_id, amount, currency, status, created_at) VALUES (?, ?, ?, 'USD', ?, ?)
      `).run(paymentId, orderId, command.amount, status, now)
      addOutbox(this.database, createEvent({
        topic: status === 'APPROVED' ? 'payment.completed' : 'payment.failed',
        source: 'payments',
        aggregateId: orderId,
        correlationId: event.correlationId,
        causationId: event.id,
        data: { orderId, paymentId, status, reason: status === 'DECLINED' ? 'PAYMENT_DECLINED' : 'APPROVED' },
      }))
    })
  }

  close(): void {
    this.database.close()
  }

  private recordAttempt(orderId: string): number {
    const now = new Date().toISOString()
    this.database.prepare(`
      INSERT INTO payment_attempts(order_id, attempts, updated_at) VALUES (?, 1, ?)
      ON CONFLICT(order_id) DO UPDATE SET attempts = attempts + 1, updated_at = excluded.updated_at
    `).run(orderId, now)
    return this.getAttemptCount(orderId)
  }

  private toPayment(row: PaymentRow): Payment {
    return {
      id: row.id,
      orderId: row.order_id,
      amount: Number(row.amount),
      currency: row.currency,
      status: row.status,
      createdAt: row.created_at,
    }
  }
}
