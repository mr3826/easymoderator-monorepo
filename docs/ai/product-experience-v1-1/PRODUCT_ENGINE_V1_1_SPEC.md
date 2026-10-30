# Product Engine V1.1 Test Lab — Design Specification

**Base revision:** `c8981c4df9ea84d47c35f2541884fd55afd64bae`
**Branch:** `feature/ai-product-experience-v1.1`
**Execution boundary:** local-only, loopback-bound, synthetic or user-supplied simulator CSV, no production API mounting, no live Meta messages.

## Objective

Build a reproducible local Test Lab that can inspect the original 20-persona/200-turn simulator, execute bounded scenarios through the real Product Engine router and its presentation/grounding boundaries, retain sanitized run evidence, compare pinned baseline and candidate executions, and operate through a browser-tested local UI. Verify the real PostgreSQL/Redis/worker path using a separate disposable integration stack. Preserve the source CSV byte-for-byte and do not infer factual correctness from suggested answers.

## Design decisions

1. Put the Lab under `EasyMod-backend/scripts/product-experience/` and keep it outside the merchant application, production routes, and `EasyMod-frontend` bootstrap.
2. Bind the Lab server to `127.0.0.1`, require a per-process token for mutating calls, validate Host and Origin, use fixed routes and scenario identifiers, and reject arbitrary commands, paths, hosts, and oversized payloads.
3. Use explicit execution modes: deterministic production-router replay with controlled collaborators; real local stack integration through existing migrations, PostgreSQL, Redis, and worker code; external provider/vision/Meta modes remain disabled unless the bounded provider budget and credentials are available. A mock is never reported as a real provider call.
4. Keep raw simulator messages out of generated reports and browser telemetry. The server may read the selected local source file for the run; exports contain stable scenario/turn identifiers, hashes, classifications, evidence IDs, disposition, reason codes, latency, token/cost provenance, and redacted failures.
5. Define an independent evidence oracle with eligible denominator, required evidence fields, authority class, and expected safe dispositions. CSV suggested answers are informational only and are not used as ground truth.
6. Preserve conversation order within each persona and isolate tenant/persona/session state. Catalog fixtures carry stable tenant and product IDs and explicit attributes, policies, stock, prices, variants, and media authorization.
7. Use baseline and candidate source revisions as explicit execution pins. Do not compare hardcoded sample responses; each side must have a recorded execution receipt and source revision.
8. Report synthetic-router, real-stack, and external-provider measurements separately. Include setup/queue time separately from route latency; only usage records may produce paid cost values.
9. Keep the original V1 artifacts immutable. Store V1.1 plans, reports, traces, screenshots, and machine-readable results under `docs/ai/product-experience-v1-1/`.

## Lab capabilities

- Overview with health, last run, provenance, and gate status.
- Scenario Explorer with 20 personas, 200 source turns, safe search/filtering, and a dataset-wide SHA-256 receipt. Per-row hashes and customer-derived free text are omitted from saved receipts.
- Sequential per-persona Conversation Replay with turn/trace linkage.
- Pinned baseline versus candidate comparison for the same scenario.
- Evidence Inspector for known and unknown claims, with tenant, product, field, evidence identifier, and grounding decision.
- Cost and latency views sourced from run events, visually distinguishing mock, estimate, and measured provider usage.
- Failure Triage with severity, evidence, redacted reproduction details, and rerun receipt.
- Synthetic merchant Playground with multilingual and follow-up flows, tenant switching, approved raster fixture support where available, and explicit reset.
- Run History and redacted JSON/CSV exports.

## Quality gates and status semantics

- Dataset gate: exactly 20 personas and 200 ordered turns are loaded and classified; missing or malformed input is a failure, never a skipped pass.
- Product gate: `correct_verified_product_answers / eligible_answerable_product_questions` and safe fallback dispositions are reported separately; hallucinations and unnecessary refusals have explicit denominators.
- Safety gate: no unresolved covered P0/P1 issue, no cross-tenant evidence, no unsupported price/stock/policy claim, no unauthorized transactional effect.
- Backend gate: actual isolated PostgreSQL, Redis, queue and worker receipts are required for `LOCAL_INTEGRATION_PASS=YES`.
- Browser gate: every implemented Lab journey runs against the dedicated local server; screenshots and traces are retained.
- Provider gate: only an authorized real call with a hard enforced budget counts as verified. Without that, status is `NOT_RUN`.
- Readiness: any required integration layer marked `NOT_RUN` prevents `INTEGRATION_READY=YES`.
- Release: this work never authorizes push, merge, deployment, production writes, or live Meta sends.

## Failure severity

- P0: tenant leakage, secret exposure, or unauthorized action.
- P1: wrong product, price, currency, variant, stock, policy, or unsafe commitment.
- P2: unnecessary refusal, material latency/cost regression, or materially poor answer.
- P3: minor tone, layout, or presentation defect.

Expectations must not be weakened to obtain a passing result. Any unresolved P0/P1 in covered local execution yields a failing or blocked verdict.

## Risks and limits

- Existing route replay uses controlled collaborators. It proves real router/grounding code paths, not real model quality.
- Existing Meta E2E transport can reach non-Graph hosts and must not be reused for Lab network paths. The Lab denies network egress by design; real Meta remains unrun.
- Integration helpers contain fixed queue/key cleanup assumptions and Redis DB overrides that are not honored by all consumers. Use a wholly separate Redis server and unique Compose project/ports; inspect teardown targets before execution.
- The simulator CSV may contain personal data. Reports, UI, traces, and screenshots must not print or persist raw message text or contact values.
- Actual provider/vision cost limits are not specified in the goal. Unless an existing authorized limit can be enforced at the call boundary, do not call providers and report `NOT_RUN`.

## Acceptance evidence

Machine-readable receipts and human-readable reports must agree on revisions, commands, denominators, and status. Independent review must reproduce critical deterministic checks and inspect the real-stack and browser artifacts. The final verdict uses the required status fields from the master goal and never implies a production release.
