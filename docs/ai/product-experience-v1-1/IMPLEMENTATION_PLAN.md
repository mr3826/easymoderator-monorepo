# Product Engine V1.1 — Implementation and Verification Plan

Baseline: `c8981c4df9ea84d47c35f2541884fd55afd64bae` on isolated branch `feature/ai-product-experience-v1.1`.

## Phase 1 — Baseline and safety inventory

- Record V1 report/artifact hashes, the CSV hash and safe dataset counts, active-worktree inventory, and baseline deterministic replay receipts.
- Verify the selected Node runtime and dependency availability.
- Review disposable integration Compose and teardown behavior; reserve unique loopback ports and a unique project name. Never connect to an existing V4/V5/V6 service.
- Write explicit secret, PII, egress, and no-side-effect boundaries.

## Phase 2 — Evidence oracle and replay contract (TDD)

- Add tests first for safe dataset classification, oracle denominator, persona ordering/isolation, unknown attributes, variants, currency, stock, policies, image authority, and prohibited commitments.
- Add a deterministic synthetic catalog and independent oracle keyed by scenario/turn IDs; CSV suggestions do not become labels.
- Reuse the actual intent router, production grounding gate, product-presentation builder, and outbound gate with controlled collaborators.
- Produce repeatable structured 200-turn receipts with eligible/answerable, correct, hallucination, false-refusal, safe-fallback, and out-of-scope denominators.

## Phase 3 — Local Test Lab service and persistence

- Add the loopback-only HTTP host, fixed API, token/Host/Origin checks, request limits, no-shell/no-arbitrary-path handling, safe text serialization, and run registry.
- Add pinned baseline/candidate execution receipts, comparison, evidence inspection, cost/latency event recording, failure reproduction, history, and redacted exports.
- Add automated tests before each behavior and ensure shutdown only terminates the Lab process and its owned child processes.

## Phase 4 — Real local backend integration

- Extend or create a unique-per-run disposable Postgres/Redis Compose launcher with dynamic/verified ports, unique project/container/volume labels, and narrowly scoped teardown.
- Apply actual migrations and exercise catalog persistence, router/evidence/grounding, webhook-shaped inbound flow, durable receipt, queue/worker, and outbound adapter with external providers mocked and network denied.
- Cover retries, duplicates, ordering, concurrent catalog updates, and service failures. Retain redacted receipts.
- Rerun protected cross-domain regression suites relevant to the touched boundaries.

## Phase 5 — Browser Lab and E2E (TDD)

- Add a small static Lab UI outside merchant app bootstrap and a dedicated Playwright config that starts only the Lab host and never reuses an unknown server.
- Implement overview, explorer, replay, comparison, evidence inspector, cost, triage, playground, history, and exports against the live Lab API.
- Add browser tests for the goal's required journeys, screenshots, traces, desktop/tablet/mobile behavior, accessible names/keyboard flow, and Chromium/WebKit/Firefox when available.
- Keep result provenance visible and reject demo/static fixtures as execution evidence.

## Phase 6 — Product correction and evaluation

- Run original 200 sequential turns and targeted synthetic answerable catalog scenarios.
- Reproduce each P0/P1/P2 defect, identify root cause, implement the smallest safe fix, and rerun focused, cross-domain, full replay, and affected E2E checks.
- Run real provider/vision only if credentials and a finite hard-enforced spend/call budget are available; otherwise record `NOT_RUN` without estimates presented as actual results.
- Compare the baseline and candidate using the same pinned scenarios, with actual run IDs and source revisions.

## Phase 7 — Independent review and final evidence

- A separate reviewer inspects all changes, environment isolation, code, reports, costs, and artifacts; independently reruns critical deterministic, integration, and browser checks.
- Generate the 11 required Markdown reports, machine-readable gate results, structured turn output, logs, screenshots, traces, and exports under `docs/ai/product-experience-v1-1/`.
- Verify report counts against machine-readable evidence and ensure artifacts contain no raw source messages, credentials, or contact details.
- Commit locally on the V1.1 branch only; do not push, merge, deploy, change production, or send real Meta messages.

## Exit criteria

V1.1 local implementation is complete only when the Lab runs locally, its supported journeys pass automated browser checks, the 200-turn execution emits auditable denominators, the isolated real-stack integration has receipts, independent review has reproduced critical checks, and required reports accurately disclose any external `NOT_RUN` gates. `INTEGRATION_READY=YES` additionally requires every required integration layer to have passed.
