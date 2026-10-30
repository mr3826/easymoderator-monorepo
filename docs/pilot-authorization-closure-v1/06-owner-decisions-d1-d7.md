# 06 — Consolidated founder decisions D-1..D-7, current evidence (Gate F)

Built directly on `docs/pilot-deployment-rehearsal-v1/05-owner-decisions-d1-d7.md`, preserving its terminology, and re-based on the frozen candidate `04b07134` plus this milestone's new evidence. No decision here is signed on the founder's behalf; none enables a production flag, selects a merchant, or authorizes spend.

## D-1 — Pilot cohort and exit criteria
- **Current evidence:** Original proposal (3–5 BD Messenger shops, ≥30 days history, active `pages_messaging`, named opt-in contact) was challenged to "at most one opted-in **shadow/manual** shop for time-bounded workflow learning, not PMF validation" (Pilot-Deployment-Rehearsal V1 FieldFounder review; unchanged by this milestone). Stop triggers exist (`runtime_kill_switch_enabled` denial spikes, any unauthorized write via read-only SQL checks, merchant-reported reply-safety incident, Sentry >1% on `/api/mobile|order` 24h) but have no measured denominators for reply safety. New: the founder can now observe the real merchant workflows on the loopback preview (01) with all automation OFF.
- **Recommended:** Defer live traffic; approve at most one opted-in shadow/manual shop after D-2..D-4 and D-1 thresholds are named, commerce flags OFF.
- **Alternative:** Founder selects the 3–5 cohort now (not recommended — unsupported by rehearsal outcomes).
- **Risk if unresolved:** Unstaffed stop path; cohort sized beyond operational attention.
- **Blocks limited pilot:** YES.
- **Owner authority:** Founder/cohort owner selects shops and authorizes traffic; engineering does not select merchants.
- **Acceptance condition:** One named opted-in shop + written numerator/denominator/baseline/review-window/stop-threshold set for unsafe replies, false holds, missed/late replies, inappropriate order prompts, wrong catalog matches, provider spend, operator hours; reply-safety incident = immediate stop.

## D-2 — Meta eligibility
- **Current evidence:** Candidate adds zero Graph scopes; permissions held: `pages_show_list`, `pages_messaging`, `pages_manage_metadata`; production messaging proof exists (2026-09-22: `provider_send_confirmed=true, delivered=true`). **Human-Agent eligibility not established.** 2026-10-27 inspection reported `contact_email_verified=false` and `support_url`/`data_deletion_url` unset — drifting against a 2026-08-20 audit that recorded the data-deletion callback configured; the console current-state is the only tie-breaker. `HUMAN_AGENT` remains an ungranted permission; backend blocks the send outright rather than mis-tagging (docs/meta-app-review.md:94).
- **Recommended:** Keep existing scope; verify current console state (Human-Agent review, contact email, support/data-deletion URLs) before any AI mode above `MANUAL`.
- **Alternative:** Defer all AI-reply modes; manual-only pilot.
- **Risk:** Messaging eligibility/compliance lapse breaks sends or violates Meta policy mid-pilot.
- **Blocks limited pilot:** YES for AI modes; manual-only could proceed under D-7/D-4 posture.
- **Owner authority:** Meta app admin/founder.
- **Acceptance condition:** Console screenshot/state record: Human-Agent status, verified contact email, both URLs configured, zero new scopes requested.

## D-3 — Monitoring ownership
- **Current evidence (changed by this milestone):** Full isolated chain now proven — synthetic fault → durable receipt → **real destination delivery receipt at the local sink** (sequence 1, 284 B, `bodySha256=a6200c447726a9c51e35a815c55c7d6f048d7237d5b2e35a58f1f7220eadbbca`) → reconciler recovery → cleanup (03). Emitter map, PII posture, retention, and gaps (no signature-failure alert, no direct DB-down alert, no alert persistence) documented. Production destination/operator still unnamed; **human acknowledgment remains unproven by design — a machine receipt is not an operator ack.**
- **Recommended:** Name the production Slack/Sentry destination + on-call; run the documented self-test (`POST /api/admin/ops/test-alert`, SUPER_ADMIN) against the named channel; operator confirms receipt on a device they watch; add `/health/ready` uptime probe (covers the DB-gap alert).
- **Alternative:** Staffed manual log/runbook checks for a tightly bounded pilot while automation stays off (explicitly weaker).
- **Risk:** Silent failures; unbounded detection/response time.
- **Blocks limited pilot:** YES (per prior attestation and this mission).
- **Owner authority:** Founder/operations owner.
- **Acceptance condition:** Written channel + primary/escalation names + ack of a live test alert.

