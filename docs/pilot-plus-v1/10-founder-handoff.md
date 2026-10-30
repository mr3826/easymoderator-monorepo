# Pilot+ V1 — 10. Founder Handoff

**Status: COMPLETE — ready for founder review. Nothing pushed, merged, deployed, or activated.**
The review lab is running right now on this machine; everything below is local-only.

## 1. What changed (and why)

Five merchant capabilities, one coherent loop — *customer intent → verified context → useful
interaction → operational state → merchant action → truthful outcome → measurable result* —
plus four safety prerequisites. Full decision record: `PILOT_PLUS_V1_MASTER_DECISION.md`.

| ID | What the merchant/customer experiences | Why (verified problems from source audit) |
|---|---|---|
| P+01 Inbox Lead Intelligence | Serious buyers are flagged inside the Inbox with the WHY (recorded reason codes), and contacted/dismissed there — the same authoritative record as Customers/360 | The opportunity engine existed but lived one page away; inbox is where merchants live |
| P+02 Structured Customer Choices | Customers tap ≤20-char choices (delivery info / talk to a person / review-change-cancel-confirm) in Bangla/Banglish/English; typed replies keep working; taps cannot fake authority | Long typing kills mobile sales; buttons must never become a side door |
| P+03 Merchant Action Queue | One ranked "what needs me now" list (needs-human → failed acknowledgment → blocked checkout → drafts → opportunities → knowledge gaps), computed live from truth — nothing stale, nothing invented | Attention was scattered across tabs; a second task DB would lie |
| P+04 Context-Preserving Checkout | Asking "delivery charge koto?" mid-checkout gets a grounded answer and the cart resumes where it stopped; "let me talk to someone" PAUSES instead of destroying the cart; only an explicit cancel cancels | Audit confirmed real defects: questions were stored as the customer's NAME; status-lookups killed new carts |
| P+05 Actionable Knowledge Gaps | Recurring unanswered questions become one-click reviewable suggestions; payment/delivery ones point to SETTINGS (the real source), policy ones to a merchant-written FAQ answer; dismissed items only return if customers genuinely keep asking | Gaps were a read-only table; nothing closed the loop |
| Prereq P0-1/P0-2/P0-3 + F3 | Meta outside-window sends now HOLD instead of attaching tags Meta retired on 2026-04-27 (those sends were failing); the dead "screenshot = payment confirmed" branch is removed and made un-reachable; disabling a payment rail removes it from every surface; conversational orders stop being mislabelled 'draft' | The three Domain-Engine P0s — verified present in this tree and unowned elsewhere |

Every new surface is behind a per-shop platform flag (default OFF, SUPER_ADMIN-controlled, kill
switch covers everything including in-flight choice taps). No automated outreach exists anywhere.

## 2. How to review (5 minutes, zero setup)

Lab stack already running (started via `scripts/pilotplus-lab.ps1` — rerun that any time; `-Down` stops).

- **Web app:** http://localhost:5173 · **API health:** http://localhost:3000/health (200)
- **Shop A — "Rina Boutique (Live Seller)"** — ALL Pilot+ flags ON, AI mode DRAFT:
  sign in `pilot.a.owner@lab.easymod.local` / `PilotLab@2026!` (staff view: `pilot.a.staff@…`, same password)
- **Shop B — "TechGadget BD"** — ALL flags OFF (control): `pilot.b.owner@lab.easymod.local` / `PilotLab@2026!`

Local-only synthetic credentials; no production data; no live Meta connections.

**Journeys (Shop A):**
1. **Inbox →** queue strip lists ranked work ("customer needs a human" first). Thread row **"Rima (serious buyer)"** shows a *Strong interest* chip → open: reason strip (purchase intent + abandoned checkout) + *Mark contacted* / *Dismiss* — the same record Customers→Opportunities shows.
2. **"Karim Uddin"** (needs-human): Resolve dialog → note required → assigning/claiming shows "Assigned"; try takeover as the STAFF account while the owner holds it → honest conflict message, never silent overwrite.
3. **"Sabbir"** — order was confirmed but the customer message failed: queue bucket 2 surfaces it; thread shows recovery state, never fake "sent".
4. **"Jahid"** — cart paused by his delivery question (phone field still pending, nothing overwritten); **"Akram"** — cart SUSPENDED behind a human request; typing "continue" later resumes the exact step.
5. **FAQ Settings** (shop A) — "Questions customers keep asking": the bKash one routes to Payment settings (the rail is disabled — no FAQ prose wins over config); the exchange one opens merchant authoring → publish flows through the real FAQ+RAG lifecycle.
6. **Shop B** — none of the above exists there: no chip, no queue, no suggestions, MANUAL mode untouched.

