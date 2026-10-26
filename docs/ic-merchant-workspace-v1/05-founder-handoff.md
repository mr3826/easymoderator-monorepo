# IC-V1 05 — Founder Handoff: Unified Merchant Workspace, Integration Candidate V1

**Candidate:** `17fce2f9` (docs tip) / code `a513a4ce`, branch
`integration-candidate/merchant-workspace-v1`, worktree
`D:\easymod\_wt-ic-merchant-workspace-v1`. Nothing pushed, merged, or deployed.

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
4. **Combined release verification: green.** Backend 313/313 (4219), real-stack
   integration 30/30 (220), Meta-shaped E2E 48/48 zero live sends, FE 665/665 + tsc 0 +
   build, Playwright 20/20 on chromium AND firefox. Full accounting + two honest caveats
   in doc 03 (lab .env/totp interplay; a PE privacy-heuristic false positive on commit
   hashes, fixed narrowly and flagged for the PE owner).

## What the founder gets

One application line containing Product Engine V1.3 + Pilot+ V1 + Merchant Workspace
increments 1 & 2, v6's contract hardening, and mobile-compatible APIs — with a named
acceptance package for the two remaining integrations (v6 UX rebase, mobile
upstream-sync). A production release decision still needs: pilot cohort authorization,
combined-candidate deploy rehearsal on live infra, and Meta App Review (Human-Agent)
unchanged from before.

## Review artifacts

`docs/ic-merchant-workspace-v1/00…05` + `ic-merchant-workspace-v1-proof.json`;
independent adversarial review appended as doc 04 when the reviewer's session
(`ses_e8969255fffe…`) returns.

## Running this candidate locally (not started for you this session)

```
cd D:\easymod\_wt-ic-merchant-workspace-v1
powershell -File scripts\pilotplus-lab.ps1        # containers, migrate, seed, FE+BE preview
# founder login/creds + journeys: docs/merchant-workspace-v1/increment-2/11-founder-handoff.md
```
(The live founder preview from increment-2 is still running from its own tree; this IC
tree is byte-equivalent for the merchant UI plus v6 contract hardening.)
