# 01 — Deployment parity

The production reference is docker-compose.prod.yml at the frozen docs pin. The committed rehearsal overlay parses successfully against it, but no image digest or running service was obtained. Overall deployment equivalence is PARTIAL.

| Area | Production reference | Local rehearsal treatment | Classification |
|---|---|---|---|
| Service topology | Caddy, API backend, BullMQ worker, merchant frontend, Growth frontend, Postgres 15, Redis 7, Qdrant | Same services and production Compose dependencies; separate Compose project | ACCEPTABLE_SIMULATION |
| App images | Immutable GHCR references | Built locally from one rehearsal SHA; final images were not built or digest-pinned | NON_EQUIVALENT |
| Postgres | Pinned Postgres 15 image, persistent volume and health check | Same production Compose definition and isolated named volume; no container ran | EQUIVALENT configuration only |
| Redis | Pinned Redis 7 image, AOF, 256 MB and noeviction for BullMQ | Same production Compose definition and isolated named volume; no container ran | EQUIVALENT configuration only |
| Qdrant | Pinned image and persistent volume | Same definition; no runtime health check was observed | EQUIVALENT configuration only |
| API and worker | Separate commands, same immutable backend image, health checks, database/Redis dependencies | Local build from the rehearsal tree; synthetic env and no runtime | ACCEPTABLE_SIMULATION |
| Merchant and Growth frontend | Immutable production frontend images behind Caddy | Local builds; frontend compile passed, Growth image was not verified | ACCEPTABLE_SIMULATION |
| Reverse proxy and TLS | Public DNS and Let's Encrypt certificates | Caddy local CA, localhost hostnames, ports bound only to 127.0.0.1:54580 and 127.0.0.1:54543 | ACCEPTABLE_SIMULATION |
| Webhooks and callbacks | Public Meta callback/OAuth URLs and external reachability | No public callback, real OAuth, real Meta request, or reachable provider endpoint | NON_EQUIVALENT |
| Network egress | Production integrations require approved external APIs | Rehearsal project network marked internal; no live provider calls permitted | NON_EQUIVALENT by design |
| Secrets | Production secret injection | Ignored local file containing synthetic values; no real credentials | ACCEPTABLE_SIMULATION |
| Commerce flags | Production renderer strictly defaults global commerce switches to false | All commerce switches explicitly false in the local rendered env and overlay | EQUIVALENT configuration claim; runtime NOT VERIFIED |
| Photo matching | Production renderer defaults AI_PHOTO_MATCH_ENABLED to true | Overlay forces AI_PHOTO_MATCH_ENABLED=false and AI_VISION_ENABLED=false to prevent provider activity | NON_EQUIVALENT, deliberate safety override |
| Migrations | Production Compose disables startup migrations; deployment runbook applies them as an explicit step | No migration container/command executed | NON_EQUIVALENT / NOT RUN |
| Persistent recovery | Production named volumes; host backup and restore evidence required | Fresh project volumes configured, but no backup, restore, or recovery drill | UNKNOWN |
| Monitoring | Production Sentry/ops-alert configuration and an owner-operated channel | Synthetic rehearsal has no verified destination or received alert | NON_EQUIVALENT |
| Shutdown/restart | Production restart policy and service dependency order | Compose config only; no start, stop, restart, or readiness evidence | NOT RUN |

Compose syntax and merge validation proves that the overlay is accepted by the Compose parser and retains the named production service topology. It does not prove that production images, secrets, networking, callbacks, database contents, health checks, or rollback behavior are equivalent.

The overlay intentionally avoids host-wide ports, real app credentials, real provider keys, public callbacks, and unrestricted outbound requests. The app image tags include the rehearsal code SHA, but no reproducible image digest exists because the Docker daemon failed before final builds completed.
