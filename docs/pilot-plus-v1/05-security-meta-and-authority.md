# Pilot+ V1 — 05. Security, Meta Policy and Authority (threat model; security-reviewer + The Fool applied)

> P0-3 mechanism note: final implementation enforces enabled-payment truth at WRITE time;
> the AI hot path performs no PaymentConfig query (see 06 AMENDMENT LOG A1). All T-table
> guarantees hold under that mechanism.

Repository gates referenced: CONTRIBUTING-AI.md §1 (contract/authorization/evidence+tenant/verification);
meta-safe-rules (corrected re: tags per Phase-3 commit 5); api-contract-rules shop-scoping;
`.gitleaks.toml` + CI Security Scan; boundary security test precedent
(`src/security/__tests__/pilot-intelligence-boundary.security.test.js`).

## 1. Assets and trust boundaries

Assets: customer identity + consent; order/session state; payment truth; delivery truth; knowledge
content; merchant operational state; Meta app standing (business-critical per meta-safe-rules).
Boundaries: Meta webhook -> ingress (HMAC raw-bytes verify present); provider send -> Graph (policy
engine + claims present); merchant JWT API -> data (verifyShopAccess + JWT-derived shop present);
customer text -> business state (stage2 + grounding + Action Gate present); NEW: customer choice tap ->
interaction resolver; NEW: suggestion row -> merchant authoring; EXTENDED: bridge -> session status.

## 2. Threat model (STRIDE-lite, Pilot+ delta only)

| # | Threat | Vector | Mitigation (mechanism, not promise) | Test |
|---|---|---|---|---|
| T1 | Forge/tamper choice payload | handcrafted `p1:<id>:<opt>` via any messaging surface | Opaque server-reference only: row must exist AND match shop+customer+channel+conversation scope columns AND option in registry AND status SENT AND not expired AND bound_context_version current | AC2-AC5 (§11), security test |
| T2 | Cross-customer/cross-shop/cross-page replay | stolen valid payload id from another conversation | resolver loads by id then rejects on any scope mismatch (single predicate fn, reused by storefront adapter); no enumeration oracle (uniform reject) | T2 integration + SSE isolation e2e |
| T3 | Replay / double-tap race | concurrent webhook deliveries, user double tap | SELECT FOR UPDATE + conditional status transition; second resolution = 0 rows no-op; provider-level dedup already three-layer (receipts/claim/external_id) | exactly-once + multi-tap AC |
| T4 | Stale authorization | tap old CONFIRM after repricing/stock change | bound_context_version = session step + confirmed_summary_hash; mismatch => VOID + re-confirm; CREATE_ORDER still revalidates material state inside (existing L956-978) + Gate | stale-summary AC, P+04 reprice matrix |
| T5 | Unauthorized mutation via "business reply mode bypass" | auto mode off, tap confirm anyway | resolver executes the SAME typed-equivalent code path — mutationsAllowed gate (AUTO && allow_order_creation) unchanged; DRAFT/MANUAL produce candidate/handoff not send | "Business reply mode cannot be bypassed by an interactive choice" proof |
| T6 | Prompt injection -> action invention | customer text steers bot into proposing arbitrary choices | option title/operation registry is server-side closed set selected by deterministic rules; LLM never emits quick_replies payloads (provider builds body from registry only); grounding gate unchanged | unit: provider rejects unregistered shape; e2e injection probe |
| T7 | Opt-out / window violation via new surface | choice sent after STOP / outside 24h | interactive sends traverse full policy chain (no exemption); opt-out at ingest unchanged; worker re-read at irreversible boundary unchanged; HOLD-on-outside-window (P0-1) applies to proposals like any text | policy engine tests + meta-shaped e2e closed-window |
| T8 | PII leakage | suggestion text / interaction rows / logs | interactions store ids/enums only; suggestions store norm_question + sample ids; capture hygiene regex redaction (phone/TrxID); SSE/logs use existing sha256-text policy_decisions pattern; policy_decisions persists sha256 only (existing) | PII AC, boundary grep test extension |
| T9 | Privilege escalation on queue/handoff | staff resolves others' item / non-owner dismisses opportunity | all transitions via existing audited endpoints + conditional UPDATE from-states (409 conflict pattern proven for opportunities; new handoff-claim conflict); frontend checks UX-only | role tests server-side |
| T10 | IDOR on new APIs | guess ids in /inbox/actions or resolve | tenant from JWT only (never body/query shop); row-level scope predicate; response = 404 uniform for foreign ids | AC "no other shop's action visible" |
| T11 | Meta standing damage | retired tag emission, outside-window spam, automated HUMAN_AGENT | Phase-3 commit 1: allow-list emptied for automated sends, outside-window HOLD; HUMAN_AGENT gated behind config flag default-off pending App Review (rule already blocks agent role); rate/leaky-bucket untouched (170/hr); quick replies are RESPONSE sends inside window only | zero-retired-tag wire test; eligibility evidence test |
| T12 | False success claims | toast/state ahead of persistence | all UI success from authoritative response; committed-without-send => bucket-2 item + HELD template (existing); payment truth invariants (Phase-3 commits 2/3) | §14 invariant suite |
| T13 | Unapproved knowledge reaches customers | suggestion auto-publish | publish ONLY via existing FAQ is_active+RAG sync path invoked by merchant action; approve endpoint requires flag + shop scope + audit; inactive never in prompt (existing L557-587) | AC §11.4 no-unapproved |
| T14 | Session enumeration via expiry probe | timing on resolve rejects | constant-time-ish uniform reject path; rate limit on webhook is Meta-bound (no new public customer endpoint in pilot; storefront resolve not mounted) | design review note |

