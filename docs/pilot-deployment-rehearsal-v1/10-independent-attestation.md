# 10 — Independent review and attestation

## Review contexts actually used

| Context | Scope | Result and limit |
|---|---|---|
| Release/SRE review | Read-only deployment topology, readiness, rollback, recovery, monitoring, source references, and latest host inventory | Confirmed PARTIAL/NO-GO: no image digest, startup, migration, alert receipt, backup restore, or application recovery proof. The unknown 6379 service was left untouched. No service or migration was run by that reviewer. |
| FlowGuard review | Read-only security/policy trace across interaction choices, Action Gate, Meta, consent, courier, payment, tenant checks, and final provider/host evidence | The original trace found the GENERATED-versus-SENT numeric-choice issue and per-shop flag gap; these drove commit 3e7ce558. Fresh source review found the conditional customer-image-to-OpenAI fallback and service-scope/host-snapshot wording gaps. The evidence package was corrected; a post-correction spot-check passed. No runtime side-effect test was performed. |
| AI platform/provider review | Existing provider contracts, key names, fallback, privacy, current official API/model/pricing/data terms | Confirmed existing integrations; found customer-image OpenAI fallback and that effective deployed model IDs are unknown because overrides/runtime config were unavailable. The docs now separate source defaults from effective models and keep photo matching off pending approval. No key values or provider calls. Account billing and entitlement remain unknown. |
| FinOps review | Read-only reconciliation of current AI cost docs, source accounting, effective model overrides, and spend controls | Found the July audit's zero-vision claim stale against the pinned source and inconsistent with the August photo-cost scenario. A conditional image-token estimate is possible; deployed cost/task, model, tier, fallback mix, and spend cap remain unknown. No key values, provider calls, or service access. |
| BazarLens review | Read-only inspection of Bangla/Banglish synthetic tests, product grounding, delivery and image matching, and inherited quality artifacts | Existing fixtures cover selected intents and grounded-fact contracts, but exact-candidate merchant usefulness and provider quality are not established. V1.3 quality proof is from ancestor `33ca2b76…`; its held-out turns repeat generic prompts and omit livestream/comment-selling cases. Image-to-SKU identity is uncalibrated. No tests, providers, or services were run. |
| FieldFounder review | Read-only commercial and operating-scope challenge | Found no operational or commercial evidence for the inherited 3–5 shop/30-day-history recommendation. Recommends no live cohort now; after runtime and governance gates, consider one opted-in shadow/manual shop for workflow learning only, not PMF validation. Staffing, operator burden, and D-1 metric thresholds remain unmeasured. |
| MomentumUX review | Read-only trace of provider failures, Messenger worker, confidence gates, Inbox SSE, and related tests | Found no Inbox listener for `llm_outage`; a router failure can produce an unlabeled keyword response, and a Bangla/Banglish price term can start an order session at confidence 0.75, which meets the AUTO default threshold. No outage/price-failure UI regression exists. MANUAL is the default; no live UX was exercised. |
| Independent code review | Review of the interaction patch and tests | Caught an initial regression during correction, reviewed the final status ordering and worker/service tests, and found no remaining code-level blocker for the tested interaction race. Not a full-system release verifier. |
| Root execution | Host tests, Compose parsing, lockfile reproduction, latest full-suite attempt | Reproduced the stale standalone lockfile and corrected it; prior focused/security/frontend results are recorded in 02 and the proof JSON. The latest full default backend rerun was interrupted after BullMQ attempted `localhost:6379` and received `ECONNREFUSED`; it has no final test totals. No successful Redis connection or Docker stack startup occurred. |
| Independent QA | Read-only provenance/source/lockfile review against code SHA `714be0072b6c8a8bba181dbe814e284c3b342ffe` | Confirmed the interaction code change is scoped and the standalone lock entries match package manifests; found the image-bearing Gemini-failure/OpenAI-fallback test gap. QA ran no tests; its dependency-install handle disappeared before an exit code. It did not contact services. |

These reviewers are independent source/evidence challenges, not runtime acceptance. Their findings are kept separate from observed behavior, and none authorizes production release.

## Final independent verifier

INDEPENDENT_ATTESTATION=NO_GO.

