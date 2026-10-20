# Local Integration Results

## Result

The latest independently rerun disposable-stack receipt `artifacts/integration/191422c9-ee09-41d4-96da-a78f3433335a.json` passed at source revision `bb5f2dcc63a7fc4e00559b8abba6a351802a2d27`. The selected integration group passed **3/3 suites and 12/12 tests**. The signed-webhook-to-worker pipeline passed **1/1 suite and 46/46 tests**, including the queued catalog-update case. Migration, both Jest stages, and project-scoped cleanup exited 0.

The runner started uniquely scoped PostgreSQL 16 and Redis 7 Compose services with temporary storage and loopback-only published ports, ran the real migration chain, then exercised these selected suites against local PostgreSQL, Redis, and worker code:

- `meta-webhook-durability.integration.test.js` (2 tests): durable receipt recovery and claim fencing.
- `message-worker.action-gate.integration.test.js` (4 tests): authorized action audits, denied missing secret, idempotent replay, and price revalidation.
- `message-worker.recovery.integration.test.js` (6 tests): holding-message and human-required recovery boundaries.

The webhook pipeline traversed the signed inbound webhook, Redis/BullMQ queue, production worker, catalog, grounding gate, and captured outbound adapter. In the new concurrency case, the test paused the production BullMQ worker after a signed image-request webhook queued, committed a catalog price update while the job waited in Redis, resumed the worker, and verified a processed receipt with the updated price and tenant-owned image. The adapter captures outbound Graph-shaped payloads; the test does not contact Meta.

Services used a reserved non-overlapping bridge subnet with IP masquerading disabled and ports published only on `127.0.0.1`. The host Node guard permits loopback hosts, blocks DNS resolver APIs and custom lookup/agent/dispatcher paths, and blocks non-loopback TCP, UDP, HTTP/S, and fetch. The passing receipt records **0 blocked non-loopback attempts** and `externalProvidersConfigured:false`. This is an API-level guard, not an OS-wide firewall or a restriction to only the disposable service ports. Cleanup was project-scoped with no persistent volumes.

## Scope boundary

This is a passing real-stack integration subset, not the complete product inbound-to-outbound matrix. It does not establish real Meta delivery, live AI provider behavior, image processing, every webhook/controller/catalog mutation combination, concurrency under the full 200-turn workload, or production readiness. Provider and outbound Meta transports are captured or mocked. The real-stack tests are evidence only for the listed flows; `INTEGRATION_READY=NO`.

Reproduce from `EasyMod-backend` with `node scripts/product-experience/run-integration.js`.
