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
| Backend security suite | npm run test:security -- --silent: 58 suites and 812 tests passed, exit 0. |
| Interaction regression suite | Interaction service plus worker reply-mode coverage passed 47/47 with Jest --forceExit. Added assertions cover generated/unsent choices, replay after consume, per-shop flag revocation, worker no-send behavior, and SENT-only numeric lookup. |

The frontend unit run emitted existing non-fatal test-environment warnings, including a local CSRF request to an unstarted localhost service. No live provider or external merchant request was made.

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
