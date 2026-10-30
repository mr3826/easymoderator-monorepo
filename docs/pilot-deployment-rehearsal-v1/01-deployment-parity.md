# 01 — Deployment parity

The production reference is `docker-compose.prod.yml` at frozen documentation tip `d5dbd21620a0b25b6c57763c2214a95c811c2fbb`. The isolated rehearsal merged that topology with the local overlay and built app images from code SHA `6d6bc1dd056e09202b97d05e81f20308b15109ab`. The configuration parsed, services started, and internal routing passed. Overall deployment equivalence is **PARTIAL**.

| Area | Production reference | Rehearsal observation | Classification |
|---|---|---|---|
| Service topology | Caddy, backend, BullMQ worker, merchant frontend, Growth frontend, Postgres 15, Redis 7, Qdrant | All eight services ran in isolated project `easymod-pilot-rehearsal-v1`; no production/shared service was used | ACCEPTABLE_SIMULATION |
| App images | Immutable production GHCR images | Backend/worker, merchant frontend, and Growth images were built locally from the exact rehearsal code SHA | NON_EQUIVALENT to the published production artifact; rehearsal provenance is pinned locally |
| Postgres / Redis | Pinned production definitions, persistent volumes, production dependency checks | Isolated local Postgres and Redis ran and reported healthy; disposable migration and queue tests used isolated data | ACCEPTABLE_SIMULATION |
| Qdrant | Pinned image and persistent volume | Container started on the internal network; no app operation requiring a production Qdrant corpus was certified | PARTIAL |
| Backend and worker | Separate commands, same backend image, health/dependency sequencing | Same image ID; backend and dedicated worker both healthy. API runtime `START_EMBEDDED_WORKERS=false`; queue consumers start in the worker process | ACCEPTABLE_SIMULATION |
| Merchant and Growth frontend | Immutable production images behind Caddy | Locally built images started; Caddy served both internally; Growth healthcheck returned 200 | ACCEPTABLE_SIMULATION |
| Reverse proxy and TLS | Public DNS and managed certificates | Local Caddy CA and loopback hostnames; internal TLS route returned 200. Windows host ports did not forward | NON_EQUIVALENT |
| Webhooks and callbacks | Public Meta/OAuth/callback reachability | No public URL, external OAuth, real Meta callback, or shared-stack valid payment callback; a missing-signature synthetic callback returned 503 | NON_EQUIVALENT |
| Network egress | Approved production integrations | Compose network is explicitly internal; no live provider calls or external merchant integrations | NON_EQUIVALENT by design |
| Secrets | Production secret injection | Ignored local env contained synthetic/disabled placeholders only | ACCEPTABLE_SIMULATION |
| Commerce flags | Production renderer defaults global commerce mutation switches off | Backend and worker runtime both reported domain runtime, order, courier, payment, and support mutation flags false | EQUIVALENT for observed flags |
| Photo matching | Production renderer defaults `AI_PHOTO_MATCH_ENABLED=true` | Rehearsal overrides it to false in backend and worker; `AI_VISION_ENABLED=false` | NON_EQUIVALENT, deliberate safety override |
| Migrations | Production Compose disables startup migrations; runbook applies explicitly | Six-phase disposable Postgres dry-run passed. No shared or production database was used | ACCEPTABLE_SIMULATION |
| Persistent recovery | Production named volumes plus host backup/restore | Isolated named volumes persisted through graceful Redis restart and full stack stop/start; no backup restore or PITR drill | PARTIAL |
| Monitoring | Sentry/ops alert and named operator | Readiness and SSE health passed. Slack was configured, Sentry was not; no synthetic alert was sent or received | PARTIAL |
| Shutdown/restart | Production restart/dependency behavior | Graceful full stop exited cleanly; full `up -d --wait` returned healthy containers. Separate worker/Redis recovery also passed | ACCEPTABLE_SIMULATION |
| Host preview | Operator/browser access to pilot URL | Caddy passed internally, but Docker runtime port mappings were null and Windows loopback connections failed | BLOCKED |

## Local artifact and configuration identity

The Compose merge fingerprint is SHA-256 `372d979a0b5de7b578c0578f917d749ff60c7908557a734efa336b1ce8b303db`. It was computed from canonical rendered JSON after replacing values of secret/token/password/auth/connection credential fields with `<redacted>`; 52 fields were redacted. No rendered configuration or secret value is included here.

| Service image | Local immutable image ID |
|---|---|
| Backend and worker | `sha256:510f16e2ccbf930cc1e6d8404eacad76944d99588e35eda231a45f6a90763b9d` |
| Merchant frontend | `sha256:6839e5de30384ed968e6fc0bdfa38aa0cf9d6bd64a8759125ae93b84b0b7e299` |
| Growth frontend | `sha256:64485db23a2e266439f6846c5404094a574174738855e66abf947bb54bc0b922` |
| Caddy | `sha256:86deaf5e3d3408a6ccec08fbb79989783dd26e206ae10bcf78a801dc8c9ab794` |
| Postgres | `sha256:df7bca0066e6f60cc3dd32faa70caddec20e2c22b58932f79498e5704b23854a` |
| Redis | `sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99` |
| Qdrant | `sha256:b3063c673f3973877c038eeecc392bad5011f072ee7892b56c9a8e204a3bdea9` |

Backend `/api/version` and `/health/ready` both reported the full SHA `6d6bc1dd056e09202b97d05e81f20308b15109ab`; 66 migrations were present, latest `20261026_001_order_idempotency_unique`. Caddy internal routes `/health/live`, `/health/ready`, `/api/version`, `/`, and `/growth/health/ready` returned 200 during the rehearsal. The Windows preview failure is a real usability blocker even though internal routing works.

After the independent operational receipts were captured, all eight containers in `easymod-pilot-rehearsal-v1` were gracefully stopped. The named volumes and dedicated WSL2 distro were retained; no `down --volumes` or other project cleanup was run.

The backend image build's npm audit reported **3 high vulnerabilities**. They were not silently waived or fixed during this bounded rehearsal and remain a pilot release blocker pending security disposition.

`config --quiet` and the fingerprint establish the local merged manifest only. They do not establish GHCR reproducibility, public callback access, production secrets, live merchant behavior, a production corpus, or rollback compatibility.
