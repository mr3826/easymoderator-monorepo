# Product Engine V1.3 Verification

V1.3 evaluates the existing Product Engine against an independent catalog oracle, a generated held-out set, the pinned V1.2 baseline, and a disposable local integration stack. It is a local verification workflow. It does not deploy, change production, contact live Meta customers, or establish merchant ROI.

## Run the verification

Requirements are Node.js 20, Python 3, installed backend dependencies, and a working local Docker Engine. From `EasyMod-backend` in the isolated V1.3 worktree:

```powershell
npm run verify:product-v1.3
```

This is the offline default. It removes provider credentials and all paid-photo opt-ins from child processes, forces offline Test Lab mode, and blocks live Gemini egress. It prepares source and held-out oracles, runs the isolated PostgreSQL/Redis/worker/webhook integration, runs the backend security suite, compares the V1.2 baseline and V1.3 candidate on both corpora, executes Test Lab Playwright checks, scans artifacts for privacy issues, and generates the proof package.

Real Gemini evaluation is opt-in. The exact process that launches the command must already contain `EM-GEMINI-KEY`:

```powershell
npm run verify:product-v1.3 -- --paid-gemini
```

In paid mode, the verifier links the successful candidate run from the matched Gemini comparison into the final Playwright pass. The browser checks the redacted conversation trace and the run's usage and cost display. An offline verifier can reuse a previously recorded paid candidate only when its source corpus, oracle, and backend source hash match the current checkout; otherwise that browser path is reported as not run.

The browser gate runs the installed engines serially and has a 20-minute verifier timeout. On timeout, the verifier terminates the subprocess tree and records the cleanup result. Any missing report or incomplete ZIP trace remains unmeasured and is not browser or privacy evidence. The overall verifier also applies bounded subprocess-tree cleanup; the integration runner's internal stage budgets fit inside its 50-minute outer deadline, and the backend security suite has a 45-minute deadline.

After the verification receipt is finalized, the verifier regenerates the proof from that completed receipt, refreshes the archived Markdown copy, then runs one final privacy scan and checksum-manifest pass. It checks that the resulting manifest contains the current hashes of both the completed receipt and archived proof. This final pass runs after the receipt is frozen so its hashes are not invalidated by later receipt writes.

Do not save the key in this repository, a `.env` file, or a persistent Windows environment variable. The outer paid verifier passes its process-scoped key only to the paid comparison child; a separately authorized direct diagnostic inherits only the key already present in its launching process. Neither path writes the key to evidence. The default persistent campaign ledger at `artifacts/campaigns/v13-cf6f18b2-2a9a-4831-ad42-2b8509bfcd35/budget-ledger.json` enforces a cumulative ceiling of $2, at most 256 provider requests, and at most 12 vision requests. Each matched-arm invocation has a local limit of 128 requests and 6 vision requests. These per-invocation limits are not durable per-arm quotas: a repeated invocation under the same campaign can use remaining campaign-wide allowance. The persistent ledger continues to enforce the combined $2 / 256 / 12 caps, and prior usage remains charged. For a separately authorized fresh evaluation, set process-scoped `LAB_CAMPAIGN_ID` to a new unique ID; the new ledger retains the same caps, and existing ledgers must never be reset or overwritten. Provider cost in the report is estimated from reported tokens; an invoice is not available.

