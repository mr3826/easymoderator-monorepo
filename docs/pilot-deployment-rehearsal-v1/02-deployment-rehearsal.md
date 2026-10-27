# 02 — Deployment rehearsal

## Result

DEPLOYMENT_REHEARSAL=PARTIAL. The manifest and host-side app checks passed, but no production-shaped service stack started. No database migration, authenticated request, queue probe, synthetic webhook, audit delivery, clean shutdown, or restart was observed.

## Checks that passed

| Check | Evidence |
|---|---|
| Production Compose merge | docker compose with docker-compose.prod.yml and the rehearsal override, using the isolated project name, config --quiet exited 0 after image refs were pinned to 714be007. |
| Environment render | Local synthetic rehearsal environment passed the production renderer preflight with 90 variables. Only names and boolean flags were inspected; values were not emitted. |
| Frontend standalone dependency closure | Before the lockfile correction, standalone npm ci reproduced missing @axe-core/playwright and axe-core. After the correction, npm ci --dry-run --include=dev --ignore-scripts --no-audit --no-fund in the standalone child-package context exited 0 and resolved 450 packages. |
| Frontend unit tests | npm run test:unit -- --reporter=dot from EasyMod-frontend: 78 files, 692 tests passed, exit 0. |
| Frontend production build | npm run build passed with Vite 7.3.6, transforming 2,758 modules. The React vendor chunk was 549.55 kB and triggered Vite's large-chunk warning. |
| Backend build check | npm run build passed; the script performed node --check server.js. |
| Backend security suite | `npm run test:security -- --silent`: 58 suites, 812 passed, 0 skipped, exit 0 (recorded earlier against code SHA 714be007). |
| Interaction regression suite | Interaction service plus worker reply-mode coverage: 2 suites, 47 passed, 0 skipped, exit 0 with Jest `--forceExit` (recorded earlier against code SHA 714be007). Added assertions cover generated/unsent choices, replay after consume, per-shop flag revocation, worker no-send behavior, and SENT-only numeric lookup. |
| Full default backend suite, latest attempt | `npm run test --workspace=easymod-backend -- --runInBand` was interrupted with exit code 1 after BullMQ attempted `::1:6379` and `127.0.0.1:6379`, both returning `ECONNREFUSED`. No final totals were emitted and no successful Redis connection is evidenced. |

The frontend unit run emitted existing non-fatal test-environment warnings, including a local CSRF request to an unstarted localhost service. Its skip count was not retained in the execution record. No live provider or external merchant request was made.

## Build and runtime blockers

The first production-image build exposed the stale standalone frontend lockfile. The dependency entries were added and the standalone npm dry-run passed. A subsequent Docker build failed before producing verified images with failed to solve: input/output error. Read-only Docker diagnostics then failed on snapshotter I/O under the Desktop containerd store. The metadata database was read-only. Docker system usage could not be enumerated reliably, and no final image digests were captured.

The host reported C: free space as 0 bytes. The exact cause of the Docker storage error was not established. No attempt was made to delete user data, prune Docker resources, restart Docker Desktop, or stop other services. This task's own temporary diagnostic container was stopped; it could not be removed from the broken metadata store. No rehearsal service was started.

## Not established

- Built image digests and artifact/config fingerprint for a deployed stack.
- Backend, worker, frontend, Growth, Qdrant, Postgres, Redis, or Caddy readiness.
- Authenticated session and tenant behavior over the production proxy.
- Actual BullMQ queue health, webhook handling, audit records, or alert delivery.
- Migration startup sequencing, clean shutdown, or restart with pending work.

A future run must first recover Docker storage and host free space, then repeat all blocked gates against the pinned code SHA 714be0072b6c8a8bba181dbe814e284c3b342ffe.

## Follow-up runtime availability probe

The read-only default-context info probe produced no output for 30 seconds and was interrupted. A second read-only `docker --context desktop-linux version` probe produced no output for 60 seconds and was interrupted before `docker ps` could run. Docker Desktop processes were present and its `docker-desktop` WSL distro was running, but those observations do not prove the Docker API is usable. C: remained at 0 free bytes; D: had 125,862,297,600 bytes free.

The host had a loopback-only listener on 5173 owned by the existing `node.exe` under `D:\easymod\_local-runtimes`, and listeners on 6379 associated with Docker backend and WSL relay processes. Their underlying application/container was unknown, so no service connection was intentionally made. A later full backend Jest attempt did try localhost port 6379 through BullMQ; IPv6 and IPv4 connection attempts were both refused, and the suite was interrupted before final totals. No successful TCP connection is evidenced. No listener was present on Postgres port 5432; the initial inventory's 55432 and 56379 ports were not rechecked. `podman`, `nerdctl`, `postgres`, `pg_ctl`, and `redis-server` were not found on PATH. No isolated database/Redis target or usable container daemon was established. No Docker/WSL service, existing container, or owner process was restarted, stopped, pruned, or otherwise changed.