## 3. The Fool red-team pass — 5 strongest challenges and dispositions (recorded, not silenced)

F-1 (Adversary: opportunistic merchant-staff exfil) "GET /api/inbox/actions aggregates five sensitive
domains into one richer IDOR target than any current endpoint." DISPOSITION ACCEPTED: endpoint returns
ids+reason codes only (no message bodies, no phone), JWT-shop bound, verifyShopAccess per source
re-applied inside each bucket query (not once globally) — written into AC + security test.
F-2 (Pre-mortem: misleading outcomes) "A 'Talk to a person' quick reply creates the customer
expectation of imminent human response while nobody is on duty; Pilot+ manufactures frustration at
scale." DISPOSITION: HUMAN_SUPPORT proposal is emitted ONLY when conversation enters bucket-1
(merchant-visible queue) AND shop has no explicit offline policy configured? — simplified: proposal
text states "A team member will reply when available" (honest, no ETA), no SLA claim; queue visibility
is the compensating control; §14 invariant "handoff requested ≠ assigned" carried by owner field null
until claim.
F-3 (Counter-argument) "Interaction rows will rot: thousands of SUPERSEDED/EXPIRED rows with no reader
adds migration + vacuum noise and tempt future misuse as a state store." DISPOSITION: rows are tiny,
partitioned by existing retention discipline — added cleanup: suggestions/interactions older than 90d
terminal rows deleted by existing auto-index-adjacent maintenance? NOT silently: documented as DEFER
with explicit retention job in doc 06 backlog; the 90d delete is additive and safe.
F-4 (Evidence audit) "Phase-3 commit 1 claims Meta rejects HUMAN_AGENT for this app; evidence is a code
comment + secondary sources — is HOLD-not-tag the provably correct behavior?" DISPOSITION: decision is
conservative regardless (holding never violates policy; tagging wrong content does); wire test asserts
no request body carries a tag the config hasn't enabled; live verification impossible without sending —
out of scope (no live calls); recorded as assumption A-1 with falsification criterion (App Review grant
=> re-enable flag with new evidence tests).
F-5 (Failure mode) "Free-text number replies ('2') inside a bound context collide with existing step
answers (COLLECTING_QUANTITY answers ARE numbers)." DISPOSITION ACCEPTED AND DESIGN-CHANGED: bare-number
resolution is ONLY consulted when the bound session step is NOT a capture step expecting a number
(QUANTITY/PHONE/ZONE excluded from numeric-choice equivalence; choice equivalence honored for
CLARIFY/CHECKOUT_DECISION/RESUME where the machine's own parser wouldn't consume the number safely).
Test: quantity '2' still means 2 items with a live proposal on screen.

## 4. Consent/identity rules maintained (FlowGuard)

Channel-scoped PSID identity preserved end-to-end (interactions carry customer_channel_id +
meta_channel_id; no name/phone matching across channels); storefront adapter contract cannot merge
identities (scope columns + resolver predicate); opt-out STOP remains terminal + suppressive
(existing + opportunity semantics); screenshot->paid and response->delivered separations enforced by
Phase-3 commits + §14 executable invariants.

## 5. Meta API documentation verification log (no live calls performed)

Sources verified 2026-10-24 (secondary-consistent, cited in 01 §Provenance style):
standard messaging window 24h w/ 8 re-openers; legacy tags retired 2026-02-09, error 100 from 2026-04-27
(CONFIRMED_EVENT_UPDATE/ACCOUNT_UPDATE/POST_PURCHASE_UPDATE); HUMAN_AGENT = manual replies within 7d,
separate App-Review permission, automation excluded; CUSTOMER_FEEDBACK template-only; quick replies ≤13,
title ≤20, payload ≤1000, arrive via `messages` event `message.quick_reply.payload` (already ingressed);
messaging_postbacks requires subscription (NOT subscribed — avoided); webhook ack 200 ≤5s (our ingress
already acks async after receipt), retries/alert ladder, out-of-order events must be ordered by
timestamp (our receipts + dedup handle); rate limit unchanged (170/hr guard untouched); no permission
requests added (meta-safe-rules honored: "do not request additional permissions without founder").
Primary Meta docs are login-walled; assumption A-1 recorded (F-4). No outbound to Meta in any test
(fake transport only — repo already has meta-e2e harness with signed payloads).

## 6. Scan plan (executed in Phase 10, listed here for contract completeness)

gitleaks (repo config) on diff; npm audit (workspaces); eslint (repo config) on changed files; targeted
semgrep-style grep rules for new SQL (parameterization), new JSON body handling, new log statements with
customer text; secrets-in-docs check for founder handoff; boundary security-test extension for
interactions module (pattern: no-send-imports, tenant-from-token, router-auth-first).
