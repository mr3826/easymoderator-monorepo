# Security and Shared-Worker Review

## Local Lab boundary

- The Test Lab binds to loopback and uses a per-process request token for state-changing routes.
- Scenario APIs return sanitized identifiers and source metadata; customer message and suggested-answer fields are omitted. The E2E journey checks their absence.
- The final recursive scan found no prohibited raw-message, answer, attachment, or response-text fields in 123 JSON artifacts; checking all saved string values against 197 distinct simulator message/answer strings of at least 12 characters also found zero exact matches. The independent reviewer scanned the 122 files present before the final QA gate package was added and also found zero prohibited keys. A separate exact-text scan checked all 197 simulator customer-message strings against the four Playwright trace and HTML-report archives; no exact source message appeared. The archives contain names of privacy-asserted fields in archived Playwright test source only, not source-row values. The screenshots display sanitized scenario metadata and the generic in-memory response privacy marker.
- Product evidence and catalog reads remain tenant-scoped; paired receipt counters show zero unscoped reads and zero tenant-scope violations.
- The Lab server binds to loopback. Disposable Postgres/Redis services use a reserved non-overlapping Docker bridge subnet with IP masquerading disabled and loopback-only published ports. The host Node preload allows loopback IPs and `localhost`, blocks DNS resolver methods and custom lookup/agent/dispatcher paths, and rejects non-loopback TCP, UDP, HTTP/S, and fetch calls; it is not an OS-wide host firewall. A receipt counter records rejected Node API attempts. An `internal:true` bridge experiment prevented the host from reaching published service ports, so it was not used for the passing run. The passing integration receipt records `externalProvidersConfigured:false`.
- No business mutations or Messenger sends occurred in the 200-turn replay.

## Regression coverage

The focused deterministic command passed 8 suites / 133 tests covering Lab contracts, API security, server behavior, no-egress guards, run process behavior, router behavior, product evidence, and product-presentation contracts. The independent final retry passed the selected 12-test Postgres/Redis/worker integration group after one prior run reported a suite-level failure despite 12/12 passing assertions; the preserved runner receipt lacks the suite diagnostics. The browser journey verifies tenant switching and reset, grounded evidence display, safe unknown handling, and no image-identification claim from a fixture ID.

## Limits

This review covers the listed tests and local receipts. No live Meta authorization, Graph call, provider request, raster-image vision, or production database was used. The real-stack suite is a bounded subset; it does not certify all concurrency, webhook/controller, retry, or transaction permutations. `REAL_META_VERIFIED=NOT_RUN`; production release remains unauthorized.
