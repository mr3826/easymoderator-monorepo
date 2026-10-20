# Baseline vs Action-First comparison (same synthetic fixtures)

Method: interaction counts are derived deterministically from the shipped
navigation/URL structure at `07168f49` (baseline) and at this branch
(after), then re-walked in the browser against the seeded local review stack.
No completion-time uplift percentages are claimed; wall-clock tasks vary by
operator and the sample is synthetic fixtures, not real staff.

## S1 — finish a known overdue follow-up (Growth user, sign-in excluded)

| Metric | Baseline (07168f49) | After |
|---|---|---|
| Landing content when work exists | Count cards only ("2 overdue follow-ups assigned to you") — no rows, no per-item route | Ordered queue: first row is the actual overdue item with "why" and one action |
| Interactions Home→record | 2 (Home → "Review in My Work" → locate row in 50-row table) | 1 (queue row → "Open and record" straight to the prospect with panel) |
| Interactions to complete | 1 ("Complete" instant) | 3 (Complete → choose typed outcome → Record and complete) |
| Outcome captured | None (schema recorded status only) | Enum outcome + optional reason on audited event/audit |
| Ambiguity | Which prospect is overdue required table scanning | Row names prospect and age; segments sorted by urgency |
| Net | 3 interactions, no outcome discipline | 4 interactions with persisted, auditable outcome — deliberate trade of one step for data truth |

## S2 — add a new lead

| Metric | Baseline | After |
|---|---|---|
| Entry points competing | Sidebar "Quick Add" as its own destination + "New prospect" button | One dominant **Add prospect** (header + Today); quick path kept inside the Leads flow |
| Duplicate enforcement | Client preflight + server 409 (unchanged, verified) | Same canonical path; Bangla/+880 anchor fixture demonstrated |
| Steps capture→assign→schedule | unchanged | unchanged (no capability removed) |

## S3 — stalled onboarding investigation

| Metric | Baseline | After |
|---|---|---|
| Path | Home count card → prospects filtered list → open record | Queue segment row → same record; admin sees identical cohort drill from /admin |
| Why-shown | Count only | Row states "Still onboarding since N days ago" from `statusChangedAt` |

## A1 — platform incident investigation (Super Admin)

| Metric | Baseline | After |
|---|---|---|
| Admin-specific landing | None; Super Admin home == Growth home with two extra KPI blocks | `/admin` Attention landing as default context |
| Payment-stuck signal | Card with count, no next step, no honesty note | Card + explicit "no record-level identification" note + Operations drill (truth preserved) |
| Suspended subscriptions | Card count only | Card + honest drill to merchant records (list shows plan/status per shop) |
| Merchant audit trail | Sidebar Audit destination only | Privileged trail on landing + Audit drill |

## A2 — staff management

| Metric | Baseline | After |
|---|---|---|
| Nav | "System" group with two destinations | "Team & Access" grouping (same routes, same guards) — grouping-only change; steps unchanged |
| Flow create→grant→MFA→revoke | Fully preserved (admin-journey E2E) | Same, verified again on this branch |

## Measured after-values (browser, owned local review stack + Playwright)

- S1: from cold landing on Today, the first overdue item is reachable with
  1 click to the record ("Open and record"), outcome recorded in 2 further
  interactions; completion persisted and re-read from the audited timeline
  in `action-first.spec.ts` (E2E 39/39 pass incl. this flow, 320 px
  overflow check ≤1 px, 403 direct-API matrix).
- A1: Super Admin lands in Admin Control by default; the payment-stuck card
  is visibly aggregate-only (seeded stuck fixture verified count=1 after
  the seed timestamp fix), stalled cohorts drill to exactly the counted
  population, and the privileged trail shows reason-bearing reconnect
  entries in the live UI (screenshot `admin-attention-1440.png`).
- Screenshots (admin attention, admin→sales nav switch, sales Today queue,
  outcome form, performance sources tab, 390 px queue) captured via
  `node scripts/growth-review/capture-review-screens.js` into gitignored
  `.growth-review/screenshots/`.
- Console-error and horizontal-overflow checks run inside the E2E specs;
  no failures reported by the suite.
- "Before" screenshots were not captured: rebuilding the 07168f49 SPA
  against the shared review backend would have contended with other
  agents' Docker resources; baseline claims above are therefore derived
  from the shipped pre-change code paths (exact file/line behavior), not
  from a re-run of the old UI. No percentage uplift is claimed.
