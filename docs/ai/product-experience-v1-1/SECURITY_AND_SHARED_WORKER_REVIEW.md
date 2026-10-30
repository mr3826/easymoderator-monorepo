# Security and Shared-Worker Review

## Local Lab boundary

- The Test Lab binds to loopback and uses a per-process request token for state-changing routes.
- Scenario APIs return sanitized identifiers and source metadata; customer message and suggested-answer fields are omitted. The E2E journey checks their absence.
- The final recursive privacy scan checks all JSON artifacts and Playwright ZIP archives for parse errors, denied property keys, and exact simulator-source text matches. It checks distinct CSV values of at least 12 characters. The repeatable scanner writes aggregate counts only; final counts and the SHA-256 manifest entry total are recorded in `artifacts/final-qa/privacy-scan.json` and `artifacts/final-qa/SHA256SUMS.txt`.
- Product evidence and catalog reads remain tenant-scoped; paired receipt counters show zero unscoped reads and zero tenant-scope violations.
- The Lab server binds to loopback. Disposable Postgres/Redis services use a reserved non-overlapping Docker bridge subnet with IP masquerading disabled and loopback-only published ports. The host Node preload allows loopback IPs and `localhost`, blocks DNS resolver methods and custom lookup/agent/dispatcher paths, and rejects non-loopback TCP, UDP, HTTP/S, and fetch calls. This is an API-level guard, not an OS-wide firewall and does not restrict loopback calls to only the disposable service ports. The final integration receipt records 0 blocked non-loopback attempts and `externalProvidersConfigured:false`. An `internal:true` bridge experiment prevented the host from reaching published service ports and was not used for the passing run.
- No business mutations or Messenger sends occurred in the 200-turn replay.

## Regression coverage

The full backend Jest suite passed 282 suites / 3,614 tests. The final disposable-stack integration passed the selected 12-test Postgres/Redis/worker group and the 46-test webhook pipeline, including a queued catalog-price update read by the resumed production worker. The browser journey verifies tenant switching and reset, grounded evidence display, safe unknown handling, and no image-identification claim from a fixture ID. Chromium/axe coverage found no violations across the 9 Lab sections. Current Bengali title-boundary regressions cover `খাঁটি`, `খাটি`, `বিশুদ্ধ`, `শতভাগ`, and `১০০%` before an unknown product title.

A historical integration-run diagnostic limitation remains: an earlier attempt exited at suite level despite all assertions passing, and its receipt omitted suite diagnostics. The final run passed, and the runner captures structured failure summaries for future attempts. The cause of the historical failure cannot be reconstructed; it is not an open code finding.

## Limits

No live Meta authorization, Graph call, provider request, raster-image vision, or production database was used. The real-stack suite is a bounded subset; it does not certify all concurrency, webhook/controller, retry, or transaction permutations. `REAL_META_VERIFIED=NOT_RUN`; production release remains unauthorized.