Screenshots of all of this, captured from the live app by automation:
`docs/pilot-plus-v1/walkthrough/01…08*.png` (+ mobile 375px shot).

## 3. What passed (with commands — full table in 07/09)

| Evidence | Command (repo root, node 20) | Result |
|---|---|---|
| Backend units | `npx jest --coverage=false --testTimeout=30000` (EasyMod-backend) | 4163/4169; the 3 red suites are V1.3 lab-tooling tests that fail *more* at the pristine baseline (06/A2) |
| Real-stack integration | `npm run test:backend:integration:docker` | **29/29 suites, 206/206** incl. both new migrations + cross-capability scenario suite |
| Meta-shaped E2E | `npm run test:backend:meta:e2e:docker` | **48/48** (signed webhooks, receipts, dedupe, sends) — fake transport only |
| Security perimeter | `npm run test:security` | **802/802** |
| Frontend | `npx vitest run` · `npx tsc --noEmit` · `npm run build` | 628/628 · clean · built |
| Browser journeys | `npx playwright test pilot-plus` (chromium & firefox) | 7/7 each (WebKit blocked by a pre-existing baseline harness limitation, documented) |
| Performance | `node scripts/pilotplus-perf.js` (disposable stack) | +6 ms inbox projection, 22 ms queue, ~1.7 ms per-turn tap read, 50 µs classification — all new queries index-scan <1 ms (08) |
| Independent verification | fresh agent, commands 1-8 | **IMPLEMENTATION_VERIFIED, fit to freeze, no new vulnerabilities** (09) |

## 4. What did NOT pass / unresolved risks

- 3 baseline-inherited red unit suites (V1.3 lab tooling + 2 load-sensitive grounding tests) — proven
  pre-existing (06/A2, 09#5); deterministic under single-worker convention; NOT quarantined.
- WebKit e2e sign-in: existing repo limitation (baseline specs fail there too) — Chromium+Firefox cover the journeys.
- Meta API facts came from secondary-consistent sources (developer docs are login-walled) — assumption A-1 in doc 05; the implemented behavior is the conservative one (hold, not tag) regardless.
- HUMAN_AGENT permission is NOT assumed held; the flag path exists but is inert until App Review grants it (09 observation: a row stranded by a mid-crash self-heals at expiry).
- Auto-resume on merchant resolution deliberately NOT implemented (06/A5): the customer's next message resumes — chosen to avoid pushing customers back into abandoned carts.
- Pilot metrics are instruments, not results (08): no ROI claimed, cohorts/rollout authorization pending.

## 5. What remains (founder decisions — none block review)

1. **Cohort selection + flag enablement** (SUPER_ADMIN per-shop; keep `interaction_choices` off until a Page is connected and tested in sandbox).
2. **Meta App Review** decision for Human-Agent permission (unlocks the HUMAN_AGENT path only then).
3. **Pilot period** per 08 §2 (2-week baselines first), then metrics review.
4. Integration/merge coordination with the other active workstreams that touch neighbouring files (02 §0: orders-workspace-v2, v6-action-first, mobile) — rebase-then-merge order documented; nothing from this branch may be pushed to production without explicit authorization.
5. Optional backlog: interaction/suggestion retention sweep (90d), CLARIFY trigger breadth, Utility-Message migration.

## 6. Release posture

`PRODUCTION_RELEASE_AUTHORIZED=NO` · PUSHED=NO · MERGED=NO · DEPLOYED=NO.
Other agents' worktrees/processes untouched (verified again by the independent verifier: only its own
disposable stacks existed during its run). Stop the lab any time:
`powershell -File scripts\pilotplus-lab.ps1 -Down` (data stays in the local dev volume; delete
`D:\easymod\_wt-pilotplus-v1` + its branch to discard everything — nothing else on this machine references it).
