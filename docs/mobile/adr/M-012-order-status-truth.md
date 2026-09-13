# ADR-M-012: One Backend-Owned Order Status Projection for Mobile (No Enforcement Change Yet)

Status: Proposed<br>
Date: 2026-09-13<br>
Owners: Mobile Program Orchestrator + Backend

## Context

`CURRENT_STATE.md` §5 documents that the order state machine's declared states, the states
actually validated on transition, and the states actually written by mutating code paths disagree
with each other across three different vocabularies in the order module. Confirming an order also
auto-books a courier as a side effect. Cancellation is permitted after delivery; hard delete is
permitted for any role. Mobile's Orders screens (Phase 4) need one truthful, stable vocabulary of
statuses to render — building against three disagreeing vocabularies would make the mobile UI
wrong in whichever cases the vocabularies diverge.

## Decision (Phase 0 scope)

Phase 0 does not change any order-transition behavior. It records the problem and commits to
resolving it via a **separate, explicit ADR before Phase 4 writes any order-mutating UI**. Phase 0
and Phase 1–3 mobile work reads orders through one new backend projection function that maps the
existing, disagreeing internal representations to one documented external vocabulary mobile can
render safely as read-only status text — this projection is additive (a new mapping function) and
changes no write path.

The projection's behavior when the three underlying vocabularies genuinely disagree for a given
order is defined now, not left implicit: the projection never silently guesses a "best" status. It
returns a distinct external state, `STATUS_UNCLEAR`, carrying the raw underlying values in a debug
field visible only to the merchant as "status needs review in the web dashboard" (which still
displays whatever the legacy, inconsistent logic already shows) — never presented as a normal,
actionable status. Every occurrence is logged so Phase 4's follow-up ADR has real data on how often
this happens before it decides how to fix the underlying inconsistency.

The follow-up ADR (required before Phase 4) must decide, with backend and security sign-off:
whether to enforce the state machine at write time (rejecting invalid transitions server-side, a
behavior change requiring careful review of every existing caller including the web app and any
worker), and whether to separate "courier booked" from "order confirmed" into two explicit actions
instead of one implicit side effect. Phase 4 does not proceed past its architecture gate without
that ADR being written and reviewed.

## Assumptions

- A read-only status projection can be built without resolving the underlying inconsistency,
  because rendering "what state is this order currently in, as best the data shows" is a strictly
  easier problem than "what states are valid to transition through," and does not require changing
  any write path.
- The web app's current behavior (whatever it does with the inconsistent state machine today) is
  not itself part of this program's scope to fix — only mobile's read path and, later, mobile's
  write path via the follow-up ADR are in scope.

## Alternatives Rejected

- **Enforce a corrected state machine now, in Phase 0.** Rejected: a write-time behavior change to
  a shared, production order pipeline is exactly the kind of change that needs its own isolated
  review, its own test suite proving every existing caller (web, workers, webhooks) still
  transitions correctly, and its own rollback plan — bundling it into Phase 0 documentation work
  would under-review a real production risk.
- **Build the mobile Orders UI directly against the raw, inconsistent internal values.** Rejected:
  would bake three-vocabulary confusion directly into user-facing copy, and would need to change
  again as soon as the follow-up ADR resolves the inconsistency — a projection function isolates
  that future change to one place.

## Consequences

- Positive: Phase 1–3 mobile work can proceed against a stable, documented status vocabulary
  without waiting on a full order-state-machine redesign.
- Positive: the real fix (or a deliberate decision not to fix it yet) gets a dedicated ADR with
  its own review, rather than being smuggled in as a side effect of mobile UI work.
- Negative: Phase 4 (Orders mutation UI: confirm/cancel) cannot start until that follow-up ADR
  exists — an explicit phase-gate dependency recorded here and in `MOBILE_EXECUTION_STATE.md`.
