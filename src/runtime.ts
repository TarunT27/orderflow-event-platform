import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { createEvent, eventTopics, type EventEnvelope, type EventTopic } from './shared/contracts.js'
import { openDatabase, type Database } from './shared/database.js'
import { DurableEventBus, publishOutbox } from './shared/messaging.js'
import { InventoryService } from './services/inventory/service.js'
import { OrderService } from './services/orders/service.js'
import { PaymentService } from './services/payments/service.js'
import type { GatewayDependencies } from './gateway/app.js'

export interface RuntimeOptions {
  readonly dataDir?: string
  readonly inMemory?: boolean
  readonly maxAttempts?: number
  readonly pollMs?: number
}

export interface DrainOptions {
  readonly advanceTime?: boolean
  readonly maxIterations?: number
}

export class PlatformRuntime {
  readonly orders: OrderService
  readonly inventory: InventoryService
  readonly payments: PaymentService
  readonly bus: DurableEventBus
  readonly dependencies: GatewayDependencies
  app?: FastifyInstance

  private readonly orderDatabase: Database
  private readonly inventoryDatabase: Database
  private readonly paymentDatabase: Database
  private timer: NodeJS.Timeout | undefined
  private currentTime = Date.now()

  constructor(private readonly options: RuntimeOptions = {}) {
    const pathFor = (name: string) => options.inMemory ? ':memory:' : join(options.dataDir ?? './data', `${name}.db`)
    this.orderDatabase = openDatabase(pathFor('orders'))
    this.inventoryDatabase = openDatabase(pathFor('inventory'))
    this.paymentDatabase = openDatabase(pathFor('payments'))
    this.orders = new OrderService(this.orderDatabase)
    this.inventory = new InventoryService(this.inventoryDatabase)
    this.payments = new PaymentService(this.paymentDatabase)
    this.bus = new DurableEventBus(openDatabase(pathFor('events')), {
      maxAttempts: options.maxAttempts ?? 3,
      baseDelayMs: options.inMemory ? 1 : 250,
    })
    this.dependencies = {
      orders: this.orders,
      inventory: this.inventory,
      payments: this.payments,
      bus: this.bus,
      drain: () => this.drain({ advanceTime: true }),
      redrive: (id, paymentToken) => this.redrive(id, paymentToken),
    }
  }

  async drain(options: DrainOptions = {}): Promise<void> {
    this.currentTime = Math.max(this.currentTime, Date.now())
    const maxIterations = options.maxIterations ?? 500
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      this.currentTime = Math.max(this.currentTime, Date.now())
      const worked = this.processOne(this.currentTime)
      if (worked) continue
      const next = this.bus.nextAvailableAt()
      if (options.advanceTime && next !== undefined && next > this.currentTime) {
        this.currentTime = next
        continue
      }
      return
    }
    throw new Error(`Event runtime did not become idle after ${maxIterations} iterations`)
  }

  startWorkers(): void {
    const pollMs = this.options.pollMs ?? 100
    if (this.timer) return
    this.timer = setInterval(() => {
      this.currentTime = Date.now()
      try {
        for (let index = 0; index < 25 && this.processOne(this.currentTime); index += 1) {
          // Drain a bounded batch each tick so HTTP work is never starved.
        }
      } catch (error) {
        process.stderr.write(`${JSON.stringify({ level: 'error', message: 'worker tick failed', error: error instanceof Error ? error.message : String(error) })}\n`)
      }
    }, pollMs)
    this.timer.unref()
  }

  stopWorkers(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  close(): void {
    this.stopWorkers()
    this.orders.close()
    this.inventory.close()
    this.payments.close()
    this.bus.close()
  }

  private processOne(now: number): boolean {
    let worked = this.publishAllOutboxes() > 0
    for (const topic of eventTopics) {
      const handler = this.handlerFor(topic)
      if (!handler) continue
      const message = this.bus.claim(topic, now)
      if (!message) continue
      worked = true
      try {
        handler(message.event)
        this.bus.acknowledge(message.id)
      } catch (error) {
        this.bus.fail(message, error, now)
      }
      this.publishAllOutboxes()
    }
    return worked
  }

  private handlerFor(topic: EventTopic): ((event: EventEnvelope) => void) | undefined {
    if (topic === 'inventory.reserve.requested' || topic === 'inventory.release.requested') {
      return (event) => this.inventory.handleEvent(event)
    }
    if (topic === 'payment.process.requested') return (event) => this.payments.handleEvent(event)
    if (topic === 'inventory.reserved' || topic === 'inventory.rejected' || topic === 'payment.completed' || topic === 'payment.failed' || topic === 'inventory.released') {
      return (event) => this.orders.handleEvent(event)
    }
    return undefined
  }

  private publishAllOutboxes(): number {
    return publishOutbox(this.orderDatabase, this.bus)
      + publishOutbox(this.inventoryDatabase, this.bus)
      + publishOutbox(this.paymentDatabase, this.bus)
  }

  private redrive(id: string, paymentToken?: string): EventEnvelope | undefined {
    return this.bus.redrive(id, (original) => createEvent({
      topic: original.topic,
      source: 'operations',
      aggregateId: original.aggregateId,
      correlationId: original.correlationId,
      causationId: original.id,
      data: paymentToken ? { ...original.data, paymentToken } : { ...original.data },
    }))
  }
}

export function createPlatformRuntime(options?: RuntimeOptions): PlatformRuntime {
  return new PlatformRuntime(options)
}