## D-4 — Kill switches
- **Current evidence:** Three levels exercised and independently received (global `runtime_kill_switch_enabled` denial + audit row; per-conversation `ai_paused`; per-shop `manual_mode`); strict-literal fail-closed flag semantics re-confirmed at `ai-runtime-flags.js:26-39` incl. unmapped-mutation-type-DENIED-by-construction; preview stack visibly enforces OFF-state (`/api/inbox/actions → 409 FEATURE_DISABLED`). Authorized flip operators, second approver, and production confirmation path remain unnamed.
- **Recommended:** All mutation switches OFF for pilot; name per-level operators; two-person rule for the four global mutation flags; keep the blocked-synthetic-action confirmation method.
- **Alternative:** Manual-only pilot with no automation authorization at all (safe but reduces what the pilot learns).
- **Risk:** Ambiguous authority delays incident suppression; a stale rollout flag keeps mutations on.
- **Blocks limited pilot:** YES.
- **Owner authority:** Founder names operators/approvers and accepts the confirmation method.
- **Acceptance condition:** Written authority matrix + one rehearsed production-side flag flip + verification query results.

## D-5 — Mobile limitation
- **Current evidence:** `POST /api/mobile/products/images` remains absent in the candidate (client flow `useProducts.ts:216`); `MOBILE_API_ENABLED` literal-`'true'`-only default OFF (`config.js:43`). The controlled Messenger pilot does not depend on mobile upload; the truthful "feature disabled" presentation pattern is demonstrated on the preview (01).
- **Recommended:** Keep mobile API disabled; gate the client upload path on capability detection; exclude mobile photo upload from pilot scope explicitly.
- **Alternative:** Absorb the mobile branch endpoint in a separately scoped post-pilot increment.
- **Risk:** Mobile testers hit an unavailable feature without clear messaging.
- **Blocks limited pilot:** NO if scope excludes mobile.
- **Owner authority:** Product owner.
- **Acceptance condition:** Written scope note excluding mobile photo upload + client capability-gate confirmation.

## D-6 — V6/Phase-D debt
- **Current evidence:** 30-item V6 action-first UX list + one skipped Phase-D `Channels.tsx` e2e spec unchanged; no UX work was in scope this milestone. Inbox guarantees re-validated on the current stack: authenticated journeys (chromium 58.5s / firefox 1.3m, pilot logs) still assert draft-unsent (`DRAFT_DELIVERY_NOT_CONFIRMED`), dismissed-expiry persistence, handoff claim/resolve, expired-window no-send, and cross-tenant 404s.
- **Recommended:** Classify the named debt post-pilot ONLY while the reviewed Inbox message lifecycle remains intact — draft explicitly unsent in transcript, safe inline actions, unknown/expired reply windows fail closed (guarantees are a release condition, not deletable debt).
- **Alternative:** Defer pilot until the UX list + skipped spec are done (slower learning).
- **Risk:** Debt items hide reply-safety gaps if discarded rather than deferred.
- **Blocks limited pilot:** NO (conditional on guarantee preservation).
- **Owner authority:** Founder accepts named debt + guarantees.
- **Acceptance condition:** Written acceptance listing the 30 items + Phase-D spec as tracked debt with the Inbox guarantees pinned.

## D-7 — Webhook auto-booking
- **Current evidence:** `AI_COURIER_BOOKING_ENABLED=false` is the rendered production default; verified paid webhook records payment truth but booking returns `{blocked, automation_disabled}`, logged, manual dispatch (AGENT_ACTION_POLICY §11; matrix-pinned, zero provider/dispatch side effects). This milestone re-attested hold-and-replay truthfulness on the live stack (alert chain: held inbound, recovered, no queue job created without authorization).
- **Recommended:** Keep webhook auto-booking OFF; manual dispatch is the pilot stance.
- **Alternative:** A later, explicitly scoped enablement after main-stack replay/idempotency/monitoring/rollback evidence.
- **Risk:** Merchants expecting auto-dispatch need explicit communication of the manual path.
- **Blocks limited pilot:** NO while OFF (it is the safe default).
- **Owner authority:** Founder/ops authorizes any future scope + dispatch ownership.
- **Acceptance condition:** Written manual-dispatch SRE acknowledgment + merchant-facing expectation note.

## Additional owner items carried into the single authorization response

8. **Supplemental AI image-data transfer condition (updated):** the photo-matching default-ON mismatch is corrected and fail-closed at source (`04`); the transfer condition now applies to any *future enablement*: allowed image-data classes, provider terms for Gemini/OpenAI image forwarding, gated/calibrated photo-triggered order selection (text-RAG caveat retained from the base document). Keep OFF for pilot.
9. **New — `qs` MEDIUM disposition (Gate E):** ship the `qs@6.16.1` lockfile bump increment before any deploy (recommended), or sign a time-bound acceptance with the flag-OFF posture as compensating control. One line either way.
10. **Confirmation-only:** founder walkthrough of the loopback preview (`01`) closes B-1 on first login.
