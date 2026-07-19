import type { LoadState, Order, OrderEvent } from '../types.js'
import { EmptyBlock } from './PanelState.js'
import { StatusBadge } from './StatusBadge.js'

function formatTime(value?: string): string {
  if (!value) return 'pending timestamp'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(date)
}

function derivedEvents(order: Order): OrderEvent[] {
  const makeEvent = (type: string, occurredAt?: string): OrderEvent => occurredAt ? { type, occurredAt } : { type }
  const base: OrderEvent[] = [makeEvent('order.created', order.createdAt)]
  const inventoryReached = ['INVENTORY_RESERVED', 'PAYMENT_PROCESSING', 'CONFIRMED', 'FAILED'].includes(order.status)
  const paymentReached = ['PAYMENT_PROCESSING', 'CONFIRMED', 'FAILED'].includes(order.status)
  const finalReached = ['CONFIRMED', 'FAILED', 'REJECTED'].includes(order.status)

  return [
    ...base,
    ...(inventoryReached ? [makeEvent('inventory.reserved', order.updatedAt)] : []),
    ...(paymentReached ? [makeEvent('payment.processing', order.updatedAt)] : []),
    ...(finalReached ? [makeEvent(`order.${order.status.toLowerCase()}`, order.updatedAt)] : []),
  ]
}

function eventTone(type: string): 'healthy' | 'warning' | 'danger' {
  if (type.includes('failed') || type.includes('rejected') || type.includes('dead')) return 'danger'
  if (type.includes('retry') || type.includes('processing') || type.includes('reserved')) return 'warning'
  return 'healthy'
}

export function OrderTimeline({ order, detailState }: { order: Order | undefined; detailState: LoadState }) {
  if (!order) {
    return (
      <aside className="timeline-panel" aria-labelledby="timeline-title">
        <div className="panel-heading"><div><h2 id="timeline-title">Live order timeline</h2></div></div>
        <EmptyBlock title="Nothing selected" message="Choose an order to inspect every event transition." />
      </aside>
    )
  }

  const events = order.events?.length ? [...order.events] : derivedEvents(order)

  return (
    <aside className="timeline-panel" aria-labelledby="timeline-title" aria-live="polite">
      <div className="timeline-summary">
        <div>
          <span className="timeline-summary__label">Selected order</span>
          <h2 id="timeline-title">{order.id}</h2>
          <p>{order.customerId} / {order.quantity} x {order.sku}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <div className="polling-note">
        <span className={['CONFIRMED', 'FAILED', 'REJECTED'].includes(order.status) ? 'live-dot live-dot--still' : 'live-dot'} />
        {detailState === 'loading'
          ? 'Refreshing detail...'
          : ['CONFIRMED', 'FAILED', 'REJECTED'].includes(order.status)
            ? 'Workflow complete'
            : 'Polling for the next event'}
      </div>

      <ol className="timeline">
        {events.map((event, index) => {
          const tone = eventTone(event.type)
          return (
            <li key={event.id ?? `${event.type}-${index}`} className={`timeline__item timeline__item--${tone}`}>
              <span className="timeline__marker" aria-hidden="true" />
              <div>
                <strong>{event.type}</strong>
                <span>{event.note ? `${event.note} / ` : ''}{event.attempt ? `Attempt ${event.attempt} / ` : ''}{formatTime(event.occurredAt ?? event.createdAt)}</span>
              </div>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}