A separate Gemini Pro photo diagnostic is gated behind `LAB_GEMINI_PRO_PHOTO_PROBE=1` in `lab-replay.test.js`. It requires the exact process-scoped `EM-GEMINI-KEY`, `LAB_RUN_MODE=real-gemini`, `EASYMOD_LIVE_GEMINI_EGRESS=1`, a fresh `LAB_PRO_PHOTO_CAMPAIGN_ID`, and a result path under the evidence `runs/` directory. It uses only the three registered, checksum-verified public photos and the production extraction prompt, pins requests to `gemini-3.1-pro-preview`, and caps each new campaign at three requests and three vision requests (the tested campaigns used $0.22 or $0.30 ceilings). The first run used the production route's 250-token output limit; the model consumed 236–240 thought tokens and left 6–10 candidate tokens, so it was inconclusive about recognition. The second run used the 1,024-token output window with provider-default high thinking and still left only 39–41 candidate tokens; its 0/3 category and color result was also inconclusive. The third run set `thinkingLevel: low` and used 1,024 output tokens. All three requests ended with `STOP`, returned 93/115/111 candidate tokens, matched visible color 3/3, and matched garment category 0/3: the yellow fixture was labeled `shirt`, and the other two categories were null. No unverified material fields were populated. Raw provider text was not retained, and the evaluation parser at that time rejected slash-separated category labels allowed by the production prompt, so the 0/3 category result cannot be attributed solely to the model. The receipt's `schemaValid` value only means at least one safe label reached scoring; it is not full schema validation. The third receipt's runner hash omitted the newly added diagnostic transport; the run is therefore not fully code-attested. The source hasher now includes the transport and test, and new diagnostic receipts store the transport's own SHA-256, but that correction does not retroactively bind the earlier request. Production still uses Gemini Lite with its 250-token limit; no model or production configuration changed. The Pro diagnostics remain outside the default verifier and cannot override the 3/3 category-and-color acceptance gate. Each invocation uses a unique ledger stage so reused local call IDs accrue separately. The rate snapshot uses the standard tier below 200k input tokens; see Google's [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing), [thinking controls](https://ai.google.dev/gemini-api/docs/generate-content/thinking), and [Gemini 3.1 Pro model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview).

The three Pro photo campaigns report 9 requests, $0.075174 estimated usage, and $0.406026 worst-case reserved exposure across $0.82 in per-campaign ceilings; invoices are unavailable. Across 15 distinct V1.3 campaign ledgers in the local evidence roots, deduplicated by campaign ID to each latest ledger, there are 1,641 requests, 85 vision requests, and five unknown-usage calls whose reservations are included. The token-priced estimate is $0.413597265 and worst-case reserve is $3.348410013. The prior V1.2 proof separately records $2.339732750 conservative task-series exposure. Combined reserved exposure is $5.688142763, leaving $4.311857237 against the authorized $10 by manual reconciliation. Individual campaign ceilings sum to $21.42 and do not enforce a shared $10 cap; these amounts are estimates and reservations, not provider invoices. The proof generator records the deduplicated ledger paths and hashes.

A separate corrected-scorer Gemini Lite photo diagnostic is opt-in and is not part of ordinary offline verification. It requires the process-scoped `EM-GEMINI-KEY`, `LAB_RUN_MODE=real-gemini`, `EASYMOD_LIVE_GEMINI_EGRESS=1`, `LAB_GEMINI_LITE_PHOTO_DIAGNOSTIC=1`, a fresh `LAB_GEMINI_LITE_PHOTO_CAMPAIGN_ID`, a UUID `LAB_RUN_ID`, and a result path beneath the selected evidence root's `runs/` directory. It calls the existing Gemini Lite production route for only the three checksum-verified licensed public photos, permits three requests and three vision requests, sets concurrency to one and retries to zero, and enforces a $0.30 campaign ceiling. It stores only redacted provider/customer output and the token-priced estimate; provider invoices are unavailable. This diagnostic measures visible category/color only: it does not score catalog SKU identity or cover the other 14 required visual case types. It corrects a scorer allowlist that previously rejected slash-separated categories such as `kurta/panjabi`.

The clean bounded run on commit `ed7b4e05` executed all three licensed photos through Gemini Lite and passed the diagnostic harness. It matched visible color on 3/3 photos and garment category on 2/3; the yellow kurta was still labeled `shirt`. Catalog identity was not scored. The token-priced estimate was $0.00150575 with $0.014586 worst-case reserved in its $0.30 campaign; an invoice is unavailable. This result does not satisfy the 3/3 visible-category gate.

The full paid comparison on commit `bc48f08b` executed all 200 source turns on both engines. V1.3 verified 18/18 eligible fact slots and 15/15 answerable turns, with zero unsupported claims, false refusals, context failures, or unsafe cross-domain handoffs and 4/4 safe handoffs. Its three photo cases matched category on 2/3 and visible color on 3/3; catalog identity was not scored. The Gemini text-quality gate passed, but overall automated QA is `FAIL` and integration readiness is `NO` because the photo gate fails and only 1/15 required visual case types is represented. V1.3 estimated provider cost was $0.021387 versus $0.01162125 for V1.2 ($0.03300825 combined); route p95 was 5,474.157 ms versus 5,311.009 ms. These are token estimates, not invoices. See the [full verification proof](PRODUCT_ENGINE_V1_3_INTEGRATION_CUSTOMER_TRUTH_PROOF.md).

