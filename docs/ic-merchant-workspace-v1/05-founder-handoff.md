# IC-V1 05 — Founder Handoff: Unified Merchant Workspace, Integration Candidate V1

**Candidate:** round-2 freeze `0386207ccba51738fce142e1e348931d940d7606` on branch
`integration-candidate/merchant-workspace-v1`, worktree
`D:\easymod\_wt-ic-merchant-workspace-v1` (sha bound by this docs pin commit).
Nothing pushed, merged, or deployed.

## What this milestone decided (no feature work)

1. **SHA erratum settled by Git.** The canonical Increment-1 tip is
   `3d1bc0eb4988ce52fda9fcde9191c7d87e645139`; the `…9191c7d8d645139` string in earlier
   mission text resolves to no object — transcription noise only, no artifact carries it.
2. **V6 Action-First: contract layer integrated, UX line deferred with a checklist.**
   The four v6 contract deltas (draft-booking guard, order-status filter, dev CSRF cookie,
   global-toast opt-out) are ported with their specs and reconciled against ADR-0007
   (a confidence-held draft still answers `ORDER_CONFIDENCE_HOLD`; plain drafts 409
   `DRAFT_ORDER_NOT_BOOKABLE`). v6's action-first shell is NOT merged — the rehearsal
   proved it silently breaks 30 named behaviors (27 Pilot+/inbox guarantees, 1 Dashboard, 2 i18n guards); doc 01 is the v6 owner's
   rebase acceptance list (the failing test names).
3. **Mobile: verified compatible, worktree untouched.** Reply/handoff/assignment/
   delivery-state contracts are a safe superset (hardened tag rules, draft-booking 409);
   the branch's `POST /products/images` is catalogued as their pending upstream
   contribution. Re-sync asks listed in doc 02.
4. **Combined release verification: green (round-2 battery).** Backend 317/317 (4,271
   passed, 2 skipped), real-stack integration 32/32 (225, incl. the new
   `20261026_001_order_idempotency_unique` migration applying on disposable Postgres),
   Meta-shaped E2E 48/48 zero live sends, FE 78 files / 692 + tsc 0 + build,
   Playwright battery 20/20 chromium AND 20/20 firefox (`--workers=1`; parallel runs
   flake on 30s load timeouts under machine contention — single-worker is the procedure).
   Full accounting in doc 03; the five legacy spec files that pin pre-Pilot+ markup are
   catalogued as test debt in doc 04's round-2 section (all 22 failures verified to
   reproduce at baseline; 14 of 19 legacy files pass). WebKit dev-stack limitation
   (`__Host-` CSRF cookie on http://localhost) documented there; never part of any
   green battery record.

## Round-2 hardening (adversarial review `ses_e86d829c…`, GO verdict, all findings closed/dispositioned)

- Production-default safety: the audited-product-read handoff no longer fires when the
  domain-agent runtime is disabled (that was a customer-visible breakage of every live
  bot product answer at deploy — R2-F1). Replay harnesses now model the shipped defaults.
- Fail-closed kill switches: every mutating action type maps to an explicit flag;
  new production flags `AI_PAYMENT_ACCEPTANCE_ENABLED` and `AI_SUPPORT_CASE_ENABLED`
  (rendered `'false'` by default — add them to the deploy `.env` source like the other
  three). Unknown types deny (R2-F2).
- Committed-order/audit resilience + DB-level order idempotency unique index (R2-F3/F4).
  **Migration rollout note:** `20261026_001` deliberately refuses to apply over
  pre-existing duplicate `(shop_id, idempotency_key)` rows — reconcile before enabling.
- Payment-webhook auto-courier booking now requires `AI_COURIER_BOOKING_ENABLED=true`;
  with the rendered default `'false'` webhooks confirm payments without booking and
  dispatch stays manual until the operator opts in (R2-F10, AGENT_ACTION_POLICY §11).
- Mobile AI-pause rollback, result-audit signature enforcement, action-queue degrade-
  not-crash hardening, and smaller fixes — full table in doc 04.

## What the founder gets

One application line containing Product Engine V1.3 + Pilot+ V1 + Merchant Workspace
increments 1 & 2, v6's contract hardening, and mobile-compatible APIs — with a named
acceptance package for the two remaining integrations (v6 UX rebase, mobile
upstream-sync). A production release decision still needs: pilot cohort authorization,
combined-candidate deploy rehearsal on live infra, and Meta App Review (Human-Agent)
unchanged from before.

## Review artifacts

`docs/ic-merchant-workspace-v1/00…06` + `ic-merchant-workspace-v1-proof.json`;
independent adversarial reviews recorded as doc 04 rounds 1–3; the pilot release-readiness
GO/NO-GO and owner decision package is doc 06.

## Running this candidate locally (not started for you this session)

```
cd D:\easymod\_wt-ic-merchant-workspace-v1
powershell -File scripts\pilotplus-lab.ps1        # containers, migrate, seed, FE+BE preview
# founder login/creds + journeys: docs/merchant-workspace-v1/increment-2/11-founder-handoff.md
```
(The founder preview currently running on :5173/:3000 serves THIS IC tree — re-hosted
during round-1 certification; refresh the page to pick up round-2 changes.)
