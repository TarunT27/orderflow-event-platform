# REST API

All JSON success responses use `{ "data": ... }`. Errors use `{ "error": { "code", "message", "details?" } }`.

## Create order

`POST /api/v1/orders`

Header: `Idempotency-Key` — 1–128 non-whitespace edge characters.

```json
{
  "customerId": "customer-123",
  "sku": "SKU-RED",
  "quantity": 2,
  "paymentToken": "tok_success"
}
```

Returns `202 Accepted` and `Location` for a new asynchronous order. An identical replay returns `200` with `Idempotent-Replay: true`. A key reused with changed business data returns `409 idempotency_conflict`.

Allowed SKUs and prices come from `GET /api/v1/products`; prices cannot be supplied by the client.

## Read APIs

- `GET /api/v1/orders?limit=50`
- `GET /api/v1/orders/:id`
- `GET /api/v1/products`

Order responses include their complete immutable history.

## Operations APIs

These routes are available only when `DEMO_MODE` is not `false`.

- `GET /api/v1/ops` returns queue counters, status counters, recent events, and dead letters.
- `POST /api/v1/ops/dlq/:id/redrive` redrives one dead letter. An optional body such as `{ "paymentToken": "tok_success" }` changes only the deterministic demo scenario on the replacement event.

## Platform APIs

- `GET /health/live`
- `GET /health/ready`
- `GET /metrics` in Prometheus text format

The full machine-readable contract is [openapi.yaml](openapi.yaml).
