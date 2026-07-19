import type { Database } from './database.js'
import { asNumber, inTransaction } from './database.js'
import type { EventEnvelope, EventTopic } from './contracts.js'
import { retryDelayMs } from './retry.js'

interface QueueRow {
  id: string
  topic: EventTopic
  event_json: string
  status: 'queued' | 'processing' | 'completed' | 'dead'
  attempts: number | bigint
  available_at: number | bigint
  last_error: string | null
  created_at: number | bigint
}

export interface QueuedMessage {
  readonly id: string
  readonly topic: EventTopic
  readonly event: EventEnvelope
  readonly status: QueueRow['status']
  readonly attempts: number
  readonly availableAt: number
  readonly lastError?: string
}

export interface QueueMetrics {
  readonly queued: number
  readonly processing: number
  readonly completed: number
  readonly dead: number
  readonly retried: number
}

export class DurableEventBus {
  constructor(
    private readonly database: Database,
    private readonly options: { maxAttempts: number; baseDelayMs: number } = { maxAttempts: 3, baseDelayMs: 25 },
  ) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS queue_messages (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        event_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','dead')),
        attempts INTEGER NOT NULL DEFAULT 0,
        available_at INTEGER NOT NULL,
        locked_until INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_queue_claim ON queue_messages(topic, status, available_at, created_at);
    `)
  }

  publish(event: EventEnvelope, now = Date.now()): boolean {
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO queue_messages(id, topic, event_json, available_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(event.id, event.topic, JSON.stringify(event), now, now)
    return result.changes === 1
  }

  claim(topic: EventTopic, now = Date.now(), leaseMs = 30_000): QueuedMessage | undefined {
    return inTransaction(this.database, () => {
      this.database.prepare(`
        UPDATE queue_messages SET status = 'queued', locked_until = NULL
        WHERE status = 'processing' AND locked_until <= ?
      `).run(now)
      const row = this.database.prepare(`
        SELECT id, topic, event_json, status, attempts, available_at, last_error, created_at
        FROM queue_messages
        WHERE topic = ? AND status = 'queued' AND available_at <= ?
        ORDER BY created_at, id LIMIT 1
      `).get(topic, now) as unknown as QueueRow | undefined
      if (!row) return undefined
      this.database.prepare(`
        UPDATE queue_messages
        SET status = 'processing', attempts = attempts + 1, locked_until = ?
        WHERE id = ?
      `).run(now + leaseMs, row.id)
      return this.toMessage({ ...row, status: 'processing', attempts: asNumber(row.attempts) + 1 })
    })
  }

  acknowledge(id: string): void {
    this.database.prepare(`UPDATE queue_messages SET status = 'completed', locked_until = NULL WHERE id = ?`).run(id)
  }

  fail(message: QueuedMessage, error: unknown, now = Date.now()): void {
    const reason = error instanceof Error ? error.message : 'Unknown consumer failure'
    const isDead = message.attempts >= this.options.maxAttempts
    this.database.prepare(`
      UPDATE queue_messages
      SET status = ?, available_at = ?, locked_until = NULL, last_error = ?
      WHERE id = ?
    `).run(
      isDead ? 'dead' : 'queued',
      isDead ? now : now + retryDelayMs(message.attempts, { baseMs: this.options.baseDelayMs, maxMs: 30_000 }),
      reason.slice(0, 500),
      message.id,
    )
  }

  deadLetters(): readonly QueuedMessage[] {
    return this.rows("WHERE status = 'dead'")
  }

  recent(limit = 50): readonly QueuedMessage[] {
    const safeLimit = Math.max(1, Math.min(200, limit))
    return this.rows('ORDER BY created_at DESC LIMIT ?', safeLimit)
  }

  redrive(id: string, transform?: (event: EventEnvelope) => EventEnvelope): EventEnvelope | undefined {
    const row = this.database.prepare(`
      SELECT id, topic, event_json, status, attempts, available_at, last_error, created_at
      FROM queue_messages WHERE id = ? AND status = 'dead'
    `).get(id) as unknown as QueueRow | undefined
    if (!row) return undefined
    const original = JSON.parse(row.event_json) as EventEnvelope
    const event = transform ? transform(original) : original
    inTransaction(this.database, () => {
      this.database.prepare(`UPDATE queue_messages SET status = 'completed', last_error = 'Redriven by operator' WHERE id = ?`).run(id)
      this.publish(event)
    })
    return event
  }

  nextAvailableAt(): number | undefined {
    const row = this.database.prepare(`SELECT MIN(available_at) AS next_at FROM queue_messages WHERE status = 'queued'`).get() as { next_at: number | bigint | null }
    return row.next_at === null ? undefined : asNumber(row.next_at)
  }

  metrics(): QueueMetrics {
    const rows = this.database.prepare(`SELECT status, COUNT(*) AS count FROM queue_messages GROUP BY status`).all() as Array<{ status: QueueRow['status']; count: number | bigint }>
    const values = { queued: 0, processing: 0, completed: 0, dead: 0 }
    for (const row of rows) values[row.status] = asNumber(row.count)
    const retried = this.database.prepare(`SELECT COALESCE(SUM(CASE WHEN attempts > 1 THEN attempts - 1 ELSE 0 END), 0) AS count FROM queue_messages`).get() as { count: number | bigint }
    return { ...values, retried: asNumber(retried.count) }
  }

  close(): void {
    this.database.close()
  }

  private rows(suffix: string, ...params: Array<string | number>): readonly QueuedMessage[] {
    const rows = this.database.prepare(`
      SELECT id, topic, event_json, status, attempts, available_at, last_error, created_at
      FROM queue_messages ${suffix}
    `).all(...params) as unknown as QueueRow[]
    return rows.map((row) => this.toMessage(row))
  }

  private toMessage(row: QueueRow): QueuedMessage {
    return {
      id: row.id,
      topic: row.topic,
      event: JSON.parse(row.event_json) as EventEnvelope,
      status: row.status,
      attempts: asNumber(row.attempts),
      availableAt: asNumber(row.available_at),
      ...(row.last_error === null ? {} : { lastError: row.last_error }),
    }
  }
}

export function initializeMessageStore(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS outbox_events (
      event_id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      event_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      published_at TEXT
    );
    CREATE TABLE IF NOT EXISTS inbox_events (
      consumer TEXT NOT NULL,
      event_id TEXT NOT NULL,
      processed_at TEXT NOT NULL,
      PRIMARY KEY(consumer, event_id)
    );
  `)
}

export function addOutbox(database: Database, event: EventEnvelope): void {
  database.prepare(`
    INSERT OR IGNORE INTO outbox_events(event_id, topic, event_json, created_at)
    VALUES (?, ?, ?, ?)
  `).run(event.id, event.topic, JSON.stringify(event), event.occurredAt)
}

export function claimInbox(database: Database, consumer: string, eventId: string): boolean {
  const result = database.prepare(`
    INSERT OR IGNORE INTO inbox_events(consumer, event_id, processed_at) VALUES (?, ?, ?)
  `).run(consumer, eventId, new Date().toISOString())
  return result.changes === 1
}

export function publishOutbox(database: Database, bus: DurableEventBus): number {
  const rows = database.prepare(`SELECT event_id, event_json FROM outbox_events WHERE published_at IS NULL ORDER BY created_at`).all() as Array<{ event_id: string; event_json: string }>
  for (const row of rows) {
    bus.publish(JSON.parse(row.event_json) as EventEnvelope)
    database.prepare(`UPDATE outbox_events SET published_at = ? WHERE event_id = ?`).run(new Date().toISOString(), row.event_id)
  }
  return rows.length
}
