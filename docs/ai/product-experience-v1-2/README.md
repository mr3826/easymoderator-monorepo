# Product Experience V1.2 — Verified Commerce Foundation

This folder contains the implementation plan, acceptance evidence, and operator notes for the local Product Engine and Test Lab work on branch `feature/verified-commerce-foundation-v1.2`.

## Product behavior

- Product and variant facts come from tenant-scoped catalog evidence. Missing price, stock, or variant values remain unknown.
- A model may help interpret customer language or describe a supplied image. Those observations are retrieval hints and do not become verified catalog facts.
- The outbound grounding gate checks the final text and media against current product, tenant, and source evidence before delivery.
- Catalog values and the four registered raster images used by the synthetic vision cases are fixtures. They do not represent a merchant's live catalog or customer media.
- Customer CSV replay, synthetic catalog evaluation, mocked baseline/candidate route comparison, and real Gemini evaluation are distinct measurements. Use their own denominators and provider provenance.

## Local evaluation

Run commands from `EasyMod-backend/` in the intended V1.2 checkout. Keep the customer-simulator CSV read-only. Its SHA-256 is recorded in the proof artifact.

Offline and local integration checks:

```powershell
node node_modules/jest/bin/jest.js scripts/product-experience/lab-contracts.test.js scripts/product-experience/lab-scorer.test.js scripts/product-experience/evaluation-budget.test.js scripts/product-experience/gemini-evaluation-client.test.js scripts/product-experience/no-egress.test.js scripts/product-experience/lab-process.test.js scripts/product-experience/lab-replay.test.js src/modules/ai/grounding/__tests__/product-evidence-hardening.test.js src/modules/ai/grounding/__tests__/product-presentation.contract.test.js src/modules/ai/__tests__/intent-router.test.js src/modules/ai/__tests__/llm-response-contract.test.js --runInBand --coverage=false
python scripts/product-experience/test_scan_artifact_privacy.py
python scripts/product-experience/test_sanitize_playwright_traces.py
node scripts/product-experience/run-integration.js
node scripts/product-experience/run-lab-playwright.js
python scripts/product-experience/sanitize-playwright-traces.py
python scripts/product-experience/sanitize-playwright-traces.py --metadata-only
python scripts/product-experience/scan-artifact-privacy.py
```

The integration runner provisions a project-scoped PostgreSQL/Redis pair with temporary storage, binds service ports to loopback, disables bridge IP masquerading, blocks non-loopback Node API egress, and removes its Compose project at the end. It does not start Meta, payment, courier, staging, or production integrations.

The paid provider replay is opt-in. The isolated Jest process reads only `EM-GEMINI-KEY` from its process environment; the PowerShell example below seeds it from User scope, or reuses a value already injected into Process scope by the host. It pins `gemini-3.1-flash-lite`, uses a maximum `$0.65` per-run ceiling, reserves before transport, allows no retries and one concurrent request, and uses a one-use permit bound to the exact model endpoint, request body digest, serialized body size, output cap, and reservation. The ceiling is per run; cumulative task spend is accounted manually across run ledgers. The Node egress guard rejects unpermitted Gemini fetches and direct Gemini DNS/TCP. This is an API-level Node guard, not an OS firewall.

The Lab replay view exposes the customer input, raw Gemini candidate, and validated reply only as redacted strings, with each field labeled in an expandable conversation trace. Cost & Latency shows provider-reported spend, request count, vision count, and measured token totals when recorded. Set `LAB_REAL_GEMINI_RUN_ID` to an existing local real-provider receipt before running the Playwright wrapper to verify the saved trace and budget in the UI. The browser runner executes the full journey in every installed Chromium, Firefox, and WebKit engine and writes per-browser accessibility and console/network observations; no key is passed to the browser process.

