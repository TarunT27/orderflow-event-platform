import { AppShell } from './components/AppShell.js'
import { Hero } from './components/Hero.js'
import { Icon } from './components/Icons.js'
import { InventoryGrid } from './components/InventoryGrid.js'
import { OperationsPanel } from './components/OperationsPanel.js'
import { OrderForm } from './components/OrderForm.js'
import { OrdersTable } from './components/OrdersTable.js'
import { OrderTimeline } from './components/OrderTimeline.js'
import { useDashboard } from './hooks/useDashboard.js'

export function App() {
  const dashboard = useDashboard()

  return (
    <AppShell>
      <Hero />

      {dashboard.resourceErrors.length > 0 && (
        <div className="error-banner" role="alert">
          <div>
            <strong>Some services are unavailable.</strong>
            <span>{dashboard.resourceErrors.join(' / ')}</span>
          </div>
          <button type="button" onClick={() => void dashboard.loadDashboard()}>
            <Icon name="refresh" size={17} /> Retry
          </button>
        </div>
      )}

      <div className="dashboard-content">
        <div className="compose-layout">
          <OrderForm products={dashboard.products} submitState={dashboard.submitState} onSubmit={dashboard.submitOrder} />
          <InventoryGrid products={dashboard.products} loading={dashboard.loadState === 'loading'} />
        </div>

        <section className="workflow-section" aria-labelledby="workflow-title">
          <div className="section-heading">
            <div>
              <h2 id="workflow-title">Order stream</h2>
              <p>Every state change stays traceable from request to terminal outcome.</p>
            </div>
            <span className="section-number">03</span>
          </div>
          <div className="workflow-layout">
            <OrdersTable
              loading={dashboard.loadState === 'loading'}
              orders={dashboard.orders}
              products={dashboard.products}
              selectedOrderId={dashboard.selectedOrder?.id}
              onSelect={(order) => void dashboard.selectOrder(order)}
            />
            <OrderTimeline order={dashboard.selectedOrder} detailState={dashboard.orderDetailState} />
          </div>
        </section>

        <OperationsPanel snapshot={dashboard.ops} />
      </div>

      <footer>
        <span>OrderFlow</span>
        <p>Built to make asynchronous failure visible - and recoverable.</p>
      </footer>
    </AppShell>
  )
}
