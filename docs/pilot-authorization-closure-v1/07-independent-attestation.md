# 07 — Independent adversarial attestation (Pilot Authorization Closure V1)

Reviewer: fresh session `ses_e71c0ce51ffeHzmW01Hzkvq5vu` with **no implementation ownership**, instructed to re-execute commands rather than read reports, 2026-10-30T19:17Z+, against the frozen evidence commit `0bf1ae47a6361b7d477e1add1110fd9d5e1ea799` (direct child of `4c36dffc…`, direct child of protected `04b07134…`). Role labels were not accepted as verification: every item below was reproduced by the verifier itself.

## Verifier results (12/12)

All twelve mission checks returned PASS. Highlights of what was independently re-derived rather than trusted:

- **Provenance & purity:** parent chain re-walked (`0bf1ae47 → 4c36dffc → 04b07134`); cumulative `git diff 04b07134..0bf1ae47` contains **zero non-docs paths**; `fsck` clean of errors; both protected worktrees confirmed untouched; new worktree tracked tree clean.
- **Source identity:** tree `db4d3f0c…` reconfirmed; blob spot-hash of `vision-policy.service.js` matched; **the full 2,920-file manifest comparison was re-run by the verifier: match=2920, mismatch=0, missing=0** against the durable mirror.
- **Founder preview survived active refutation:** the verifier re-executed the authenticated walkthrough live (independent login jars, statuses identical: signin 200×2, cross-tenant reads 404×2, action queue 409 FEATURE_DISABLED); proved `docker port backend` genuinely empty (the 10-27 root-cause disclosure is true, not paper); traced listeners — Vite on `127.0.0.1:54680` from the byte-verified mirror, user-space relay on `127.0.0.1:54643` (source read: loopback bind, no body/cookie logging), Windows side bound solely via `wslrelay.exe` on `127.0.0.1`; unauthenticated API returns real 401 (no stub); live container env shows all mutation/photo flags `false`.
- **Alert chain:** before(0)→after(1) sink counts, `bodySha256=a6200c44…` byte-consistent across four receipt files; the sink source was read and the running container's mount proven to be that same frozen-tree file; reconcile/held/recovered payload hash `8e8bb040…` consistent; worker verified exited before post.
- **Config claims:** the two cited fail-closed files diffed empty against `04b07134`; strict-literal semantics confirmed by reading the code.
- **Security disposition:** both Trivy JSONs re-parsed — exactly one MEDIUM (`qs` CVE-2026-110816 6.16.0→6.16.1), 0 secrets, 0 misconfig failures across 6 targets, 0 HIGH/CRITICAL.
- **No secret disclosure:** the actual synthetic password value was extracted by the verifier and searched across all committed docs/evidence — **zero occurrences**; no sk/AKIA/JWT/private-key patterns.
- **No external side effects:** hosts in committed docs are loopback only; non-loopback strings appear only inside Trivy advisory metadata; the verifier's own single read-only `git ls-remote` (0 remote ops/* heads) was self-disclosed as INFORMATIONAL.
- **Decision integrity:** D-1..D-7 all seven fields present; nothing signed; the founder answer sheet is empty boxes; local/staging/production distinctions honored (`DEPLOYED_IMAGE_VERIFIED`/`ROLLBACK_COMPATIBILITY` remain BLOCKED, not inflated).
- **NO-GO behavior:** correct given unmet owner-side blockers; `INDEPENDENT_ATTESTATION=PASS`, `GO_RECOMMENDATION=NO_GO_WITH_EXACT_BLOCKERS`.

## Objections and responses

| ID | Severity | Verifier objection | Response / disposition |
|---|---|---|---|
| F-1 | MINOR | `proof.json` recorded `"finalEvidenceSha":"PENDING-FREEZE-COMMIT"` inside the frozen commit | **Corrected in the final docs-only commit (child of `0bf1ae47`)**: `frozenEvidenceSha=0bf1ae47a6361b7d477e1add1110fd9d5e1ea799` pinned; `finalEvidenceSha` described as "direct child of frozenEvidenceSha, reported in final handoff" — the self-reference impossibility is the same one the closure attestation documents for its own docs commit. |
| F-2 | MINOR | "62 evidence files" undercounted the independent-final dir | **Corrected**: verified recount 147 top-level files (91 evidence receipts + 48 harness scripts + misc incl. frozen tars); `00` and `proof.json` updated with the counting rule. Immutability itself was independently confirmed (0 receipts newer than 2026-10-28). |
| F-3 | INFORMATIONAL | No `07` file in the frozen commit | Resolved by this very document; the mission deliverable list always included it — it is authored post-verification by design. |
| F-4 | INFORMATIONAL | Trivy DB cache lives under `…independent-final/trivy-cache/` (a tool cache inside a receipts directory) | Accepted and documented in `00` (cache ≠ receipt; all receipt mtimes verified unchanged). Future milestones: relocate tool caches outside evidence roots — noted as harness hygiene, not a candidate defect. |
| F-5 | INFORMATIONAL | Keeper-process ID not independently verifiable | Agreed — it is session metadata; the verifier instead confirmed the live stack itself (containers, listeners, network internal flag). |
| F-6 | INFORMATIONAL | Verifier executed one read-only `git ls-remote` | Disclosed; consistent with §12's read-only diagnostics authorization; zero writes. |

