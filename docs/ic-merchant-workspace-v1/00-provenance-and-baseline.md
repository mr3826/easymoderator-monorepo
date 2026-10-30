# IC-V1 00 — Provenance & Baseline (git-resolved)

**Milestone:** EasyModerator Unified Merchant Workspace — Integration Candidate V1
**Date:** 2026-10-26 · **Worktree:** `D:\easymod\_wt-ic-merchant-workspace-v1`
**Branch:** `integration-candidate/merchant-workspace-v1` · **Base:** MW-V1 increment-2 tip.

## SHA erratum resolved by Git (not by text comparison)

The Mission-1 handoff quoted Increment-1's final SHA as
`3d1bc0eb4988ce52fda9fcde9191c7d8d645139`. Git adjudicates:

| Check | Result |
|---|---|
| `git rev-parse feat/merchant-workspace-v1-increment1` | **`3d1bc0eb4988ce52fda9fcde9191c7d87e645139`** (authoritative tip; tree clean) |
| `git cat-file -t 3d1bc0eb…d645139` | **fatal: not a valid object name** — that string resolves to nothing |
| Increment-1 commits above Pilot+ | exactly 7 (`git rev-list --count 9f562aaf..3d1bc0eb…7e…`) — matches the handoff's own ledger |

Verdict: the `…d645139` spelling is a **transcription error that existed only in chat/mission
text** (my own Increment-1 final reply included it — corrected here); every committed
artifact carries the canonical SHA. All IC lineage statements below use git-verified values.

## Verified lineage (fresh `merge-base --is-ancestor` checks, exit 0)

```
2a8c1e2d  production            → 07168f49 main (+15)
07168f49  main                   → 9f562aaf Pilot+ V1 (worktree clean, untouched)
9f562aaf  Pilot+                 → 3d1bc0eb4988…7e645139  MW-V1 increment 1 (clean, untouched)
3d1bc0eb  increment 1            → 434a8cfc MW-V1 increment 2 FINAL (clean, untouched)
434a8cfc  increment 2            → IC-V1 commits (this branch; 65c99f43 = v6 contract port)
```

Product Engine V1.3 `f0f04e4e` is an ancestor of Pilot+ (previously verified; its worktree
holds another agent's checkpoint files — observed read-only, untouched).

## Protected-workstream posture at IC start

| Workstream | State | IC treatment |
|---|---|---|
| Pilot+ / increment-1 / increment-2 | frozen at their tips, clean | never touched; IC builds forward from 434a8cfc |
| Product V1.3 | dirty (active owner checkpoint) | read-only observation only |
| v6-action-first `50b52e86` | clean branch, owner quiescent | **contract deltas ported** (doc 01); UX line deferred to owner rebase |
| orders-v2 `3b68c699` | clean; superseded sibling | deferred; its unique bits catalogued in doc 01 |
| mobile-app `939de5dc` | **dirty (23-file WIP) — active** | never touched; contract drift computed read-only (doc 02) |
| mobile-execution `f4d640bc` | obsolete lineage (rebased into mobile-app) | ignored |

No IC work has pushed, merged to any shared branch, or deployed anything.
