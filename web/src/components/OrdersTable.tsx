import type { Order, Product } from '../types.js'
import { EmptyBlock, LoadingBlock } from './PanelState.js'
import { StatusBadge } from './StatusBadge.js'

function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value
}

function formatDate(value?: string): string {
  if (!value) return 'Just now'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

interface OrdersTableProps {
  loading: boolean
  orders: Order[]
  products: Product[]
  selectedOrderId: string | undefined
  onSelect: (order: Order) => void
}

export function OrdersTable({ loading, orders, products, selectedOrderId, onSelect }: OrdersTableProps) {
  const productNames = new Map(products.map((product) => [product.sku, product.name]))

  return (
    <section className="orders-panel" id="orders" aria-labelledby="orders-title">
      <div className="panel-heading">
        <div>
          <h2 id="orders-title">Recent orders</h2>
          <p>Select a row to inspect its event trail.</p>
        </div>
        <span>{orders.length} total</span>
      </div>

      {loading ? (
        <LoadingBlock label="Loading orders..." />
      ) : orders.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Product</th>
                <th scope="col">Qty</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className={selectedOrderId === order.id ? 'is-selected' : undefined}>
                  <td>
                    <button className="order-link" type="button" onClick={() => onSelect(order)}>
                      <span>{shortId(order.id)}</span>
                      <small>{order.customerId}</small>
                    </button>
                  </td>
                  <td>{productNames.get(order.sku) ?? order.sku}</td>
                  <td>{order.quantity}</td>
                  <td><StatusBadge status={order.status} /></td>
                  <td>{formatDate(order.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyBlock title="No orders in the stream" message="Create the first order to start the event timeline." />
      )}
    </section>
  )
}
