import { useCallback, useEffect, useState } from 'react'
import { createOrder as postOrder, getOps, getOrder, getOrders, getProducts } from '../api.js'
import type { CreateOrderInput, LoadState, OpsSnapshot, Order, Product } from '../types.js'

const emptyOps: OpsSnapshot = {
  queue: { ready: 0, processing: 0, retried: 0, dead: 0 },
  deadLetters: [],
}

const terminalStatuses = new Set(['CONFIRMED', 'FAILED', 'REJECTED'])

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The service did not return a usable response.'
}

function replaceOrder(orders: Order[], nextOrder: Order): Order[] {
  const exists = orders.some((order) => order.id === nextOrder.id)
  if (!exists) return [nextOrder, ...orders]
  return orders.map((order) => (order.id === nextOrder.id ? { ...order, ...nextOrder } : order))
}

export function useDashboard() {
  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [ops, setOps] = useState<OpsSnapshot>(emptyOps)
  const [selectedOrder, setSelectedOrder] = useState<Order | undefined>()
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [orderDetailState, setOrderDetailState] = useState<LoadState>('idle')
  const [submitState, setSubmitState] = useState<LoadState>('idle')
  const [resourceErrors, setResourceErrors] = useState<string[]>([])

  const loadDashboard = useCallback(async () => {
    setLoadState('loading')
    setResourceErrors([])

    const [productsResult, ordersResult, opsResult] = await Promise.allSettled([getProducts(), getOrders(), getOps()])
    const errors: string[] = []

    if (productsResult.status === 'fulfilled') setProducts([...productsResult.value])
    else errors.push(`Inventory: ${errorMessage(productsResult.reason)}`)

    if (ordersResult.status === 'fulfilled') {
      const nextOrders = [...ordersResult.value]
      setOrders(nextOrders)
      setSelectedOrder((current) => current ?? nextOrders[0])
    } else {
      errors.push(`Orders: ${errorMessage(ordersResult.reason)}`)
    }

    if (opsResult.status === 'fulfilled') setOps({ ...opsResult.value, queue: { ...opsResult.value.queue } })
    else errors.push(`Operations: ${errorMessage(opsResult.reason)}`)

    setResourceErrors(errors)
    setLoadState(errors.length === 3 ? 'error' : 'ready')
  }, [])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  const selectOrder = useCallback(async (order: Order) => {
    setSelectedOrder({ ...order })
    setOrderDetailState('loading')
    try {
      const detail = await getOrder(order.id)
      setSelectedOrder({ ...detail })
      setOrders((current) => replaceOrder(current, detail))
      setOrderDetailState('ready')
    } catch {
      setOrderDetailState('error')
    }
  }, [])

  const submitOrder = useCallback(async (input: CreateOrderInput) => {
    setSubmitState('loading')
    const idempotencyKey = globalThis.crypto?.randomUUID?.() ?? `order-${Date.now()}-${Math.random().toString(16).slice(2)}`

    try {
      const order = await postOrder(input, idempotencyKey)
      setOrders((current) => replaceOrder(current, order))
      setSelectedOrder({ ...order })
      setSubmitState('ready')
      return order
    } catch (error) {
      setSubmitState('error')
      throw error
    }
  }, [])

  useEffect(() => {
    const selected = selectedOrder
    if (!selected || terminalStatuses.has(selected.status)) return undefined

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      try {
        const nextOrder = await getOrder(selected.id)
        if (cancelled) return
        setSelectedOrder({ ...nextOrder })
        setOrders((current) => replaceOrder(current, nextOrder))
        if (!terminalStatuses.has(nextOrder.status)) timeoutId = setTimeout(poll, 900)
      } catch {
        if (!cancelled) timeoutId = setTimeout(poll, 1_800)
      }
    }

    timeoutId = setTimeout(poll, 600)
    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [selectedOrder?.id, selectedOrder?.status])

  useEffect(() => {
    const intervalId = setInterval(() => {
      void getOps().then((snapshot) => setOps({ ...snapshot, queue: { ...snapshot.queue } })).catch(() => undefined)
    }, 6_000)
    return () => clearInterval(intervalId)
  }, [])

  return {
    products,
    orders,
    ops,
    selectedOrder,
    loadState,
    orderDetailState,
    submitState,
    resourceErrors,
    loadDashboard,
    selectOrder,
    submitOrder,
  }
}
