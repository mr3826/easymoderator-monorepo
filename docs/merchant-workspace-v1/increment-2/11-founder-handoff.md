# 11 — Founder Handoff (Merchant Workspace V1 · Increment 2)

**Frozen candidate:** `a14fff7381830a73e3853609e98448cca0903188` on
`feat/merchant-workspace-v1-increment2` (worktree `D:\easymod\_wt-merchant-workspace-v1-increment2`),
a linear child of increment-1 `3d1bc0eb` (Pilot+ `9f562aaf`, main `07168f49`,
production `2a8c1e2d`). Nothing pushed/merged/deployed.

## What changed, in merchant terms

Opening a conversation now answers the five questions on one screen:

1. **Who is this customer?** — identity (name, Page, last activity) always;
   relationship (repeat-buyer state, delivered order count + delivered value,
   neutral delivery-risk note) when Customer Intelligence is on.
2. **What happened before?** — their real recent orders (by verified id, never a
   name guess) with a one-click jump to the exact order.
3. **What are they trying to do now?** — the existing lead strip + open orders.
4. **Who owns the next action?** — a live owner chip; Claim; Assign-to-teammate
   (from the shop's real staff list); manager take-over on conflict; resolution
   note. Every teammate's screen updates when someone claims.
5. **What happened after?** — ownership transitions are now audited server-side
   and visible; a policy-blocked AI reply says so truthfully instead of offering
   a doomed re-send.

Plus a lightweight CRM: **staff-private notes** (never sent, never in AI prompts)
and **bounded merchant tags**, and the action queue gained **server-counted work
views** (All open / Needs my attention / Unassigned / Human handoff / Send
recovery / Opportunities / Awaiting review).

## Why a merchant needs it

BazarLens reality: a live-selling BD merchant juggles dozens of DMs, often on a
phone, with staff handoffs. Before, confirming "the same as last time" meant
leaving the inbox to hunt the customer's history, and nobody could see who owned
a handoff. This keeps the facts, the owner, and the outcome in the one place the
merchant is already working. FieldFounder test: it removes navigation and
guessing rather than adding a dashboard.

## What is already verified

- **Real-stack integration (real Postgres):** 30/30 suites, 219 tests — including
  a new 13-spec suite proving cross-shop isolation, same-name non-collision,
  claim/409/force, notes/tags tenancy, content-free audits, queue counts.
- **Backend units:** 313/313 suites, 4214 tests. **Meta-shaped E2E:** 48/48, zero
  live sends. **Frontend:** 665/665, tsc clean, build green.
- **Browser:** 10 deterministic journeys on chromium AND firefox (incl. axe clean);
  5 live founder screenshots against the running lab.
- **Performance:** the new association filter adds ~0 latency (indexed, no N+1).
- **Pilot+ / increment-1:** all regression journeys still green; nothing rebuilt.

## What remains uncertain / not done

- **Combined release with v6-action-first / orders-v2 / mobile is NOT done** —
  the rehearsal proved v6's frontend line can't be merged at file level without
  breaking Pilot+ inbox behaviour; it needs its owner to rebase onto this line
  and re-validate. Mobile is contract-compatible (its endpoints are unchanged);
  it must re-sync onto the hardened `/api/mobile/inbox` reply contract later.
- **Live full-stack browser E2E of the mutation flows** is proven at the
  integration + deterministic-journey layer; the live walkthrough captures
  read-only states (Playwright's isolated storage races the per-context CSRF
  handshake — a harness detail, not app behaviour).
- **Production** is entirely unverified and unauthorized.

## Founder preview (running now)

- URL: **http://localhost:5173** (backend :3000, both from THIS worktree).
- Shop A (all flags on): `pilot.a.owner@lab.easymod.local` / `PilotLab@2026!`
  (staff: `pilot.a.staff@lab.easymod.local` / same). Shop B (control, flags off):
  `pilot.b.owner@lab.easymod.local`.
- Walk: Messages → open "Farhana (needs human)" → **Customer context** button →
  see ownership + claim/assign, relationship, notes, tags. Open "Rima (serious
  buyer)" → note + tag. Top actions strip → view chips. Shop B → the gated
  relationship section is absent and no gated request is made.
- Restart: `powershell -File scripts\pilotplus-lab.ps1` (from this worktree);
  reset demo state: `node EasyMod-backend/scripts/mwv1-reset-lab.js`.

## Screenshots

`walkthrough/01-context-panel-ownership.png` (handoff: ownership+relationship+
notes+tags), `02-queue-views.png`, `03-context-panel-rima.png`,
`04-shopb-flag-off.png`, `05-mobile-context-sheet.png`.

## Safe pilot-enablement sequence (no rollout authorized yet)

1. Founder reviews this candidate + preview.
2. Rebase/merge order: increment-2 is a linear child of increment-1 → Pilot+ →
   main. Merge increment-2 after increment-1/Pilot+ land; then v6 owner rebases
   onto it.
3. Enable per-shop behind the existing flags (customer_intelligence already
   gates the gated sections; notes/tags/queue are basic-authorized). Kill switch:
   disable the platform flags → panel collapses to identity+operations+ownership,
   queue views return to the plain list; no data loss (additive schema).
4. Cohort measurement (below) on real merchants before any broader rollout.

## Pilot measurement plan (Phase 11 — operational, real cohort only after authorization)

Denominators from real pilot data; no ROI claimed from synthetic fixtures.

- **Merchant effectiveness:** time to locate the relevant order/customer fact;
  time to first human action; unassigned-work age; resolution time; repeat
  handoffs; taps per completed issue (the panel's whole point is to cut this).
- **Sales workflow:** qualified-opportunity → committed-order conversion;
  interrupted-checkout recovery; delivered-order outcomes where available.
- **Reliability (must be zero):** wrong customer/order association; false
  business-state claims; cross-shop access; assignment-conflict mishandling;
  failed-send recovery success rate.
- **CRM usefulness:** note creation/usage rate; whether tags/views reduce
  navigation or missed work (not vanity counts).
- **Guardrails:** no tracking events carrying raw PII or conversation content;
  notes/tags are local to the shop; opt-out customers never get unsafe outbound
  actions.

## Verdicts

```text
IMPLEMENTATION_VERDICT=COMPLETE (independent review pending — doc 10)
COMBINED_INTEGRATION_VERDICT=PARTIAL (v6/orders-v2 deferred by design; increment-2 itself green)
PILOT_RELEASE_READY=YES_FLAGS_OFF_PENDING_AUTHORIZATION
PRODUCTION_RELEASE_AUTHORIZED=NO
```