After evaluations, sanitize Playwright archives before running `scan-artifact-privacy.py`. The sanitizer recursively redacts simulator text and archive member names, drops ZIP comments and extra metadata, and removes raster and opaque binary members. The normal pass redacts payloads; `--metadata-only` repeats the archive metadata scrub without rewriting already-redacted text. The scanner checks exact simulator text in JSON and standalone text artifacts, accepts exact matches only inside redacted JSON input fields and redacted transcript customer lines, checks source contact sequences and archive metadata, scans every unique text member in sanitized Playwright ZIPs, and reports raster counts. The privacy gate fails on unsafe exact-source matches in JSON/text, any exact-source match in an archive, source contact matches, denied fields, parse errors, or heuristic phone/address/profile-name matches. The evidence package retains sanitized Playwright archives, not their raw originals. Raster captures inside archives are removed; standalone screenshots remain available for visual review. The scanner does not OCR raster images, so inspect screenshots separately.

Local Lab child processes set `EASYMOD_PRODUCT_LAB_AUTONOMOUS=1`. In that isolated mode, unavailable catalog or policy facts produce an honest retry/alternative response without promising a person will follow up. With the variable unset, the existing production human-escalation response copy and action safeguards remain in effect; the Lab flag does not change production configuration or authorize orders or sends.

PowerShell example; it never prints or writes the credential to a file:

```powershell
$providerKey = [Environment]::GetEnvironmentVariable('EM-GEMINI-KEY', 'User')
if ([string]::IsNullOrWhiteSpace($providerKey)) {
    $providerKey = [Environment]::GetEnvironmentVariable('EM-GEMINI-KEY', 'Process')
}
if ([string]::IsNullOrWhiteSpace($providerKey)) { throw 'EM-GEMINI-KEY is unavailable to this shell.' }
try {
    [Environment]::SetEnvironmentVariable('EM-GEMINI-KEY', $providerKey, 'Process')
    [Environment]::SetEnvironmentVariable('EASYMOD_LIVE_GEMINI_EGRESS', '1', 'Process')
    [Environment]::SetEnvironmentVariable('EASYMOD_PRODUCT_LAB_AUTONOMOUS', '1', 'Process')
    [Environment]::SetEnvironmentVariable('LAB_RUN_SCOPE', 'full', 'Process')
    [Environment]::SetEnvironmentVariable('LAB_RUN_MODE', 'real-gemini', 'Process')
    node node_modules\jest\bin\jest.js scripts\product-experience\lab-replay.test.js --runInBand --coverage=false
    if ($LASTEXITCODE -ne 0) { throw 'The bounded Product Engine replay did not pass.' }
}
finally {
    [Environment]::SetEnvironmentVariable('EM-GEMINI-KEY', $null, 'Process')
    [Environment]::SetEnvironmentVariable('EASYMOD_PRODUCT_LAB_AUTONOMOUS', $null, 'Process')
    [Environment]::SetEnvironmentVariable('EASYMOD_LIVE_GEMINI_EGRESS', $null, 'Process')
    [Environment]::SetEnvironmentVariable('LAB_RUN_SCOPE', $null, 'Process')
    [Environment]::SetEnvironmentVariable('LAB_RUN_MODE', $null, 'Process')
    $providerKey = $null
    Remove-Variable providerKey -ErrorAction SilentlyContinue
}
```

## Evidence and interpretation

`VERIFIED_COMMERCE_FOUNDATION_PROOF.md` is the human-readable handoff; `verified-commerce-proof.json` is its machine-readable counterpart. The focused reports cover dataset/oracle coverage, integration, real model/vision, baseline comparison, Playwright, AI quality, cost/customer value, security/shared worker behavior, evidence verification, and the final verdict. Sanitized run receipts, budget ledgers, redacted transcripts, integration receipts, browser reports, screenshots, and sanitized Playwright archives live under `artifacts/`. Raw browser trace archives are omitted because they contained simulator text internally. The current proof explains the integration source-revision limitation and the latest browser run.

The 200-row CSV is used to preserve customer-language coverage and compare the production router under controlled local adapters. It does not provide 200 answerable catalog facts. Report correct answerable turns and correct eligible fact slots using the CSV's labeled denominator, and keep mock results out of real-provider totals. The synthetic catalog suite has a separate tenant/family/variant denominator. Report skips, unrun paths, missing source media, and human review requirements explicitly; do not infer merchant readiness from a passing software suite.

## Release boundary

This work is local to the V1.2 branch. The artifacts are engineering evidence and do not authorize a push, pull request, merge, deployment, production write, provider integration change, or merchant-facing claim. Human product review remains separate from automated checks.
