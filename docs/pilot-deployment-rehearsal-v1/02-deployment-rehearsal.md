# 02 — Deployment rehearsal

## Result

`DEPLOYMENT_REHEARSAL=PARTIAL`. Images were built from code SHA `6d6bc1dd056e09202b97d05e81f20308b15109ab`, the eight-service isolated stack started, the application reported the exact SHA, and internal health/readiness passed. The Windows founder preview remains inaccessible because the WSL Docker port mappings did not appear in runtime networking. The run did not exercise authenticated tenant workflows or external callbacks.

## Build and test results

| Check | Result and evidence |
|---|---|
| Production Compose merge | PASS. Production Compose plus rehearsal override `config --quiet` exited 0. Secret-redacted canonical configuration SHA-256: `372d979a0b5de7b578c0578f917d749ff60c7908557a734efa336b1ce8b303db`. |
| Application images | PASS. Backend/worker, merchant frontend, and Growth images built successfully from the pinned source. Immutable image IDs are listed in 01. |
| Backend security suite | PASS. Node 20.20.2: 58 suites, 813 tests passed, exit 0. Log: `D:\easymod-runtime\pilot-deployment-rehearsal-v1\backend-security.log`. |
| Queue-manager startup boundary | PASS. Node 20.20.2: 1 suite, 4 tests passed, exit 0. The regression fails before the fix because a normal import constructed 12 workers; after the fix import is passive until explicit `startWorkers()`. Log: `queue-manager-startup-final.log`. |
| Frontend unit tests | PASS. 78 files, 692 tests passed, exit 0. Skip count was not retained in the execution record. Non-fatal CSRF localhost and localstorage-file warnings were emitted. Log: `frontend-unit-final.log`. |
| Frontend production build | PASS. Vite 7.3.6 transformed 2,758 modules. The 549.55 kB React vendor chunk warning remains. Log: `frontend-build-final.log`. |
| Payment webhook replay/race harness | PASS in a separate throwaway internal test project: 1 suite, 2 tests passed, exit 0; exact disposable Postgres/Redis project cleanup succeeded. No valid callback was sent to the main rehearsal app. Log: `payment-webhook-race.log`. |
| Independent migration rerun | PASS. Fresh verifier ran the same migration-dryrun workload from the source mirror: six phases, `MIGRATION_DRYRUN_EXIT=0`. Receipt: `migration-dryrun-independent-final.log`. |
| Independent operational receipts | PASS for bounded scenarios. Worker and graceful Redis recovery, synthetic kill switches, no-send monitoring check, and project-scoped graceful stop/restart each have separate exit receipts in the runtime evidence directory. Full scope and limits are summarized in 04 and 10. |
| Backend default full suite | NOT RUN to completion. An earlier attempt was stopped after BullMQ tried unknown localhost Redis on `::1:6379` and `127.0.0.1:6379`, both refused; it produced no totals. The final backend security suite used isolated dependencies and passed. |
| Browser/E2E | NOT RUN. Playwright and Meta-shaped end-to-end suites were not run in this final rehearsal. |

The backend image build also reported 3 high npm audit findings. The build succeeded; the findings remain a release blocker. No test output or skip count is inferred where the execution record did not retain it.

## Runtime results

- Docker Engine 29.9.2, Compose 5.6.1, Node 20.20.2, npm 10.8.2 inside the dedicated `EasyModPilotRehearsalV1` WSL2 distro.
- Backend, worker, frontend, Growth frontend, Caddy, Postgres, Redis, and Qdrant started under the isolated Compose project and internal-only network.
- `/health/live`, `/health/ready`, `/health/sse`, and `/api/version` returned 200 from the backend. Readiness reported database and Redis connected; SSE PubSub reported ready with 0 current connections.
- `/api/version` reported code SHA `6d6bc1dd056e09202b97d05e81f20308b15109ab`, 66 migrations, latest `20261026_001_order_idempotency_unique`.
- Caddy internal HTTPS routes for health, API version, merchant frontend, and Growth readiness returned 200.
- Runtime mutation switches were false in backend and worker. A synthetic callback with no signature returned 503.
- Graceful full-stack shutdown exited cleanly. A subsequent `docker compose up -d --wait` returned backend, worker, Growth, Postgres, and Redis healthy; the other app/proxy containers were running. The recovery test is detailed in 04.
- The fresh independent verifier repeated worker/Redis recovery and the graceful full-stack lifecycle. Both canaries remained pending while the worker was stopped, completed once with the expected no-send result, and cleared queue counts. The independent full-stack stop and restart each exited 0; all eight services returned, with five healthchecked services healthy. Receipts: `worker-recovery-independent-final.log` and `compose-shutdown-restart-independent-final.log`.
- The same reviewer reran the three synthetic kill-switch levels and queried live/readiness/SSE plus alert sink configuration. It did not call `sendTestAlert`; the health and sink receipt explicitly says there was no alert sent or received. Receipts: `kill-switches-independent-final.log` and `monitoring-independent-final.log`.
- After all independent receipts were written, the exact rehearsal Compose project was gracefully stopped. All eight containers are exited; its named volumes and WSL2 distro remain intact. No other services were stopped.

The `HostConfig` declared Caddy bindings to `127.0.0.1:54580` and `127.0.0.1:54543`, but Docker's runtime `.NetworkSettings.Ports` values were null and `docker port` returned no mappings. Windows had no listeners on either port; HTTP and HTTPS requests returned `000`. We did not change firewall, global WSL, Docker Desktop, or host networking. This blocks founder browser preview.

Two exploratory probe details are not counted as product failures or successful gates: a helper first run from the WSL distro host could not resolve the Compose-only hostname `caddy` (`ENOTFOUND`) and was replaced with direct container-IP/TLS probes; an auxiliary `docker info` format query then requested the unsupported `.DefaultBridge` field. Network inspection still returned `Internal=true`, and the direct Caddy health request returned 200 before that formatting error.

The runtime directory's earlier `growth-container-inspect.json` capture predates the final Growth image recreation and has an old image ID. It is historical only. `growth-container-inspect-final.json` is the sanitized current-container receipt (image ID `sha256:64485db23a2e266439f6846c5404094a574174738855e66abf947bb54bc0b922`, healthy); it contains environment variable names but no values.

## Remaining runtime gates

Authentication and tenant isolation, public Meta/OAuth callbacks, a valid webhook against the main stack, a provider outage observed in Inbox, external alert receipt, partial/concurrent migration failures, database timeout/outage, abrupt worker crash after an accepted business side effect, backup restore, and production rollback compatibility remain unverified. No live provider calls, external alert sends, real merchant data, customer messages, orders, payments, or courier bookings occurred. A synthetic internal HITL notification was queued by the MANUAL-mode kill-switch probe; see 03. The detailed bounded results and independent receipts are in 03-04 and the machine-readable proof file.
