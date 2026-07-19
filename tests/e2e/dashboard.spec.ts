import { expect, test, type Page, type Route } from '@playwright/test'

const products = [
  {
    sku: 'SKU-RED',
    name: 'Pulse Headphones',
    description: 'Low-latency studio headphones',
    price: 199.99,
    available: 10,
    reserved: 2,
  },
  {
    sku: 'SKU-BLUE',
    name: 'Orbit Speaker',
    description: 'Portable spatial audio',
    price: 89,
    available: 1,
    reserved: 3,
  },
]

const seedOrder = {
  id: 'ord-seed-001',
  customerId: 'cust-demo',
  sku: 'SKU-BLUE',
  quantity: 1,
  paymentToken: 'tok_success',
  status: 'CONFIRMED',
  createdAt: '2026-07-19T14:20:00.000Z',
  updatedAt: '2026-07-19T14:20:02.000Z',
  events: [
    { type: 'order.created', occurredAt: '2026-07-19T14:20:00.000Z' },
    { type: 'inventory.reserved', occurredAt: '2026-07-19T14:20:01.000Z' },
    { type: 'order.confirmed', occurredAt: '2026-07-19T14:20:02.000Z' },
  ],
}

const ops = {
  queue: { ready: 3, processing: 1, retried: 2, dead: 1 },
  deadLetters: [
    {
      id: 'dlq-001',
      topic: 'payment.process.requested',
      attempts: 3,
      error: 'Payment provider unavailable',
      failedAt: '2026-07-19T14:19:00.000Z',
      orderId: 'ord-poison-001',
    },
  ],
}

async function mockDashboardApi(page: Page) {
  let created = false
  let detailReads = 0

  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname

    if (path === '/api/v1/products') {
      await route.fulfill({ json: { success: true, data: products } })
      return
    }

    if (path === '/api/v1/ops') {
      await route.fulfill({ json: { success: true, data: ops } })
      return
    }

    if (path === '/api/v1/orders' && request.method() === 'GET') {
      await route.fulfill({ json: { success: true, data: created ? [seedOrder, createdOrder('CONFIRMED')] : [seedOrder] } })
      return
    }

    if (path === '/api/v1/orders' && request.method() === 'POST') {
      expect(request.headers()['idempotency-key']).toBeTruthy()
      created = true
      await route.fulfill({ status: 202, json: { success: true, data: createdOrder('PENDING') } })
      return
    }

    if (path === '/api/v1/orders/ord-new-001') {
      detailReads += 1
      await route.fulfill({
        json: { success: true, data: createdOrder(detailReads > 1 ? 'CONFIRMED' : 'PAYMENT_PROCESSING') },
      })
      return
    }

    if (path === '/api/v1/orders/ord-seed-001') {
      await route.fulfill({ json: { success: true, data: seedOrder } })
      return
    }

    await route.fulfill({ status: 404, json: { success: false, error: { message: 'Not found' } } })
  })
}

function createdOrder(status: string) {
  return {
    id: 'ord-new-001',
    customerId: 'cust-e2e',
    sku: 'SKU-RED',
    quantity: 2,
    paymentToken: 'tok_success',
    status,
    createdAt: '2026-07-19T14:30:00.000Z',
    updatedAt: '2026-07-19T14:30:03.000Z',
    events: [
      { type: 'order.created', occurredAt: '2026-07-19T14:30:00.000Z' },
      { type: 'inventory.reserved', occurredAt: '2026-07-19T14:30:01.000Z' },
      ...(status === 'CONFIRMED'
        ? [
            { type: 'payment.approved', occurredAt: '2026-07-19T14:30:02.000Z' },
            { type: 'order.confirmed', occurredAt: '2026-07-19T14:30:03.000Z' },
          ]
        : []),
    ],
  }
}

test.describe('OrderFlow operations dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardApi(page)
  })

  test('creates an idempotent order and follows it to confirmation', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Orders in motion. Operations in control.' })).toBeVisible()
    await page.getByLabel('Customer ID').fill('cust-e2e')
    await page.getByLabel('Product').selectOption('SKU-RED')
    await page.getByLabel('Quantity').fill('2')
    await page.getByLabel('Payment scenario').selectOption('tok_success')
    await page.getByRole('button', { name: 'Place order' }).click()

    await expect(page.getByText('Order accepted')).toBeVisible()
    await expect(page.getByText('ord-new-001').first()).toBeVisible()
    await expect(page.getByText('CONFIRMED').first()).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText('payment.approved')).toBeVisible()
  })

  test('surfaces inventory, scenarios, queue health, DLQ incidents, and mobile navigation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Orders in motion. Operations in control.' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
    await expect(page.getByRole('heading', { name: 'Inventory pulse' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Pulse Headphones' })).toBeVisible()
    await expect(page.getByLabel('Payment scenario').locator('option')).toHaveCount(4)
    await expect(page.getByRole('heading', { name: 'Queue health' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Dead-letter review' })).toBeVisible()
    await expect(page.getByText('Payment provider unavailable')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Dashboard sections' })).toBeVisible()
  })
})