Example from `EasyMod-backend` (the key must already exist in the current PowerShell process; the boolean check does not reveal it):

```powershell
[bool](-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('EM-GEMINI-KEY', 'Process')))
$env:LAB_RUN_MODE = 'real-gemini'
$env:EASYMOD_LIVE_GEMINI_EGRESS = '1'
$env:LAB_GEMINI_LITE_PHOTO_DIAGNOSTIC = '1'
$env:LAB_GEMINI_LITE_PHOTO_CAMPAIGN_ID = "v13-gemini-lite-photo-diagnostic-$([guid]::NewGuid().ToString('N'))"
$env:LAB_RUN_ID = [guid]::NewGuid().ToString()
$env:LAB_ARTIFACT_ROOT = 'D:\\easymod\\_product-engine-v1-3-evidence-final-20261022-09'
$env:LAB_GEMINI_LITE_PHOTO_RESULT_PATH = Join-Path $env:LAB_ARTIFACT_ROOT "runs\\$($env:LAB_RUN_ID).lite-photo.json"
node node_modules/jest/bin/jest.js --config jest.product-engine-v1-3.config.js --runInBand --runTestsByPath scripts/product-experience/lab-replay.test.js --testNamePattern="runs a bounded three-photo Gemini Lite diagnostic and preserves redacted provider output" --coverage=false
```

Use a fresh campaign ID and an evidence root that already has a `runs/` directory. The campaign ledger refuses reuse and the diagnostic output uses create-new semantics; never reset or overwrite a prior ledger.

From `EasyMod-backend`, with those variables set for the current process:

```powershell
node node_modules/jest/bin/jest.js --config jest.product-engine-v1-3.config.js --runInBand --runTestsByPath scripts/product-experience/lab-replay.test.js --testNamePattern="runs a three-photo Gemini Pro diagnostic with low thinking and a bounded output window" --coverage=false
```

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

The proof quality gate requires zero unsupported price claims, false refusals, context-resolution failures, and unsafe cross-domain handoffs, plus complete correct coverage of the oracle's fact slots and answerable turns. It also requires complete evaluated-turn coverage for false-refusal, context-resolution, and cross-domain handoff metrics; skipped or incomplete turns are reported as not evaluable. It applies to deterministic source evidence and the paid Gemini candidate when recorded. Paid quality also requires every source turn to execute on the route, with the executed-turn count matching the source oracle. Empty or missing denominators, incomplete route or quality coverage, or paid-run/current evaluation-runner hash drift cannot produce a readiness pass; a measured quality regression produces `AUTOMATED_QA_VERDICT=FAIL`.

The genuine-photo accuracy check requires at least three distinct, executed, checksum-verified licensed photos. A vision pass requires correct visible category, visible color, and catalog identity on every scored photo; any measured miss fails, while an unscored catalog identity leaves the vision verdict `NOT_MEASURED`. Full integration readiness also requires all 15 specified visual scenario types to be represented and evaluated. The current three public fixtures are not matched to the seeded catalog and represent only the clean single-product case, so identity accuracy and the other 14 cases are unmeasured; they do not establish customer-upload accuracy. The extraction prompt classifies a South Asian tunic by its complete visible silhouette and hemline before collar or construction details: a visible hem below mid-thigh maps to `kurta/panjabi` even with a shirt-style collar, button placket, or chest pocket. A shirt label is reserved for a visible hem that clearly ends at the hip or shorter; an ambiguous cropped or hidden hem returns null rather than a guessed label.

The proof labels the zero-provider replay result `DETERMINISTIC_SOURCE_TRUTH_VERDICT` and reports paid-run quality separately as `REAL_GEMINI_QUALITY_VERDICT`. The compatibility field `CUSTOMER_TRUTH_VERDICT` is scoped to deterministic source replay only; it does not summarize paid Gemini performance.

