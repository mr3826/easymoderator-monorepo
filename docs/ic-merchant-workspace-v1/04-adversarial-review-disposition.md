# IC-V1 04 — Independent Adversarial Review & Disposition

**Reviewer:** fresh-context session `ses_e8969255fffeLO6i5fMVphDbsA` (not the implementer).
**Reviewed:** frozen `17fce2f9` / code `a513a4ce`. **Verdict: APPROVED_WITH_FINDINGS**
(0 blockers, 11 findings: 5 medium, 4 low, 2 info). Reviewer personally reproduced:
backend 313/313, tsc 0, FE 665/665, integration 30/30/220, meta-e2e 48/48,
playwright 20/20, rehearsal 30-failed/43-passed, byte-identical ported specs,
bypass hunt clean, never-pushed.

| # | Sev | Finding | Disposition (all closed in `deb3c239` unless noted) |
|---|---|---|---|
| F1 | MED | Gate reorder let DRAFT orders be marked/notified `COURIER_SETUP_REQUIRED` before rejection (v6 as-imported threw first; deleted `draft.update` assertion hid the lost guarantee) | **Fixed at source:** one `draftBookingGuard` throws at EVERY pre-write point (unconfigured-provider branch, missing-data branch, post-confidence point); new unit spec pins update/notify/createDeliveryOrder all uncalled. Full 409 taxonomy below. |
| F2 | MED | `DRAFT_ORDER_NOT_BOOKABLE` pinned only at unit level; legacy draft with COMMITTED dispatch could no longer reconcile | **Fixed:** guard returns the synthesized committed parcel (unit spec); HTTP integration spec added on real Postgres (`book-courier` → 409 + code + order unmutated). The web controller catch previously flattened ALL thrown AppErrors to 500 `COURIER_BOOKING_FAILED` (pre-existing gap the port exposed) — declared 4xx status/code/reasons now pass through. |
| F3 | MED | Counts wrong (28 vs 30 = 27 UnifiedInbox + 1 Dashboard + 2 i18n); rehearsal base undisclosed | **Fixed in docs** 01/05 + proof.json; base stated (rehearsal was onto increment-1; list may shift on rebase onto IC); reviewer's own re-run matches the enumerated names 1:1. |
| F4 | MED | "Frozen" tip moved during review (docs-only d0d98ec7) | Acknowledged; final refreeze `deb3c239` (code) / `1d530e7` (docs binding); review rounds end with a re-verification battery, not chat claims. |
| F5 | MED | Browser batteries never exercised the IC backend (:3000 served pre-IC code; specs route-mocked) | **Closed properly:** founder preview re-hosted FROM the IC tree; real-stack walkthrough 3/3 (live login = dev-cookie CSRF round trip through the IC backend); draft 409, `order_status=draft` filter and zero-mutation proven over HTTP from an authenticated browser session; proof row created/removed in lab DB only. |
| F6 | LOW | "firefox 20/20" had no committed mechanism | `test:e2e:chromium` + `test:e2e:firefox` scripts committed; firefox re-proven **20/20** through them (one initial run died at webServer startup contention; green on clean re-run — recorded honestly). |
| F7 | LOW | doc 02 numbers (+38/−19 vs +32/−6 actual; 23-file vs 26 WIP) | **Fixed** in doc 02 to git-numstat values; route/field facts independently verified true. |
| F8 | LOW | README invented cookie `__Host-easymod.csrf-token` (exists nowhere) | **Fixed**: production keeps library default `__Host-psifi.x-csrf-token`; NODE_ENV must be set (missing ⇒ development naming; the same fail-open also flips cookie `secure` — PRE-EXISTING, flagged for the security owner, not introduced here). |
| F9 | LOW | Undeclared fixture churn + moved pilot-metrics line in 2a4760bb | Fully declared here and in doc 03; the metrics line is the pre-existing committed-dispatch counter correctly fired by the reconciled guard. |
| F10 | INFO | Battery dirties tracked files (fixture regen; 3 PNGs overwritten per run) | Screenshots now written to gitignored `test-results/pw-evidence/`; drifted PNGs restored; fixture follows the documented regenerate-with-run convention. |
| F11 | INFO | commit-graph chain warning | Self-healed before this round (chain files present; `git commit-graph verify` clean; no warnings since). |

## Draft-booking 409 taxonomy (final; every row pinned by tests)

| Draft condition | Answer | Side effects |
|---|---|---|
| already booked (consignment/tracking set) | 200 existing parcel (idempotent) | none |
| courier unconfigured / blocked | 409 `DRAFT_ORDER_NOT_BOOKABLE` | **none** — no setup marking, no notification |
| required fields missing | 409 `DRAFT_ORDER_NOT_BOOKABLE` | none |
| confidence-HELD, courier configured | 409 `ORDER_CONFIDENCE_HOLD` + reasons (ADR-0007) | standard hold marking (intended, pinned) |
| confidence allowed/off, clean draft | 409 `DRAFT_ORDER_NOT_BOOKABLE` | none |
| legacy draft, dispatch COMMITTED | 200 synthesized parcel (reconciliation preserved) | metric increment only |
| any non-draft order | exact prior behavior on every branch | — |

Reviewer's own judgment on the classic assertion-edit risk (2a4760bb): load-bearing
never-books assertions were retained; the one genuinely lost guarantee (F1) was
restored at the source rather than papered over — independently verifiable via the
two new unit specs plus the real-Postgres HTTP pin.
