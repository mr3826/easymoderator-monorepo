# Verified Commerce Foundation V1.2 — Implementation Plan

- Baseline: `78b6250af40039749f9c096cd3e0debe2e6cf6a7`
- Branch: `feature/verified-commerce-foundation-v1.2`
- Worktree: `D:\easymod\_wt-verified-commerce-v1-2`

## Scope and fixed boundaries

- Continue the existing Product Engine and Test Lab; do not replace their architecture.
- Preserve the customer-simulator CSV byte-for-byte. Use separate synthetic fixture-backed scenarios for added answerable facts.
- Keep all catalog values and media synthetic, tenant-scoped, and labeled as such. Do not pass evaluator-only expected values to the response model.
- The bounded evaluation was intended to use User-scope `EM-GEMINI-KEY`. The final scope check found no User-scope value and a host-injected Process-scope value; the completed replay used Process scope. Never log, persist, expose to a browser, put in a URL, or add a credential to source.
- Use Gemini only for this evaluation. Do not use external Meta, payment, courier, production, or staging services. Keep all service resources isolated and disposable.
- Commit only in this local branch. No push, merge, PR, shared release configuration, or deployment.

## Decision log

1. **Real-model evaluation follows the user's credential-scope instruction.** The successful guarded replay used a host-injected Process-scope `EM-GEMINI-KEY`; it was not a User-scope replay. After the user's later request to retry with User scope, a fresh scope check still found no User-scope value, while the host-injected Process value remained present. No new User-scope-only paid replay was available or performed. An earlier diagnostic replay used a $7.50 run ceiling. The final guarded replay uses a $0.65 per-run ceiling, no retries, single-call concurrency, a one-use reservation-bound request permit, and a Gemini-only egress guard. Run IDs, provider-reported usage, cumulative exposure accounting, and the final guarded receipt are recorded in `VERIFIED_COMMERCE_FOUNDATION_PROOF.md`.
2. **Use `gemini-3.1-flash-lite` for the bounded evaluation adapter.** Google’s current model documentation lists text/image input and stable model ID; the pricing page lists paid standard input at $0.25/1M text/image tokens and output at $1.50/1M tokens. Existing `llm.service` already implements GenerateContent and raster conversion, so reuse it instead of adding a second SDK stack. Keep production model selection unchanged.
3. **Do not count existing SVG substitutes as vision images.** The CSV contains image IDs but no source paths. Existing fixtures identify themselves as substitutes and the production media loader rejects SVG. Any real vision claim would be false until authorized raster inputs exist.
4. **Keep 200-turn results scoped.** The CSV replay can prove parser/oracle/replay coverage and deterministic/mock route behavior only. It cannot become 200 real Gemini results or broader catalog fact accuracy. Add an independent catalog suite with its own denominator.
5. **Treat missing price as unknown.** JavaScript `Number(null) === 0` is not catalog evidence; do not allow a null price to produce a BDT 0 oracle answer.
6. **Keep the autonomous simulation truthful about unavailable facts.** The first redacted real-model transcript exposed a deterministic fallback promising that a team would follow up, which the isolated zero-human-handoff Product Lab cannot guarantee. Set `EASYMOD_PRODUCT_LAB_AUTONOMOUS=1` only in Lab child processes to use retry/alternative copy and a matching prompt rule; leave the default production escalation copy and action safeguards unchanged.

## Work plan

### A. Provider safety and bounded evaluation primitives

1. Add regression tests for key lookup, header-based Gemini authentication, empty/blocked/malformed Gemini and OpenAI payloads, and provider failure accounting.
2. Update the existing provider transport to read `process.env['EM-GEMINI-KEY']` first while preserving legacy server configuration fallback; send the key in `x-goog-api-key`, never a query parameter.
3. Reject responses with no usable text or safety-blocked output so the existing provider chain can fail over. Do not include response bodies or credentials in thrown errors.
4. Add an evaluation-only request budget controller with pre-request worst-case reservations, strict request/model/vision/concurrency/output/timeout/retry caps, usage reconciliation, and pessimistic retention of reservations where provider billing is unknown.
5. Add transport-capture tests proving evaluation requests are pinned to one Gemini model, cannot fall back to another paid provider, and cannot bypass reservations. No live call is made while the key is unavailable.

### B. Product evidence and privacy corrections

