# AWS deployment map

The local runtime is designed so infrastructure can change without rewriting domain correctness.

| Local component | AWS target |
|---|---|
| Fastify gateway and service workers | ECS Fargate behind API Gateway or an ALB |
| Separate SQLite service databases | Separate RDS PostgreSQL databases/users |
| Durable SQLite event bus | SNS fan-out to service-owned SQS queues and DLQs |
| Lease and backoff fields | SQS visibility timeout and redrive policy |
| React bundle | S3 + CloudFront |
| JSON logs and Prometheus endpoint | ADOT, CloudWatch Logs/Metrics, X-Ray |
| `.env` configuration | Secrets Manager and SSM Parameter Store |
| Container image | ECR |

## Migration rules

Retain the transactional outbox, inbox tables, unique reservation/payment keys, correlation IDs, and state guards. SQS is at least once; FIFO deduplication is a useful optimization, not the correctness mechanism.

Use `MessageGroupId=orderId` only where per-order ordering helps. Handlers must still accept stale duplicates safely. Configure a service-owned DLQ and alarm for each consumer queue. Scale workers on queue depth and oldest-message age.

## Security baseline

- API Gateway JWT authorizer with Cognito or an equivalent identity provider
- Least-privilege task roles scoped to specific queues, parameters, secrets, and log groups
- Private RDS subnets with security groups allowing only the owning service
- TLS everywhere; CloudFront and API Gateway access logs enabled
- KMS encryption for SQS, RDS, S3, Secrets Manager, and log groups
- AWS WAF and per-identity rate limits on order creation
- No payment tokens, request bodies, or customer identifiers in metric labels

## Deployment sequence

1. Apply backward-compatible database migrations.
2. Deploy consumers that accept both old and new event versions.
3. Deploy producers for the new event version.
4. Watch queue age, DLQ depth, task restarts, and pending saga age.
5. Roll back producers first. Preserve queues and outboxes; never delete work to make a deployment green.

## Alarms

- Any DLQ depth greater than zero
- Oldest queue message or unpublished outbox row above 60 seconds
- Sustained consumer error rate above the agreed SLO
- Orders stuck in a nonterminal state past the saga deadline
- RDS connection, CPU, storage, or lock saturation
- ECS task restart loop

Full Terraform/CDK is intentionally a follow-up. This repository provides the runtime contracts and boundaries an infrastructure module must preserve.
