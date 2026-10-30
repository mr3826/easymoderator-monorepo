# 08 — Founder authorization package (one consolidated response)

**What is now true (each item links to reproducible receipts):**

1. A founder-accessible authenticated preview exists on the founder's own machine: `https://127.0.0.1:54680` (loopback only, self-signed cert, synthetic merchants `closure.{a,b}.owner@ops.easymod.test`, password in the external ops-browser.env). Sign-in, Inbox/Customers/Orders data, cross-tenant denial (404), and a truthful `FEATURE_DISABLED` action-queue were all verified from the Windows host on 2026-10-30 (`01`; `preview-walkthrough-20261030.json`). Nothing was published beyond loopback; no auth/cookie policy was weakened.
2. The artifact that *would* be promoted is fully identified locally (`02`): source `04b07134…` byte-verified twice, image `3367c27e…` runtime self-reporting the same SHA. **What is NOT available:** the immutable digest of the currently deployed image — it exists only in `/opt/easymod/deployment-metadata.json` (and GHCR history). Rollback compatibility therefore stays unproven and the release gate stays blocked until the owner reads that file (one command, digests only, no secrets).
3. The alert pipeline demonstrably delivers to a destination (`03`): synthetic fault → durable receipt → hash-only destination receipt (`a6200c44…`) → reconciler recovery → cleanup, all inside the isolated no-egress stack, zero external calls, zero paid inference. Production destination + named human ack are still missing by design — that is decision D-3.
4. Every production-risk mutation surface is fail-closed at source, strict-literal, test-pinned, and was re-verified in the candidate code itself (`04`) — including the corrected photo-matching default (now OFF, `vision-policy.service.js:40`).
5. The complete Trivy scan (vulnerability + secret + misconfiguration) that previously timed out is now finished (`05`): zero HIGH/CRITICAL everywhere; one MEDIUM (`qs` 6.16.0, fix 6.16.1 available) needs a one-line owner disposition.
6. Prior completed gates (Product Engine, Pilot+, Merchant Workspace, integration, deployment rehearsal, operational-gate closure incl. 32/225 integration, full suites, meta E2E, backup/restore, worker recovery) remain valid and were not re-run without reason; today's additional re-passes (authenticated journeys on the fresh DB) exist because the preview/DB reset changed runtime state.

**What only the founder can supply — answer as one record:**

| # | Item | Recommendation | Blocks pilot? | Your answer |
|---|---|---|---|---|
| 1 | D-1 cohort + thresholds | One opted-in shadow/manual shop, flags OFF, measured stop conditions | YES | ☐ |
| 2 | D-2 Meta console current state | Confirm Human-Agent eligibility + email/support/data-deletion URLs | YES for AI modes | ☐ |
| 3 | D-3 alert channel + on-call | Name them; run test-alert; human ack recorded | YES | ☐ |
| 4 | D-4 kill-switch operators | Named per level; two-person rule on global mutation flags | YES | ☐ |
| 5 | D-5 mobile exclusion | Accept limitation; exclude from pilot scope | No | ☐ |
| 6 | D-6 UX debt acceptance | Defer with Inbox guarantees pinned as release condition | No | ☐ |
| 7 | D-7 auto-booking stance | Keep OFF, manual dispatch | No (safe default) | ☐ |
| 8 | Image-transfer condition | Keep photo matching OFF; approve provider terms before any enablement | YES for photo features | ☐ |
| 9 | `qs@6.16.1` disposition | Ship bump increment before deploy (recommended) | Low risk either way | ☐ |
| 10 | Droplet digest read (or delegate) | `deployment-metadata.json` digests → unblocks rollback proof | YES for release (rehearsal-only pilot unaffected if deploy path stays blocked) | ☐ |
| 11 | Preview walkthrough | Founder login on item-1 URL closes B-1 | Confirmatory | ☐ |

**If all blocking items are signed:** `TECHNICAL_PILOT_READINESS=GO_PENDING_FOUNDER_AUTHORIZATION` becomes the recorded state and the pilot proceeds only as shadow/manual, flags OFF, with D-3 monitoring live, on the promotion procedure pre-staged in `02` (still requiring the separate `DEPLOY-<SHA>` confirmation gate).
**If any remain unverified:** the recorded state stays `NO_GO_WITH_EXACT_BLOCKERS` with the unmarked rows above as the exact list.

Nothing in this package authorizes a push, merge, deploy, production flag change, merchant selection, provider spend, or image-data transfer. Those all remain separate explicit actions.
