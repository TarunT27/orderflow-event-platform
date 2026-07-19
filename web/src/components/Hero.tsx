import { Icon } from './Icons.js'

export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero__copy">
        <h1 id="hero-title">Orders in motion. Operations in control.</h1>
        <p>
          Watch inventory, payment, retries, and recovery move through one durable event stream - from request to resolution.
        </p>
        <a className="primary-link" href="#create-order">
          Run an order <Icon name="arrow" size={18} />
        </a>
      </div>
      <div className="hero__media">
        <img src="/assets/orderflow-hero.png" alt="Order event flow illustration" />
      </div>
    </section>
  )
}