For customer photos, visual extraction is treated as untrusted retrieval evidence, not a merchant-confirmed product fact. Fabric composition is always discarded from the extracted result because a photograph cannot verify it. A photo can identify a catalog item only when both category and color were extracted and exactly one catalog product verifies against them. Missing or invalid extraction, missing facets, no match, or multiple verified matches produce a deterministic clarification; candidate products, prices, images, and context pointers are withheld, and the reply model is not allowed to invent an identity. A catalog retrieval failure follows the existing retrieval-failure path. When photo matching is disabled, the customer is told photo matching is unavailable rather than being told that an unperformed match failed. When photo analysis is enabled and several photos arrive together, the customer is told that only the first was inspected. The public-photo quality check records raw visual observations separately from the final customer-facing response.

Explicit garment names in a follow-up are checked against the last grounded product category before context is reused. In particular, kurta/panjabi, sari/saree, shirt and other supported garment names use the existing category taxonomy; a conflicting or category-unmapped supported reference starts a fresh shop-scoped catalog lookup instead of inheriting the prior item's facts.

The same outbound gate protects turns with `NONE` product evidence: generated subjectless, named, generic-product, and deictic stock claims cannot create catalog facts without a verified product. Delivery-option wording and bare bKash/Nagad availability route through their respective shop-policy checks. Generic payment availability requires at least one authoritative accepted method, and payment-only statements are evaluated independently of product lookup status. Delivery assertions require an explicit delivery policy; payment section headings, COD acceptance, fee-only text, and unscoped policies do not authorize a delivery area or timeline. Product stock and variant claims remain independently checked when a reply also contains a separate delivery-policy aside, including parenthetical and em-dash forms.

The safe handoff scorer accepts explicit missing-policy statements such as “I do not have information about the exchange policy” and “I do not have confirmed information regarding the exchange policy,” provided any answerable product facts are correct. Unsupported policy claims still fail the handoff score.

`AUTOMATED_QA_VERDICT=PASS` means the recorded local gates passed. `INTEGRATION_READY=YES` additionally requires matching paid-run runner provenance, all three photo category/color checks, and the independent review. The Markdown proof keeps deterministic in-process timing separate from paid route/provider timing and reports paid baseline outcomes, including cost and latency regressions. It includes only the replay's already-redacted customer examples and re-scrubs email and Bangladesh phone patterns before rendering. The artifact scanner permits exact source-text overlap only on the consolidated proof's labeled redacted message/reply lines and still rejects any profile name, address, email, phone or contact match there; exact matches elsewhere remain a failure. Neither status authorizes a production release.

## Artifacts

The authoritative report is [PRODUCT_ENGINE_V1_3_INTEGRATION_CUSTOMER_TRUTH_PROOF.md](PRODUCT_ENGINE_V1_3_INTEGRATION_CUSTOMER_TRUTH_PROOF.md). Its machine-readable equivalent is `artifacts/product-engine-v1.3-proof.json`.

Reproducible outputs are grouped under `artifacts/`:

- `benchmarks/` — source and held-out oracles and the generated synthetic held-out questions.
- `comparisons/` and `runs/` — deterministic and paid baseline/candidate receipts and redacted transcripts.
- `integration/` — disposable database, Redis, webhook, worker, and full backend receipts.
- `playwright/` — browser result, screenshots, and sanitized traces.
- `security/` — trace-sanitization report, privacy scan, egress evidence, and checksum manifest. The verifier redacts simulator text from Playwright archives before scanning, records unpriced provider calls with the estimate, and refreshes the final scan after the completed receipt and archived proof are frozen.
- `reports/` — a synchronized proof Markdown copy that is included in the privacy scan and checksum manifest.
- `regression/` — verification entrypoint receipts.
- `campaigns/` — cumulative provider-call and cost ledger.

The proof Markdown reports scenario IDs and measured outcomes without printing literal source customer messages or model replies. Its evidence-root copy is scanned and checksummed. The source CSV itself, secret values, raw provider credentials, production records, and live Meta messages are not copied into the evidence package.

## Decision record

See [MULTI_AGENT_DECISION_RECORD.md](MULTI_AGENT_DECISION_RECORD.md) for the observed defects, implemented changes, rejected scope, and review findings. A separate read-only review is recorded in [INDEPENDENT_VERIFICATION.md](INDEPENDENT_VERIFICATION.md) after the final candidate is frozen.
