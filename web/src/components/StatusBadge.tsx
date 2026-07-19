const healthyStatuses = new Set(['CONFIRMED', 'APPROVED', 'AVAILABLE', 'READY'])
const warningStatuses = new Set(['PENDING', 'INVENTORY_RESERVED', 'PAYMENT_PROCESSING', 'RETRYING'])

export function StatusBadge({ status }: { status: string }) {
  const tone = healthyStatuses.has(status)
    ? 'healthy'
    : warningStatuses.has(status)
      ? 'warning'
      : status === 'REJECTED' || status === 'FAILED'
        ? 'danger'
        : 'neutral'

  return <span className={`status status--${tone}`}>{status.replaceAll('_', ' ')}</span>
}
