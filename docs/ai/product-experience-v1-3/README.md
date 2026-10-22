# Product Engine V1.3 Verification

V1.3 evaluates the existing Product Engine against an independent catalog oracle, a generated held-out set, the pinned V1.2 baseline, and a disposable local integration stack. It is a local verification workflow. It does not deploy, change production, contact live Meta customers, or establish merchant ROI.

## Run the verification

Requirements are Node.js 20, Python 3, installed backend dependencies, and a working local Docker Engine. From `EasyMod-backend` in the isolated V1.3 worktree:

```powershell
npm run verify:product-v1.3
```

This is the offline default. It removes provider credentials from child processes and blocks live Gemini egress. It prepares source and held-out oracles, runs the isolated PostgreSQL/Redis/worker/webhook integration, runs the backend security suite, compares the V1.2 baseline and V1.3 candidate on both corpora, executes Test Lab Playwright checks, scans artifacts for privacy issues, and generates the proof package.

Real Gemini evaluation is opt-in. The exact process that launches the command must already contain `EM-GEMINI-KEY`:

```powershell
npm run verify:product-v1.3 -- --paid-gemini
```

In paid mode, the verifier links the successful candidate run from the matched Gemini comparison into the final Playwright pass. The browser checks the redacted conversation trace and the run's usage and cost display. An offline verifier can reuse a previously recorded paid candidate only when its source corpus, oracle, and backend source hash match the current checkout; otherwise that browser path is reported as not run.

The browser gate runs the installed engines serially and has a 20-minute verifier timeout. On timeout, the verifier terminates the subprocess tree and records the cleanup result. Any missing report or incomplete ZIP trace remains unmeasured and is not browser or privacy evidence. The overall verifier also applies bounded subprocess-tree cleanup; the integration runner's internal stage budgets fit inside its 50-minute outer deadline, and the backend security suite has a 45-minute deadline.

The key is passed only to the paid comparison child. Do not save it in this repository, a `.env` file, or a persistent Windows environment variable. The default persistent campaign ledger at `artifacts/campaigns/v13-cf6f18b2-2a9a-4831-ad42-2b8509bfcd35/budget-ledger.json` enforces a cumulative ceiling of $2, at most 256 provider requests, and at most 12 vision requests. Each matched-arm invocation has a local limit of 128 requests and 6 vision requests. These per-invocation limits are not durable per-arm quotas: a repeated invocation under the same campaign can use remaining campaign-wide allowance. The persistent ledger continues to enforce the combined $2 / 256 / 12 caps, and prior usage remains charged. For a separately authorized fresh evaluation, set process-scoped `LAB_CAMPAIGN_ID` to a new unique ID; the new ledger retains the same caps, and existing ledgers must never be reset or overwritten. Provider cost in the report is estimated from reported tokens; an invoice is not available.

## Local integration boundaries

The integration runner starts uniquely named Postgres and Redis services for the test, binds host ports to loopback, uses disposable storage, applies migrations, runs the real worker and webhook tests, and removes only its own Compose project. It selects a non-overlapping Docker subnet and does not stop or reconfigure unrelated services.

The fake Meta transport captures test sends. Passing those tests shows behavior against the test transport; it does not show live Meta delivery. The browser runner starts a temporary loopback Test Lab and stops it when Playwright finishes, so it does not promise a persistent Test Lab URL.

## Evidence and metric definitions

The original `customer-simulator.csv` remains outside the repository and is read-only input. Its advisory answer column is not used as catalog truth. The normalized oracle uses a versioned two-tenant catalog fixture and reports answerability by text-only turns; source turns that require image pixels are excluded from text denominators.

Important distinctions in the reports:

- `VERIFIED_CORRECT_ANSWERS` counts answerable fact slots whose expected catalog value was included in approved output with a `SEND` disposition. Fully answered turns are reported separately.
- False refusals count eligible product fact slots on an executed answerable turn when the router withholds the answer or says it cannot find the product despite the oracle marking that turn answerable. A current turn is grounded when it has `VERIFIED` evidence for the exact product and a matching contract-valid `READY` presentation. A context-only turn without that current evidence requires every earlier turn to have executed and an earlier assistant turn to have had a `SEND` disposition for a non-refusal answer with a contract-valid `READY` presentation grounding the same product. Verified catalog evidence recorded before outbound policy does not establish approved assistant output. An intervening `NOT_FOUND` clears the active context. Expected context-only turns without the complete grounding chain remain not evaluable. Provider failures and budget-skipped turns are not scored as model responses. A `SEND` disposition in replay does not establish actual Messenger delivery.
- `INCORRECT_PRODUCT_ANSWERS` is not separately measured. The proof reports `incorrectOrUnansweredFactSlots`, which includes partial answers and false refusals; it must not be read as a count of incorrect answers.
- The measured unsupported-claim counter is specifically unsupported price claims in approved output with a `SEND` disposition. Other unverified assertions are subject to the outbound grounding gate and security tests; replay disposition does not establish live Messenger delivery.
- Provider costs are token-based estimates, not billing records. Cost per verified product-answer turn uses complete verified answer turns; cost per verified fact slot is reported separately. Comparison request totals are attempts; on a valid paid comparison, `REAL_GEMINI_TEXT_REQUESTS` and `REAL_GEMINI_VISION_REQUESTS` count provider-reported calls from both matched-arm ledgers. For an invalid or incomplete pair, matched-pair quality, cost, and photo accuracy are `NOT_MEASURED`; observed request attempts, provider-reported calls, and priced usage remain separately available from the cumulative campaign ledger. A rejected or pending reservation without provider usage is not a provider-reported call. Router timings exclude webhook, queue, database, and customer network latency.
- Three licensed public photos are a small vision probe. They are not source-dataset photos or a representative customer-upload accuracy study.
- Synthetic conversations do not establish customer acceptance, merchant time saved, sales conversion, adoption, or ROI.

