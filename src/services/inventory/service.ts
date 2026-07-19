import { randomUUID } from 'node:crypto'
import type { Database } from '../../shared/database.js'
import { inTransaction } from '../../shared/database.js'
import { createEvent, products, type EventEnvelope } from '../../shared/contracts.js'
import { addOutbox, claimInbox, initializeMessageStore } from '../../shared/messaging.js'

export interface ProductStock {
  readonly sku: string
  readonly name: string
  readonly description: string
  readonly unitPrice: number
  readonly onHand: number
  readonly reserved: number
  readonly available: number
  readonly accent: string
}

export interface Reservation {
  readonly id: string
  readonly orderId: string
  readonly sku: string
  readonly quantity: number
  readonly status: 'RESERVED' | 'RELEASED'
}

interface ProductRow {
  sku: string
  name: string
  description: string
  unit_price: number | bigint
  on_hand: number | bigint
  reserved: number | bigint
  accent: string
}

interface ReservationRow {
  id: string
  order_id: string
  sku: string
  quantity: number | bigint
  status: Reservation['status']
}

export class InventoryService {
  constructor(private readonly database: Database) {
    initializeMessageStore(database)
    database.exec(`
      CREATE TABLE IF NOT EXISTS products (
        sku TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        unit_price INTEGER NOT NULL,
        on_hand INTEGER NOT NULL CHECK(on_hand >= 0),
        reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved >= 0 AND reserved <= on_hand),
        accent TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL UNIQUE,
        sku TEXT NOT NULL REFERENCES products(sku),
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        status TEXT NOT NULL CHECK(status IN ('RESERVED','RELEASED')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    const insert = database.prepare(`INSERT OR IGNORE INTO products(sku, name, description, unit_price, on_hand, reserved, accent) VALUES (?, ?, ?, ?, ?, 0, ?)`)
    for (const product of products) insert.run(product.sku, product.name, product.description, product.unitPrice, product.initialStock, product.accent)
  }

  getProduct(sku: string): ProductStock | undefined {
    const row = this.database.prepare(`SELECT * FROM products WHERE sku = ?`).get(sku) as unknown as ProductRow | undefined
    return row ? this.toProduct(row) : undefined
  }

  listProducts(): readonly ProductStock[] {
    const rows = this.database.prepare(`SELECT * FROM products ORDER BY sku`).all() as unknown as ProductRow[]
    return rows.map((row) => this.toProduct(row))
  }

  listReservations(orderId?: string): readonly Reservation[] {
    const rows = orderId
      ? this.database.prepare(`SELECT id, order_id, sku, quantity, status FROM reservations WHERE order_id = ?`).all(orderId)
      : this.database.prepare(`SELECT id, order_id, sku, quantity, status FROM reservations ORDER BY created_at DESC`).all()
    return (rows as unknown as ReservationRow[]).map((row) => this.toReservation(row))
  }

  handleEvent(event: EventEnvelope): void {
    if (event.topic === 'inventory.reserve.requested') this.reserve(event)
    if (event.topic === 'inventory.release.requested') this.release(event)
  }

  close(): void {
    this.database.close()
  }

  private reserve(event: EventEnvelope): void {
    inTransaction(this.database, () => {
      if (!claimInbox(this.database, 'inventory-worker', event.id)) return
      const orderId = String(event.data.orderId)
      const sku = String(event.data.sku)
      const quantity = Number(event.data.quantity)
      const existing = this.database.prepare(`SELECT id FROM reservations WHERE order_id = ?`).get(orderId)
      if (existing) return
      const product = this.database.prepare(`SELECT * FROM products WHERE sku = ?`).get(sku) as unknown as ProductRow | undefined
      const available = product ? Number(product.on_hand) - Number(product.reserved) : 0
      if (!product || available < quantity) {
        addOutbox(this.database, createEvent({
          topic: 'inventory.rejected',
          source: 'inventory',
          aggregateId: orderId,
          correlationId: event.correlationId,
          causationId: event.id,
          data: { orderId, sku, quantity, available, reason: 'INSUFFICIENT_STOCK' },
        }))
        return
      }
      const reservationId = randomUUID()
      const now = new Date().toISOString()
      const update = this.database.prepare(`
        UPDATE products SET reserved = reserved + ?
        WHERE sku = ? AND on_hand - reserved >= ?
      `).run(quantity, sku, quantity)
      if (update.changes !== 1) throw new Error('Concurrent inventory reservation conflict')
      this.database.prepare(`
        INSERT INTO reservations(id, order_id, sku, quantity, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'RESERVED', ?, ?)
      `).run(reservationId, orderId, sku, quantity, now, now)
      addOutbox(this.database, createEvent({
        topic: 'inventory.reserved',
        source: 'inventory',
        aggregateId: orderId,
        correlationId: event.correlationId,
        causationId: event.id,
        data: { orderId, reservationId, sku, quantity },
      }))
    })
  }

  private release(event: EventEnvelope): void {
    inTransaction(this.database, () => {
      if (!claimInbox(this.database, 'inventory-worker', event.id)) return
      const orderId = String(event.data.orderId)
      const reservation = this.database.prepare(`SELECT * FROM reservations WHERE order_id = ?`).get(orderId) as unknown as ReservationRow | undefined
      if (!reservation || reservation.status === 'RELEASED') return
      const now = new Date().toISOString()
      this.database.prepare(`UPDATE products SET reserved = reserved - ? WHERE sku = ? AND reserved >= ?`).run(reservation.quantity, reservation.sku, reservation.quantity)
      this.database.prepare(`UPDATE reservations SET status = 'RELEASED', updated_at = ? WHERE id = ? AND status = 'RESERVED'`).run(now, reservation.id)
      addOutbox(this.database, createEvent({
        topic: 'inventory.released',
        source: 'inventory',
        aggregateId: orderId,
        correlationId: event.correlationId,
        causationId: event.id,
        data: { orderId, reservationId: reservation.id, releasedQuantity: Number(reservation.quantity) },
      }))
    })
  }

  private toProduct(row: ProductRow): ProductStock {
    const onHand = Number(row.on_hand)
    const reserved = Number(row.reserved)
    return {
      sku: row.sku,
      name: row.name,
      description: row.description,
      unitPrice: Number(row.unit_price),
      onHand,
      reserved,
      available: onHand - reserved,
      accent: row.accent,
    }
  }

  private toReservation(row: ReservationRow): Reservation {
    return { id: row.id, orderId: row.order_id, sku: row.sku, quantity: Number(row.quantity), status: row.status }
  }
}
