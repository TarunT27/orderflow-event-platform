import type { Product } from '../types.js'
import { EmptyBlock, LoadingBlock } from './PanelState.js'

export function InventoryGrid({ products, loading }: { products: Product[]; loading: boolean }) {
  return (
    <section className="inventory-section" id="inventory" aria-labelledby="inventory-title">
      <div className="section-heading">
        <div>
          <h2 id="inventory-title">Inventory pulse</h2>
          <p>Available units and active reservations, straight from the inventory boundary.</p>
        </div>
        <span className="section-number">02</span>
      </div>

      {loading ? (
        <LoadingBlock label="Reading inventory..." />
      ) : products.length ? (
        <div className="inventory-grid">
          {products.map((product) => {
            const total = product.available + product.reserved
            const availablePercent = total ? Math.round((product.available / total) * 100) : 0
            const tone = product.available === 0 ? 'danger' : product.available <= 2 ? 'warning' : 'healthy'
            return (
              <article className="inventory-card" key={product.sku}>
                <div className="inventory-card__top">
                  <span className="inventory-card__sku">{product.sku}</span>
                  <span className={`stock-dot stock-dot--${tone}`}>{tone === 'healthy' ? 'Healthy' : tone === 'warning' ? 'Low stock' : 'Empty'}</span>
                </div>
                <h3>{product.name}</h3>
                {product.description && <p>{product.description}</p>}
                <div className="stock-meter" aria-label={`${availablePercent}% of stock available`}>
                  <span style={{ width: `${availablePercent}%` }} />
                </div>
                <div className="inventory-card__metrics">
                  <span><strong>{product.available}</strong> available</span>
                  <span><strong>{product.reserved}</strong> reserved</span>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <EmptyBlock title="No inventory yet" message="Products will appear when the inventory service responds." />
      )}
    </section>
  )
}
