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

In paid mode, the verifier links the successful candidate run from the matched Gemini comparison into the final Playwright pass. The browser checks the redacted conversation trace and the run's usage and cost display; offline mode reports that path as not run.

The key is passed only to the paid comparison child. Do not save it in this repository, a `.env` file, or a persistent Windows environment variable. The persistent campaign ledger at `artifacts/campaigns/v13-cf6f18b2-2a9a-4831-ad42-2b8509bfcd35/budget-ledger.json` enforces a cumulative ceiling of $2, at most 256 provider requests, and at most 12 vision requests. Existing usage remains charged against those caps. Provider cost in the report is estimated from reported tokens; an invoice is not available.

## Local integration boundaries

The integration runner starts uniquely named Postgres and Redis services for the test, binds host ports to loopback, uses disposable storage, applies migrations, runs the real worker and webhook tests, and removes only its own Compose project. It selects a non-overlapping Docker subnet and does not stop or reconfigure unrelated services.

The fake Meta transport captures test sends. Passing those tests shows behavior against the test transport; it does not show live Meta delivery. The browser runner starts a temporary loopback Test Lab and stops it when Playwright finishes, so it does not promise a persistent Test Lab URL.

## Evidence and metric definitions

The original `customer-simulator.csv` remains outside the repository and is read-only input. Its advisory answer column is not used as catalog truth. The normalized oracle uses a versioned two-tenant catalog fixture and reports answerability by text-only turns; source turns that require image pixels are excluded from text denominators.

Important distinctions in the reports:

- `VERIFIED_CORRECT_ANSWERS` counts answerable fact slots whose expected catalog value was included in a sent response. Fully answered turns are reported separately.
- `INCORRECT_PRODUCT_ANSWERS` is not separately measured. The proof reports `incorrectOrUnansweredFactSlots`, which includes partial answers and false refusals; it must not be read as a count of incorrect answers.
- The measured unsupported-claim counter is specifically unsupported price claims sent. Other unverified assertions are subject to the outbound grounding gate and security tests.
- Provider costs are token-based estimates, not billing records. Router timings exclude webhook, queue, database, and customer network latency.
- Three licensed public photos are a small vision probe. They are not source-dataset photos or a representative customer-upload accuracy study.
- Synthetic conversations do not establish customer acceptance, merchant time saved, sales conversion, adoption, or ROI.

`AUTOMATED_QA_VERDICT=PASS` means the recorded local gates passed. `INTEGRATION_READY=YES` additionally requires the independent review and the defined product-quality gates. Neither status authorizes a production release.

## Artifacts

The authoritative report is [PRODUCT_ENGINE_V1_3_INTEGRATION_CUSTOMER_TRUTH_PROOF.md](PRODUCT_ENGINE_V1_3_INTEGRATION_CUSTOMER_TRUTH_PROOF.md). Its machine-readable equivalent is `artifacts/product-engine-v1.3-proof.json`.

Reproducible outputs are grouped under `artifacts/`:

- `benchmarks/` — source and held-out oracles and the generated synthetic held-out questions.
- `comparisons/` and `runs/` — deterministic and paid baseline/candidate receipts and redacted transcripts.
- `integration/` — disposable database, Redis, webhook, worker, and full backend receipts.
- `playwright/` — browser result, screenshots, and sanitized traces.
- `security/` — privacy scan, egress evidence, and checksum manifest.
- `regression/` — verification entrypoint receipts.
- `campaigns/` — cumulative provider-call and cost ledger.

The source CSV itself, secret values, raw provider credentials, production records, and live Meta messages are not copied into the evidence package.

## Decision record

See [MULTI_AGENT_DECISION_RECORD.md](MULTI_AGENT_DECISION_RECORD.md) for the observed defects, implemented changes, rejected scope, and review findings. A separate read-only review is recorded in [INDEPENDENT_VERIFICATION.md](INDEPENDENT_VERIFICATION.md) after the final candidate is frozen.
