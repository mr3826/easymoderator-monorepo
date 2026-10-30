# 11 — Founder GO / NO-GO

## Decision

**Rehearsal: PARTIAL. Pilot production release: NO-GO pending owner authorization and unresolved security, preview, monitoring, and recovery gates.**

The isolated stack built from application code SHA `6d6bc1dd056e09202b97d05e81f20308b15109ab` started, reported the exact SHA, passed core health/readiness, ran its migration dry-run, and exercised synthetic flag and queue-recovery scenarios. The review does not authorize production deployment, a merchant cohort, or live automation.

## What this rehearsal proved

- Source is isolated on `rehearsal/pilot-deployment-v1`, rooted at the verified frozen code/documentation pins. The exact code candidate was built into local backend/worker, merchant frontend, and Growth images with recorded immutable image IDs.
- The production-shaped eight-service Compose topology ran in dedicated WSL2 distro `EasyModPilotRehearsalV1` on an internal-only network. Backend, worker, Growth, Postgres, and Redis reported healthy. Backend readiness reported Postgres and Redis connected; Caddy's health, API-version, frontend, and Growth routes returned 200 internally.
- `/api/version` reported the tested code SHA, 66 migrations, and latest migration `20261026_001_order_idempotency_unique`.
- Core commerce mutation switches were false in both backend and worker. A synthetic global `CREATE_ORDER` was denied and audited; conversation pause and per-shop `MANUAL` mode suppressed synthetic worker actions. A missing-signature payment callback returned 503.
- The six-phase disposable production-shaped migration dry-run passed. A worker-stopped canary stayed queued and completed once under the dedicated worker. A pending no-send canary persisted across graceful Redis restart. Graceful full-stack stop and restart completed.
- Backend security passed 58 suites/813 tests; queue-manager startup boundary passed 4 tests; frontend passed 78 files/692 tests and the production build passed. A separate throwaway signed webhook replay/race harness passed 2 tests and was removed with its dedicated data volumes.
- No real customer data, message, order, payment, courier action, provider request, provider spend, or external alert was used.

## Why the verdict remains NO-GO

- Founder browser preview is BLOCKED. Caddy works from inside the rehearsal network, but Windows loopback ports 54580/54543 have no listeners. Docker records configured host bindings while runtime port mappings are null. No system networking settings were changed.
- The backend image build reported 3 high npm audit findings; security disposition is required before a pilot.
- No authenticated tenant workflow, public Meta/OAuth callback, valid payment callback to the primary stack, browser E2E, provider-outage UX, external alert receipt, partial/concurrent migration failure, abrupt worker crash after business side effect, database outage, backup restore, or prior-image schema rollback was verified.
- Slack is configured but Sentry is not. The synthetic alert was `NOT_RUN_EXTERNAL_SINK_CONFIGURED`; no alert was sent or received. Readiness health is not evidence that an operator can receive incidents.
- D-1 through D-7 remain owner decisions. The commercial reply path should remain `MANUAL`; photo matching, order/payment/courier automation, and webhook auto-booking remain off. Text-RAG order selection from accompanying text remains uncalibrated.
- Full default backend unit suite, Playwright, and Meta-shaped E2E were not completed in this final run. The completed final backend security suite and targeted runtime evidence do not substitute for those gates.

## Provider decision

**Recommendation: `KEEP_CURRENT_PROVIDER_CONFIGURATION`.** Existing OpenAI and Gemini adapters are present; no provider switch or routing framework is justified by this rehearsal. No live inference or spend occurred, and account billing, entitlement, spend cap, effective deployed model overrides, and cost per valid completed task remain unknown. Preserve the detailed official model lifecycle, API, cost, and data-handling analysis in 06-09. Keep customer-photo matching off until both provider image-data terms and owner authorization cover the existing Gemini-to-OpenAI fallback. This flag does not disable the separate text-only RAG order-selection path.

## Consolidated owner decision package

Resolve these together as detailed in [05-owner-decisions-d1-d7.md](05-owner-decisions-d1-d7.md):

1. **D-1 cohort:** defer live traffic until runtime and governance gates pass; then consider at most one opted-in shadow/manual shop for workflow learning. Name coverage and measurable reply-safety, false-hold, missed-reply, wrong-catalog, spend, and operator-load thresholds with denominators.
2. **D-2 Meta:** no new Graph scopes are proposed. The Meta app owner must confirm current Human-Agent eligibility and close contact/support/data-deletion metadata gaps.
3. **D-3 monitoring:** name the alert channel, dashboard, and on-call owner; reconcile audit-action queries and verify a synthetic alert reaches that operator.
4. **D-4 switches:** keep mutations off; name switch operators and a second approver, then confirm the production observation path.
5. **D-5 mobile:** accept the missing `POST /api/mobile/products/images` endpoint for the controlled Messenger scope and keep mobile API disabled.
6. **D-6 V6/Phase-D:** accept or defer the listed UX debt only while preserving the reviewed Inbox draft, send, and reply-window guarantees.
7. **D-7 dispatch:** keep webhook auto-booking off and dispatch manually; any later enablement needs explicit owner authorization and main-stack replay/rollback evidence.
8. **Photo data:** separately approve or reject customer-image transfer to Gemini and the possible OpenAI fallback; keep photo matching off until then.

## Preview and evidence location

**FOUNDER_PREVIEW=BLOCKED.** The environment is in the dedicated distro `EasyModPilotRehearsalV1` under `D:\easymod-runtime\pilot-deployment-rehearsal-v1`. The Compose overlay and isolated bootstrap scripts are in this directory. The image IDs, redacted config fingerprint, command outcomes, and runtime probe summary are recorded in 01-04 and `rehearsal-proof.json`; detailed local logs are under the runtime path above.

**FINAL_RUNTIME_STATE=STOPPED.** After the final independent receipts were captured, all eight containers in the named rehearsal project were gracefully stopped. Named volumes and the dedicated distro remain preserved.

`SOURCE_CODE_SHA=6d6bc1dd056e09202b97d05e81f20308b15109ab`.

`SOURCE_DOCUMENTATION_SHA=d5dbd21620a0b25b6c57763c2214a95c811c2fbb`.

`FINAL_SHA` is the final local evidence commit reported in the handoff response; it changes evidence/docs only after the tested application code SHA above. No push, merge, or deployment is authorized by this package.