The proof quality gate requires zero unsupported price claims, false refusals, context-resolution failures, and unsafe cross-domain handoffs, plus complete correct coverage of the oracle's fact slots and answerable turns. It also requires complete evaluated-turn coverage for false-refusal, context-resolution, and cross-domain handoff metrics; skipped or incomplete turns are reported as not evaluable. It applies to deterministic source evidence and the paid Gemini candidate when recorded. Empty or missing denominators, incomplete quality metrics, or paid-run/current evaluation-runner hash drift cannot produce a readiness pass; a measured quality regression produces `AUTOMATED_QA_VERDICT=FAIL`.

The proof labels the zero-provider replay result `DETERMINISTIC_SOURCE_TRUTH_VERDICT` and reports paid-run quality separately as `REAL_GEMINI_QUALITY_VERDICT`. The compatibility field `CUSTOMER_TRUTH_VERDICT` is scoped to deterministic source replay only; it does not summarize paid Gemini performance.

For customer photos, visual extraction is treated as untrusted retrieval evidence, not a merchant-confirmed product fact. Fabric composition is always discarded from the extracted result because a photograph cannot verify it. A photo can identify a catalog item only when both category and color were extracted and exactly one catalog product verifies against them. Missing or invalid extraction, missing facets, no match, or multiple verified matches produce a deterministic clarification; candidate products, prices, images, and context pointers are withheld, and the reply model is not allowed to invent an identity. A catalog retrieval failure follows the existing retrieval-failure path. When photo analysis is enabled and several photos arrive together, the customer is told that only the first was inspected. The public-photo quality check records raw visual observations separately from the final customer-facing response.

The same outbound gate protects turns with `NONE` product evidence: generated subjectless, named, generic-product, and deictic stock claims cannot create catalog facts without a verified product. Delivery-option wording and bare bKash/Nagad availability route through their respective shop-policy checks. Generic payment availability requires at least one authoritative accepted method, and payment-only statements are evaluated independently of product lookup status. Delivery assertions require an explicit delivery policy; payment section headings, COD acceptance, fee-only text, and unscoped policies do not authorize a delivery area or timeline. Product stock and variant claims remain independently checked when a reply also contains a separate delivery-policy aside, including parenthetical and em-dash forms.

The safe handoff scorer accepts explicit missing-policy statements such as “I do not have information about the exchange policy,” provided any answerable product facts are correct. Unsupported policy claims still fail the handoff score.

`AUTOMATED_QA_VERDICT=PASS` means the recorded local gates passed. `INTEGRATION_READY=YES` additionally requires matching paid-run runner provenance, all three photo category/color checks, and the independent review. Neither status authorizes a production release.

## Artifacts

The authoritative report is [PRODUCT_ENGINE_V1_3_INTEGRATION_CUSTOMER_TRUTH_PROOF.md](PRODUCT_ENGINE_V1_3_INTEGRATION_CUSTOMER_TRUTH_PROOF.md). Its machine-readable equivalent is `artifacts/product-engine-v1.3-proof.json`.

Reproducible outputs are grouped under `artifacts/`:

- `benchmarks/` — source and held-out oracles and the generated synthetic held-out questions.
- `comparisons/` and `runs/` — deterministic and paid baseline/candidate receipts and redacted transcripts.
- `integration/` — disposable database, Redis, webhook, worker, and full backend receipts.
- `playwright/` — browser result, screenshots, and sanitized traces.
- `security/` — trace-sanitization report, privacy scan, egress evidence, and checksum manifest. The verifier redacts simulator text from Playwright archives before scanning and records unpriced provider calls with the estimate.
- `reports/` — a synchronized proof Markdown copy that is included in the privacy scan and checksum manifest.
- `regression/` — verification entrypoint receipts.
- `campaigns/` — cumulative provider-call and cost ledger.

The proof Markdown reports scenario IDs and measured outcomes without printing literal source customer messages or model replies. Its evidence-root copy is scanned and checksummed. The source CSV itself, secret values, raw provider credentials, production records, and live Meta messages are not copied into the evidence package.

## Decision record

See [MULTI_AGENT_DECISION_RECORD.md](MULTI_AGENT_DECISION_RECORD.md) for the observed defects, implemented changes, rejected scope, and review findings. A separate read-only review is recorded in [INDEPENDENT_VERIFICATION.md](INDEPENDENT_VERIFICATION.md) after the final candidate is frozen.
