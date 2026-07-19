import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'

const baseUrl = process.env.ORDERFLOW_BASE_URL ?? 'http://127.0.0.1:4000'
const restartContainer = process.argv.includes('--restart')
const idempotencyKey = `docker-smoke-${randomUUID()}`
const orderInput = {
  customerId: 'docker-smoke-customer',
  sku: 'SKU-RED',
  quantity: 1,
  paymentToken: 'tok_retry_twice',
}

async function request(path, options = {}) {
  const response = await globalThis.fetch(`${baseUrl}${path}`, options)
  const body = await response.json().catch(() => undefined)
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} returned ${response.status}: ${JSON.stringify(body)}`)
  }
  return { response, body }
}

async function waitForReady(timeoutMilliseconds = 45_000) {
  const deadline = Date.now() + timeoutMilliseconds
  let lastError
  while (Date.now() < deadline) {
    try {
      const result = await request('/health/ready')
      if (result.body?.data?.status === 'ready') return
    } catch (error) {
      lastError = error
    }
    await delay(500)
  }
  throw new Error(`OrderFlow did not become ready: ${lastError instanceof Error ? lastError.message : 'timeout'}`)
}

async function waitForOrder(orderId, expectedStatus, timeoutMilliseconds = 30_000) {
  const deadline = Date.now() + timeoutMilliseconds
  let latestStatus = 'unknown'
  while (Date.now() < deadline) {
    const { body } = await request(`/api/v1/orders/${orderId}`)
    latestStatus = body?.data?.status ?? 'missing'
    if (latestStatus === expectedStatus) return body.data
    if (['FAILED', 'REJECTED'].includes(latestStatus)) {
      throw new Error(`Order ${orderId} reached unexpected terminal status ${latestStatus}`)
    }
    await delay(250)
  }
  throw new Error(`Order ${orderId} remained ${latestStatus}; expected ${expectedStatus}`)
}

function runDocker(arguments_) {
  const result = spawnSync('docker', arguments_, { stdio: 'inherit', shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`docker ${arguments_.join(' ')} exited with ${result.status}`)
}

async function createAndVerifyOrder() {
  const products = await request('/api/v1/products')
  if (!Array.isArray(products.body?.data) || products.body.data.length === 0) {
    throw new Error('The container returned no inventory products')
  }

  const create = await request('/api/v1/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify(orderInput),
  })
  if (create.response.status !== 202) {
    throw new Error(`Expected a new order to be accepted, received ${create.response.status}`)
  }

  const orderId = create.body?.data?.id
  if (typeof orderId !== 'string') throw new Error('Order response did not contain an ID')

  const replay = await request('/api/v1/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify(orderInput),
  })
  if (replay.response.status !== 200 || replay.response.headers.get('idempotent-replay') !== 'true') {
    throw new Error('Duplicate request was not returned as an idempotent replay')
  }
  if (replay.body?.data?.id !== orderId) throw new Error('Idempotent replay returned a different order')

  await waitForOrder(orderId, 'CONFIRMED')
  const metrics = await globalThis.fetch(`${baseUrl}/metrics`).then((response) => response.text())
  if (!metrics.includes('orderflow_queue_messages')) throw new Error('Prometheus metrics were not exposed')
  return orderId
}

await waitForReady()
const orderId = await createAndVerifyOrder()

if (restartContainer) {
  runDocker(['compose', 'restart', 'orderflow'])
  await waitForReady()
  const persistedOrder = await waitForOrder(orderId, 'CONFIRMED')
  if (persistedOrder.id !== orderId) throw new Error('Persisted order changed after restart')
}

process.stdout.write(`Docker smoke test passed for persisted order ${orderId}\n`)
