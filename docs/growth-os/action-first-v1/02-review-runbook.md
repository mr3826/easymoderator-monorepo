# Growth OS Action-First V1 — Local Founder Review Runbook

Owned, persistent, loopback-only review stack. It does **not** replace
`npm run test:growthos:e2e` (which still tears down its own disposable stack)
and never touches another agent's Compose project, ports, or volumes.

## Commands (repo root)

| Command | Effect |
|---|---|
| `npm run growth:review:up` | Build + start the owned project `em-growth-review-<id>` (unique network/volumes, free loopback port starting 4290), run migrations |
| `npm run growth:review:seed` | Fresh strong local password + fresh TOTP secrets; synthetic BD fixtures; credentials written ONLY to gitignored `.growth-review/credentials-*.md` (0600 where supported) |
| `npm run growth:review:health` | Self-diagnosis: services, SPA, backend health, auth 401 gate, local-only env/provider-disabled, fixture receipts. Prints PASS/FAIL per check and refuses "ready" on any failure |
| `npm run growth:review:test` | HTTP-level smoke running REAL sign-in + MFA + role checks (admin aggregates, sales 403s, merchant isolation, duplicate 409, typed-outcome completion, reconnect-request audit) |
| `npm run growth:review:code admin\|sales` | Current 6-digit TOTP code for local walkthroughs (reads the local receipt only) |
| `npm run growth:review:reset` | Verified teardown of ONLY this owned project (with volume) then up+seed again |
| `npm run growth:review:down` | `down --volumes --remove-orphans` after re-verifying the `em-growth-review-` project prefix; removes receipts |
| `npm run growth:review:status` | Show owned project + URL |

Isolation properties: unique Compose project/network/volume names, `127.0.0.1`-only
port binding, dedicated disposable DB name (`easymod_growth_review_<id>_test`,
enforced by the same whole-word `test|e2e` guard the E2E suites use),
`GROWTH_REVIEW_MODE=true`, no production env vars, no outbound Meta/payment/
messaging credentials present (health check verifies), zero real customer data.
`down`/`reset` refuse any project name not starting with `em-growth-review-`
and only ever operate via `-p <recorded-owned-project>`.

## Accounts (seeded; roles are canonical and MFA-gated)

| Purpose | Email | Notes |
|---|---|---|
| Review Super Admin | `growth-review-admin@example.test` | Password + TOTP from receipt. Lands on **Admin Control** context |
| Review Growth User | `growth-review-sales@example.test` | Password + TOTP from receipt. **Sales & Growth only** |
| Plain merchant | `growth-review-merchant@example.test` | Password only; every Growth surface must reject |

Password/TOTP values live only in `.growth-review/credentials-<project>.md`
(gitignored; never committed, never echoed to CI).

## Seeded synthetic scenarios (all `.test`, zero outbound)

- 3 BD-flavoured shops (explicitly labelled synthetic, not demographic claims):
  suspended subscription + stuck >24h payment (ops), expired Meta channel
  (F-commerce), hobby seller with first AI reply = **AI activated**.
- 10 prospects covering new/unclaimed, qualified-unassigned (incl. Bangla
  names), onboarding-stalled 20d, qualified-stalled 30d, contacted, converted
  (activated), unreachable, and a duplicate-detection anchor
  (`+8801710000199`).
- 3 open follow-ups (overdue for sales, due-today Asia/Dhaka for sales,
  overdue for admin) + typed-note timeline entries + audit receipts.

## Guided walkthrough A — Admin Control

1. `npm run growth:review:code admin`; open the printed URL; sign in as the
   admin email + receipt password; submit the 6-digit code.
2. Land: **Attention** (Admin Control context; sidebar shows Control,
   Merchants, Team & Access).
3. Read the payment-stuck card: notice it is honest about being a platform
   aggregate with no record-level identification → *Open Operations*.
4. Back to Attention → *Merchants needing support investigation* →
   *View stalled cohort* → cohort of exactly the counted population.
5. Team & Access → Growth Users → review staff/MFA columns; (optional) create
   a shop-less staff user with a reason, observe the one-time password panel,
   then suspend/revoke and see session rejection on the next sign-in attempt.
6. Audit: open Audit and find the reason-bearing entries (including any
   reconnect request made via a Merchant 360 → channels → Reconnect request).

## Guided walkthrough B — Sales & Growth

1. Sign in as the sales email; land on **Today** — ordered queue: overdue →
   due today → qualified-unassigned → stalled onboarding → new unclaimed.
   Each row shows why it is there.
2. Click a queue row → prospect record with full context (no extra lookup);
   in Follow-ups record a completion **outcome** (typed) + reason; verify the
   audited timeline now carries it.
3. Header **Add prospect** → enter `+880 1710-000-199` → observe the enforced
   duplicate review; change the phone → create; assign; schedule next step.
4. Open *Onboarding stalled* segment → a record → linked merchant insight is
   masked (no admin identifiers); note the **AI activated** explainer copy.
5. Growth Performance → Funnel & Source attribution tabs; unavailable metrics
   remain `Not reported`, never 0.
6. Narrow window (320–390 px): queue rows stack; no horizontal scrolling.

## Stop / hygiene

- Stop sharing with `npm run growth:review:down` (removes volumes + receipts).
- Re-run everything from scratch with `npm run growth:review:reset`.
- The stack persists between commands by design (`restart: unless-stopped`).
