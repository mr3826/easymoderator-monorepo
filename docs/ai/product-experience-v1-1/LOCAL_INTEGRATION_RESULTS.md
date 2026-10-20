# Local Integration Results

## Result

The latest independently rerun disposable-stack receipt `artifacts/integration/2f3cf498-9164-46b9-8323-0c6208711213.json` passed. The selected integration group passed **3/3 suites and 12/12 tests** in 15.543 seconds. The signed-webhook-to-worker pipeline passed **1/1 suite and 45/45 tests** in 37.231 seconds, including outbound capture and malicious URL rejection. The runner recorded migration, test, and project cleanup exit code 0.

The runner launched uniquely scoped Postgres 16 and Redis 7 Compose services with temporary storage and loopback-only published ports, ran the migration chain, and exercised these selected integration suites against local PostgreSQL, Redis, and worker code:

- `meta-webhook-durability.integration.test.js` (2 tests): durable receipt recovery and claim fencing.
- `message-worker.action-gate.integration.test.js` (4 tests): authorized action audits, denied missing secret, idempotent replay, and price revalidation.
- `message-worker.recovery.integration.test.js` (6 tests): holding-message and human-required recovery boundaries.

The webhook pipeline traversed the signed inbound webhook, Redis/BullMQ queue, worker, and captured outbound adapter. Services used a reserved non-overlapping bridge subnet with IP masquerading disabled and ports published only on `127.0.0.1`. The host Node guard permits loopback IPs/localhost, blocks DNS resolver APIs and custom lookup/agent/dispatcher paths, and blocks non-loopback TCP, UDP, HTTP/S, and fetch. The passing receipt records **0 blocked non-loopback attempts** and `externalProvidersConfigured:false`. This is an API-level guard, not an OS-wide firewall or a restriction to only the disposable service ports. Cleanup was project-scoped with no persistent volumes.

The final integration attempt passed. A prior suite-level failure from an earlier run did not preserve the root cause; the current runner captures structured failure summaries. This remains a historical evidence limitation.

## Scope boundary

This is a passing real-stack integration subset, not the complete product inbound-to-outbound matrix. It does not establish real Meta delivery, live AI provider behavior, image processing, every webhook/controller/catalog mutation combination, concurrency under the full 200-turn workload, or production readiness. The real-stack tests are evidence for the listed flows only.

Reproduce from `EasyMod-backend` with `node scripts/product-experience/run-integration.js`.