No independent reviewer has completed the mandate's full critical-gate execution checklist. The QA context completed source and lockfile review but ran no tests; the earlier recorded focused/security suites remain host-only evidence, and the latest full-suite rerun was stopped after refused localhost Redis connection attempts. No reviewer has executed the Docker-backed service, migration, recovery, kill-switch, alert, or provider gates. Creating a separate fresh Codex thread previously failed because the thread store reported insufficient disk space while C: had 0 bytes free. The historical c164a042 attestation does not verify the new interaction fix, frontend lockfile correction, local manifest, runtime migration/recovery, monitoring, or current owner decisions, so it cannot be reused as a final GO.

## Gate summary

| Gate | Result | Evidence |
|---|---|---|
| Git provenance and isolation | PASS | Full frozen pins, ancestry, isolated branch, clean original tracked state, 84 original untracked files preserved, Git object connectivity exit 0 |
| Reproduced interaction defect | PASS | FlowGuard source trace; new deterministic tests reproduce GENERATED and flag-revocation boundaries |
| Interaction patch review | PASS for the narrow code diff | Independent reviewer rechecked source and tests; reviewer notes the worker test mocks the resolver rather than integrating both components |
| Backend security and focused tests | PASS | 58 suites/812 tests and 47/47 focused interaction plus worker tests passed |
| Latest full default backend suite attempt | ABORTED | BullMQ tests attempted `::1:6379` and `127.0.0.1:6379`; both returned `ECONNREFUSED`. The run was interrupted with exit code 1 before final totals; no successful connection is evidenced. |
| Frontend tests/build | PASS | 78 files/692 tests; Vite production build passed with a large-chunk warning |
| Compose manifest | PASS | Production Compose plus rehearsal overlay config --quiet exit 0 |
| Image digest and startup | BLOCKED | Docker snapshot I/O and read-only metadata store; no final digest or service startup |
| Migration and failure recovery | BLOCKED / NOT RUN | Docker-backed database unavailable; no worker or persistent queue recovery test |
| Kill-switch runtime and monitoring | NOT RUN | No running rehearsal stack or received synthetic alert |
| Provider credential, access, and spend | PARTIAL | Presence checked by environment variable name; no values, API requests, billing validation, or account access test |
| Owner decisions D-1 through D-7 | READY FOR OWNER REVIEW | D-1 now recommends deferring live traffic until gates pass, then considering one opted-in shadow/manual shop for workflow learning; stop metrics and denominators remain unresolved. See 05-owner-decisions-d1-d7.md. |

## Final status

The code review supports the narrow SENT-only interaction correction, and source tests pass. This does not establish production-equivalent deployment, migration/recovery safety, monitoring reachability, provider billing, or production readiness. Overall rehearsal disposition is PARTIAL and production release remains NO-GO.

## Independent package/source consistency audit

FlowGuard reviewed the committed package and source at 0da680a3c59b0583c6b77e932e19da95a3ecaa80, read-only. The reviewer found three documentation inconsistencies: an initial status snapshot said all gates remained pending despite the final status table; the proof JSON did not identify the reviewed package commit; and key-presence booleans did not distinguish requested environment-alias presence from source-contract credential availability. These are corrected in the follow-up documentation commit. The proof JSON records the audited pre-correction commit and audit scope. No runtime verification was performed by this review, and the overall independent release attestation remains NO_GO.

FlowGuard rechecked all three corrections at HEAD 8f3589686e609ba4492fc0242d0e6094fb1a2919 and confirmed them; no remaining contradiction was found among those package claims. The check did not run services, tests, or provider calls and does not upgrade the release attestation.

At Git HEAD `bcb8279b8612484af68393e94b6f6763cb836835`, with rehearsal-document edits present in the working tree, FlowGuard rechecked named claims against application source SHA `714be0072b6c8a8bba181dbe814e284c3b342ffe`. The reviewer conditionally passed the cost-document conflict and image-token arithmetic, the customer-photo Gemini-to-OpenAI path and separate text-RAG order-selection path, the outage-to-keyword fallback and AUTO threshold, the D-1 recommendation, and the refused Redis/Jest account. This records a read-only check of those claims against the then-current working tree, not a commit-specific review of a clean documentation package. No tests, services, or provider calls were run; runtime and overall release attestation remain NO_GO.
