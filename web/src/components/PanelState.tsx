import { Icon } from './Icons.js'

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="panel-state" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function EmptyBlock({ title, message }: { title: string; message: string }) {
  return (
    <div className="panel-state panel-state--empty">
      <Icon name="layers" size={24} />
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  )
}