6. Add failing router tests that assert customer phone/email captions are scrubbed before image extraction and that malformed/adversarial extraction JSON cannot enter prompts or retrieval as unbounded text.
7. Implement a strict allowlist/type/length sanitizer for visual observations. Keep model observations labeled as image inference and only use bounded category/color/material/search terms as retrieval hints; never promote them into verified catalog facts.
8. Ensure Gemini extraction receives the scrubbed caption and every call in an evaluation can be pinned exclusively to the approved provider by the evaluator wrapper.
9. Correct the Lab oracle so null prices remain unknown, variants are resolved deterministically, and no expected truth is sent to the model. Extend the independent fixtures for SKU combinations, missing facts, currency conflicts, tenant duplicates, and unknown stock where source contracts permit.

### C. Reproducible offline evaluation and local integration

10. Preserve and hash-check the 20-persona/200-turn CSV; run its existing full sequential replay and report deterministic/mock-provider facts separately from real-provider facts.
11. Add targeted catalog-backed cases across the four required product families and two tenants. Record evidence IDs, expected fact slots, unknown reasons, and output disposition separately.
12. Reuse the existing isolated PostgreSQL/Redis integration runner with unique ports, network, database, queue names, and Compose project. Keep provider egress fenced and test the real local worker/webhook boundaries with fake Meta transport.
13. Run the existing Product Engine Lab and Playwright suite on isolated loopback ports. Preserve browser report, screenshots, traces, console/network summaries, and accurately note skipped/unsupported scenarios.
14. Run focused provider, router, grounding, worker, adapter, Lab, and security regression suites; then run independent verification from a separate agent against the finished candidate.

### D. Proof and local handoff

15. Produce one consolidated `VERIFIED_COMMERCE_FOUNDATION_PROOF.md`, machine-readable `verified-commerce-proof.json`, and a SHA-256 manifest under `docs/ai/product-experience-v1-2/` with sanitized supporting artifacts.
16. Include exact reproduction commands, baseline and candidate SHAs, data/media provenance, denominators, execution status, test/integration/browser receipts, cost and latency scope, independent findings, and every required final status field.
17. Commit the verified work locally on the V1.2 branch. Leave other worktrees/processes, shared release configuration, production, staging, Git remotes, and the V1.1 Lab unchanged.

## Verification gates

- **Secrets/provider:** no credential fragments in diffs/artifacts/traces; no Gemini request without the exact environment key and a prior budget reservation; no key in URL.
- **Truth:** no null-to-zero conversion; no cross-tenant product or media evidence; no model-derived field treated as authoritative catalog evidence; no mocked result counted as real Gemini.
- **Offline replay:** all 200 CSV rows accounted for, source checksum unchanged, no PII/full response persisted in run receipts.
- **Integration:** disposable PostgreSQL/Redis services are project-scoped and torn down by the runner; no real Meta or business mutations.
- **Browser:** only loopback Lab traffic; reports and skips accurately described.
- **Independent review:** verifier inspects source and independently reruns selected critical tests; disagreements and residual limitations appear in the proof.
- **Release isolation:** local branch only; clean final worktree after commit; no push/merge/deployment.

## Execution outcome

- Implementation commit: `dd04c079f2b752725d372e879cb1549a8459b8d1`; evidence and privacy tooling are committed locally on top of it.
- Real-model replay: `471add4a-f2c5-44c8-8a9f-2e156a731a10`, 200 turns, 68 provider calls, `$0.01465225` committed. It used the host-injected Process-scope key because User scope was absent; no User-only retry was made.
- Browser: latest three-engine Playwright receipt `0a2e2320-569e-479d-9878-2a40030a0519` passed 6/6 with zero page, console, or failed-request observations. The download waiter was moved to immediately precede the export click after the previous WebKit run exposed a timing defect.
- Privacy: sanitized trace archives are retained; raw originals and embedded raster/opaque members are not. The final recursive scanner and independent checksum review passed.
- Integration: historical receipt `e4008ad7-468b-4a4f-9e09-fdd55a7494a1` passed 12 selected integration tests and 46 webhook tests, but records baseline SHA `78b6250a`. A current-candidate refresh did not start because Docker Desktop's local service/API was unavailable. Current-commit local integration therefore remains `NOT_RUN`.
- Final scope: local implementation is complete with limitations; broad semantic/context evaluation, real merchant/customer image evaluation, current-commit PostgreSQL/Redis integration, live Meta, payment/courier, production release, and merchant ROI remain unverified.