No BLOCKER or MAJOR finding was raised by the adversarial reviewer.

## Attestation

The frozen candidate `04b07134` plus this milestone's evidence is **internally accurate**: every PASS in `docs/pilot-authorization-closure-v1/` was reproduced by an owner-free reviewer with live re-execution, and every remaining gap is explicitly an owner/production dependency, correctly left blocked rather than simulated. Independent verification of the engineering evidence is **complete**. This attestation does not authorize pilot traffic, deployment, or any decision in `08`; it certifies that the package the founder receives is truthful and the blockers listed there are exactly the ones that remain.

## Round 2 — bounded delta attestation (post-Gate-D-fold refinements)

After the initial PASS, the Gate-D deep survey was folded into `04`/`06`/`08` as docs-only commit `b5cf6a2ab75c7294e28330d159b792a2f443daa3` (direct child of `8596aa95…`). A second fresh no-ownership reviewer (`ses_e71a12ed3ffe`, after two transport resets were retried) verified **only the delta**: parentage, docs-only purity, all 21 milestone paths under `docs/` since `04b07134`, every new citation against source (mobile activation record incl. run ids `36236137743`/`36237374273` and the `e6bf0c7ea`-later-than-mobile ordering; `PRODUCTION_DEPLOY_ENABLED` restore receipts at both ledgers; `usage-recorder` OFF-by-default; cost ceiling `0.024572` fail-closed; kill-switch check ORDER — `runtime_kill_switch_enabled` at `action-gate.service.js:110` strictly before `merchant_mode_allows_mutation` at `:128`, per-request recheck at `:260`; signature 403/503; payment-status-write isolation; handoff defaults; 0.75 confidence gate; HUMAN_AGENT block rule; both ai-cost supersession banners preceding their historical text), a secret scan of the delta (zero hits; password compared programmatically without printing), and the still-unsigned state of D-5 / row 5.

### Round-2 objections and responses

| ID | Severity | Reviewer objection | Response |
|---|---|---|---|
| F-7 | MINOR | `render-production-env.js:198` (`AI_VISION_ENABLED || 'false'`) is not strict-render; the "fails outright on any non-literal" sentence overreached | **Corrected in the final commit**: claim scoped to the eight strictBooleanFlag safety flags with exact line refs; AI_VISION's non-literal passthrough explained as runtime fail-closed via `vision-policy.service.js:35` literal-`'true'` consumption |
| F-8 | MINOR | "`config.js:45-49` test force" overbroad — `MOBILE_PUSH_ENABLED` and `MOBILE_AI_DRAFTS_ENABLED` have no test force | **Corrected**: exact per-line split stated (four force only under test; push/drafts strict-false everywhere; none rendered for production) — net posture safer than originally claimed |
| F-9 | MINOR | Carried-over `useProducts.ts:216` pointer stale (file is 202 lines) | **Resolved beyond the objection** during principal re-derivation: the mobile photo flow at the candidate is `usePhotoDraft` (`useProducts.ts:167–196`) → `POST /api/mobile/products/photo-draft`, implemented at `mobile.routes.js:73` / `mobile-product.controller.js:241`, UI `PhotoToProductModal.tsx`; zero remaining client references to the missing `/products/images`. D-5 rewritten to the true, narrower limitation (no camera-file upload; pasted-`image_url` draft flow works end-to-end) in `06` and `08` row 5. |

Round-2 verdict recorded by the reviewer: `DELTA_ATTESTATION=PASS` — no BLOCKER/MAJOR; all three MINORs addressed in the final docs-only child commit of `b5cf6a2a`, whose SHA is reported in the final handoff (a commit cannot embed its own SHA).
