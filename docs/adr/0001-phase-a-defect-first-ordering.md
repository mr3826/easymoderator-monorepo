# ADR-0001: Phase A Defect-First Ordering

Status: Accepted<br>
Date: 2026-08-22<br>
Owners: Architecture + Security

## Context

`ROLLOUT_PLAN.md` originally listed contracts, idempotency, evidence, Action Gate, and the live defect fixes as one sequence. The deployed risk was not evenly distributed: broad confirmation matching, unbound order lookup, mutation-before-outbound behavior, early dedup claims, and courier retry uncertainty could create or hide real customer mutations before the new gate existed.

## Decision

Ship the live defect containment work before completing the reusable Action Gate foundation. Strict confirmation, tenant-bound lookup, deterministic post-mutation delivery, retry-key release, and courier reconciliation landed in A1; the contracts and Action Gate landed in A2; A2.1 now proves the gate through the real worker path.

This is a deliberate implementation-order deviation, not a relaxation of the runtime boundary. No material mutation is approved without the Action Gate after A2. The ordering reduces the immediate false-order and duplicate-courier blast radius while the shared gate was being built.

## Rationale

`ROLLOUT_PLAN.md` §8 sets `false_order_creation_rate = 0`. A defect-first sequence reduced the probability of violating that zero ceiling during the transition. The dependent PR chain preserves review order: Phase 0 → A1 → A2 → A2.1.

## Consequences

- Positive: the highest-risk live behaviors were constrained before new autonomous capabilities were added.
- Positive: every later gate change is tested against the already-contained failure modes.
- Negative: A1 temporarily carried local safety checks before the shared gate was available.
- Required follow-up: do not activate ProductAgent or additional mutating capabilities until the Action Gate, audit, budget, and integration receipts are present.
