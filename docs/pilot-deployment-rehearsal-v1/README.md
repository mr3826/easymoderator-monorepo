# EasyModerator Pilot Deployment Rehearsal V1

**Disposition: PARTIAL. Production release: NO-GO pending owner authorization and unresolved release gates.**

This is a completed isolated rehearsal for application code SHA `6d6bc1dd056e09202b97d05e81f20308b15109ab`. It built and started the production-shaped Compose topology in a dedicated WSL2 Docker Engine, exercised health/readiness, runtime flags, Action Gate controls, migration behavior, and synthetic queue recovery. It did not change production, use merchant data, call AI providers, send a real message, authorize a payment, or book a courier.

## What the rehearsal proved

- All eight services started from an isolated internal-only Compose project. Backend and worker use the same locally built image. Backend, worker, Growth, Postgres, and Redis reported healthy.
- Backend `/health/live`, `/health/ready`, and `/health/sse` returned 200. Readiness reported Postgres and Redis connected; the API reported the exact rehearsal SHA and 66 migrations. Caddy routed health, API, merchant frontend, and Growth health internally.
- Commerce and automation flags were false in both backend and worker containers. The global Action Gate denied synthetic `CREATE_ORDER` and wrote one audit row; conversation pause and per-shop `MANUAL` mode suppressed synthetic worker actions.
- A synthetic message job remained waiting with the dedicated worker stopped and completed once after that worker started. A graceful Redis stop/start preserved a pending canary, which completed after the worker returned.
- The six-phase disposable Postgres migration dry-run passed. Backend security tests passed 58 suites/813 tests, the worker-startup boundary passed 4 tests, frontend tests passed 692 tests, and the frontend build passed.

The primary evidence is in [00-source-and-environment.md](00-source-and-environment.md), [01-deployment-parity.md](01-deployment-parity.md), [02-deployment-rehearsal.md](02-deployment-rehearsal.md), [03-feature-flags-and-side-effects.md](03-feature-flags-and-side-effects.md), [04-migration-and-recovery.md](04-migration-and-recovery.md), and [rehearsal-proof.json](rehearsal-proof.json). Command logs remain under `D:\easymod-runtime\pilot-deployment-rehearsal-v1` and contain synthetic data only.

## Why this is still NO-GO

- The app healthchecks and Caddy routes pass inside the isolated WSL network, but Windows cannot reach the configured loopback preview ports. Docker reports the port bindings in `HostConfig`, while runtime port mappings are null and no Windows listener exists on 54580/54543. Founder preview is BLOCKED.
- Docker's backend image build reported 3 high npm audit findings. Resolve or explicitly disposition them before a pilot.
- No authenticated tenant workflow, public callback/OAuth, shared-stack valid webhook, partial/concurrent migration failure, abrupt worker crash after a business side effect, database outage/timeout, backup restore, or external alert receipt was verified.
- Slack is configured in the synthetic environment, so the synthetic alert sender was not invoked. No alert was sent or received.
- D-1 through D-7 still require owner decisions. AI reply mode must remain MANUAL; customer photo matching, commerce mutations, and webhook auto-booking stay off. The separate text-RAG order matcher remains uncalibrated.

See [05-owner-decisions-d1-d7.md](05-owner-decisions-d1-d7.md) for the consolidated founder package and [11-founder-go-no-go.md](11-founder-go-no-go.md) for the final disposition. Existing OpenAI/Gemini integration analysis and the recommendation to keep the provider configuration are preserved in 06-09. Live inference, provider spend, production changes, push, merge, and deployment are all `NO`/`NOT_RUN`.

## Isolated runtime

The named WSL2 distro is `EasyModPilotRehearsalV1`; its Docker data is on `D:\easymod-runtime\pilot-deployment-rehearsal-v1`. The stack uses project `easymod-pilot-rehearsal-v1`, an internal Compose network, named rehearsal volumes, and synthetic provider placeholders. The final clean shutdown/restart sequence is recorded in 04; no `down --volumes` was used for the main rehearsal project.

After the independent evidence run, all eight containers were gracefully stopped for handoff. The named rehearsal volumes and distro were retained.

Compose source is the production topology plus [docker-compose.rehearsal.override.yml](docker-compose.rehearsal.override.yml). [bootstrap-isolated-wsl-runtime.ps1](bootstrap-isolated-wsl-runtime.ps1) and [install-wsl-docker-runtime.sh](install-wsl-docker-runtime.sh) describe isolated provisioning. Do not treat internal Caddy success as an accessible Windows preview; no firewall, global WSL, Docker Desktop, or host-network changes were made to work around the port-forwarding failure.

## Review order

1. 00-source-and-environment.md — source pins, runtime isolation, and host-preview limit.
2. 01-deployment-parity.md — topology, image IDs, configuration fingerprint, and differences.
3. 02-deployment-rehearsal.md — build, tests, health, and runtime evidence.
4. 03-feature-flags-and-side-effects.md — flags, kill switches, worker boundary, and side effects.
5. 04-migration-and-recovery.md — migration, queue recovery, shutdown, and gaps.
6. 05-owner-decisions-d1-d7.md — one consolidated founder decision package.
7. 06-09 — current AI provider source, official API, cost, and privacy evidence.
8. 10-independent-attestation.md — review contexts and final independent QA.
9. 11-founder-go-no-go.md — final handoff.
10. rehearsal-proof.json and 12-execution-plan-and-skill-register.md — machine-readable result and execution record.
