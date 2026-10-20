# Local Integration Results

## Result

The independent final disposable-stack retry passed: **3 suites, 12 tests**. Receipt: `artifacts/integration/7464d6e3-713b-41e2-8516-ce5a93cdc9ab.json`; runner log: `artifacts/integration/7464d6e3-713b-41e2-8516-ce5a93cdc9ab.log`. The independent review's preceding run (`f9bd5277-be6f-437d-8fd1-e23f3ab7fdf9`) reported 12/12 assertions passing but exited with `jest.exitCode=1` and a suite summary of one failed, two passed. The runner receipt did not retain the underlying suite-level diagnostics. The reviewer reran the same selected suites successfully afterward; the earlier receipt remains preserved as a transient failure.

The runner launched uniquely scoped Postgres 16 and Redis 7 Compose services with temporary storage and loopback-only published ports, ran the actual migration chain, and exercised the selected integration suites against real local PostgreSQL/Redis and worker code:

- `meta-webhook-durability.integration.test.js` (2 tests): durable receipt recovery and claim fencing.
- `message-worker.action-gate.integration.test.js` (4 tests): authorized action audits, denied missing secret, idempotent replay, and price revalidation.
- `message-worker.recovery.integration.test.js` (6 tests): holding-message and human-required recovery boundaries.

An attempted Docker `internal: true` network could not expose published Postgres/Redis ports to the host on this Windows Docker Desktop setup, so it stopped before migrations; its failure is preserved in `artifacts/integration/3f77bf83-c006-44fb-8e6b-74371eca3e79.json`. The passing run uses a reserved non-overlapping bridge subnet with IP masquerading disabled and ports published only on `127.0.0.1`. The host Node guard permits loopback IPs and `localhost`, rejects DNS resolver APIs and custom lookup/agent/dispatcher paths, and blocks non-loopback TCP, UDP, HTTP/S, and fetch. It counted **0 blocked non-loopback attempts** in the passing run. This is an API-level guard, not an OS-wide firewall. No external provider was configured. Cleanup is project-scoped with no persistent volumes.

## Scope boundary

This is a passing real-stack integration subset, not the complete requested product inbound-to-outbound matrix. It does not establish real Meta delivery, live AI provider behavior, image processing, every webhook/controller/catalog mutation combination, concurrency under the full 200-turn workload, or production readiness. The real-stack tests are evidence for the listed flows only.

Reproduce from `EasyMod-backend` with `node scripts/product-experience/run-integration.js`.
