import type { OpsSnapshot } from '../types.js'
import { EmptyBlock } from './PanelState.js'
import { Icon } from './Icons.js'

const metricDetails = [
  { key: 'ready' as const, label: 'Ready', hint: 'Awaiting a consumer', tone: 'healthy' },
  { key: 'processing' as const, label: 'Processing', hint: 'Handlers in flight', tone: 'accent' },
  { key: 'retried' as const, label: 'Retried', hint: 'Recovered attempts', tone: 'warning' },
  { key: 'dead' as const, label: 'Dead letters', hint: 'Needs review', tone: 'danger' },
]

function formatDate(value?: string): string {
  if (!value) return 'Recently'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function OperationsPanel({ snapshot }: { snapshot: OpsSnapshot }) {
  const maxMetric = Math.max(...Object.values(snapshot.queue), 1)

  return (
    <section className="operations-section" id="operations" aria-labelledby="operations-title">
      <div className="section-heading">
        <div>
          <h2 id="operations-title">Queue health</h2>
          <p>A compact signal of throughput pressure, retry recovery, and failed work.</p>
        </div>
        <span className="section-number">04</span>
      </div>

      <div className="metrics-grid">
        {metricDetails.map((metric) => (
          <article className={`metric-card metric-card--${metric.tone}`} key={metric.key}>
            <div className="metric-card__header">
              <span>{metric.label}</span>
              <Icon name={metric.key === 'dead' ? 'archive' : 'activity'} size={18} />
            </div>
            <strong>{snapshot.queue[metric.key]}</strong>
            <div className="metric-bar" aria-hidden="true">
              <span style={{ width: `${Math.max((snapshot.queue[metric.key] / maxMetric) * 100, 4)}%` }} />
            </div>
            <p>{metric.hint}</p>
          </article>
        ))}
      </div>

      <div className="dlq-panel" id="dead-letters" aria-labelledby="dlq-title">
        <div className="panel-heading dlq-panel__heading">
          <div className="dlq-panel__copy">
            <h2 id="dlq-title">Dead-letter review</h2>
            <p>Poison messages are isolated here after bounded retries.</p>
          </div>
          <img className="dlq-panel__image" src="/assets/dlq-incident.png" alt="Dead-letter isolation chamber illustration" />
          <span className="incident-count">{snapshot.deadLetters.length} incident{snapshot.deadLetters.length === 1 ? '' : 's'}</span>
        </div>

        {snapshot.deadLetters.length ? (
          <div className="incident-list">
            {snapshot.deadLetters.map((item, index) => (
              <article className="incident" key={item.id ?? `${item.topic}-${index}`}>
                <div className="incident__icon"><Icon name="shield" size={20} /></div>
                <div className="incident__body">
                  <div>
                    <strong>{item.topic}</strong>
                    <span>{item.error ?? 'Handler exhausted its retry policy'}</span>
                  </div>
                  <dl>
                    <div><dt>Attempts</dt><dd>{item.attempts}</dd></div>
                    <div><dt>Order</dt><dd>{item.orderId ?? 'Unknown'}</dd></div>
                    <div><dt>Failed</dt><dd>{formatDate(item.failedAt ?? item.createdAt)}</dd></div>
                  </dl>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyBlock title="DLQ is clear" message="No failed messages are waiting for operator review." />
        )}
      </div>
    </section>
  )
}
