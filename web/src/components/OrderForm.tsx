import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { CreateOrderInput, LoadState, Order, PaymentScenario, Product } from '../types.js'
import { paymentScenarios } from '../types.js'
import { Icon } from './Icons.js'

const scenarioLabels: Record<PaymentScenario, string> = {
  tok_success: 'Approve immediately',
  tok_retry_twice: 'Recover after two retries',
  tok_decline: 'Decline and release stock',
  tok_always_error: 'Exhaust retries -> DLQ',
}

interface OrderFormProps {
  products: Product[]
  submitState: LoadState
  onSubmit: (input: CreateOrderInput) => Promise<Order>
}

export function OrderForm({ products, submitState, onSubmit }: OrderFormProps) {
  const [customerId, setCustomerId] = useState('cust-demo')
  const [sku, setSku] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [paymentToken, setPaymentToken] = useState<PaymentScenario>('tok_success')
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | undefined>()

  useEffect(() => {
    if (!sku && products[0]) setSku(products[0].sku)
  }, [products, sku])

  const selectedProduct = useMemo(() => products.find((product) => product.sku === sku), [products, sku])
  const isSubmitting = submitState === 'loading'

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage(undefined)

    try {
      const order = await onSubmit({ customerId: customerId.trim(), sku, quantity, paymentToken })
      setMessage({ tone: 'success', text: `Order accepted / ${order.id}` })
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'The order could not be created.' })
    }
  }

  return (
    <section className="order-composer" id="create-order" aria-labelledby="create-order-title">
      <div className="section-heading section-heading--compact">
        <div>
          <h2 id="create-order-title">Create an order</h2>
          <p>Choose a payment behavior and watch the workflow react in real time.</p>
        </div>
        <span className="section-number">01</span>
      </div>

      <form onSubmit={handleSubmit}>
        <label className="field field--wide">
          <span>Product</span>
          <select value={sku} onChange={(event) => setSku(event.target.value)} required disabled={!products.length}>
            {!products.length && <option value="">Inventory is loading...</option>}
            {products.map((product) => (
              <option key={product.sku} value={product.sku} disabled={product.available < 1}>
                {product.name} / {product.sku} ({product.available} ready)
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Customer ID</span>
          <input
            autoComplete="off"
            maxLength={64}
            minLength={2}
            onChange={(event) => setCustomerId(event.target.value)}
            required
            value={customerId}
          />
        </label>

        <label className="field">
          <span>Quantity</span>
          <input
            inputMode="numeric"
            max={Math.max(selectedProduct?.available ?? 1, 1)}
            min={1}
            onChange={(event) => setQuantity(Number(event.target.value))}
            required
            type="number"
            value={quantity}
          />
        </label>

        <label className="field field--wide">
          <span>Payment scenario</span>
          <select value={paymentToken} onChange={(event) => setPaymentToken(event.target.value as PaymentScenario)}>
            {paymentScenarios.map((scenario) => (
              <option key={scenario} value={scenario}>{scenarioLabels[scenario]}</option>
            ))}
          </select>
          <small>{paymentToken}</small>
        </label>

        <button className="primary-button" disabled={isSubmitting || !products.length} type="submit">
          {isSubmitting ? <span className="spinner spinner--button" aria-hidden="true" /> : <Icon name="cart" size={18} />}
          {isSubmitting ? 'Submitting safely...' : 'Place order'}
        </button>
      </form>

      {message && (
        <div className={`form-message form-message--${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>
          {message.text}
        </div>
      )}
    </section>
  )
}
