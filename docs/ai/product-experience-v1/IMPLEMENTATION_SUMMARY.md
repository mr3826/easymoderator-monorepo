# Implementation summary

## Changes

- Hardened `grounding/product-evidence.service.js`: explicit shop ownership, contextual row ownership, tenant-owned HTTPS media paths restricted to configured asset/API origins, unknown variant quantity, and current-row evidence revalidation.
- Hardened `grounding/outbound-grounding.gate.js`: product-identity-bound price/stock claims, variant-specific prices when parent pricing is ambiguous, local fee-label attribution, dynamically resolved option claims, clause-scoped delivery promises, and unavailable/unknown distinctions.
- Updated `intent-router.service.js`: active FAQ revalidation, policy-aware cache provenance, no generic knowledge cache, retrieval-failure propagation, normalized language presentation, and PII scrubbing of current, recent, and quoted customer context before provider input. FAQ answers carry a verifiable snapshot; generic non-FAQ RAG has no sendable snapshot and is held at the worker boundary.
- Updated `product-search.service.js`: retrieval errors remain distinguishable from an empty result.
- Updated `message-worker.js`: persists the DTO and revalidates product facts, active same-shop FAQ evidence, and the current payment/delivery operating-context hash after send claim and before automatic provider send. Changed or missing evidence is held for human review; failed reads are retryable. Generic non-FAQ RAG has no verifiable same-shop source snapshot and is held from automatic send.
- Hardened outbound policy checks for payment method authorization, exact configured payment destinations (including Bengali digit normalization), unsupported currency codes, and location-specific delivery scope and timelines.
- Updated `ai-chatbot.controller.js`: returns the additive presentation DTO and uses the Messenger adapter for authorized attachments.
- Preserved a customer-selected variant through the latest grounded assistant context. Follow-up product reads remain shop-scoped and live; the current message can replace the earlier selection.
- Suppressed parent prices in unknown-attribute fallbacks when active variant pricing is missing or differs.
- Scrubbed quoted reply text, file names, and type metadata before including them in provider prompts; blocked untrusted-origin product media and unrelated product-name claims.
- Added schema validator, synthetic tenant/catalog fixtures, checksummed inbound SVG substitutes, dataset parser, deterministic replay, and mocked production-route replay.

## Compatibility and scope

- No table migration, new provider, new service, new index, frontend/mobile work, deployment configuration, CI workflow, or production write.
- Existing intent router, product search, grounding, worker lifecycle, and message metadata remain authoritative.
- Controller response adds an optional `productPresentation` value. Existing response consumers were not exercised in a full frontend/mobile integration test.
- Product handoff does not create orders, reserve inventory, change prices, verify payments, book couriers, cancel orders, or issue refunds.

## Local release state

- `LOCAL_IMPLEMENTATION_COMPLETE`: YES; implementation and independent static review are complete, and the authorized local commit is being finalized.
- `LOCAL_TESTS_PASS`: YES; 21 critical product and order-boundary suites passed (275 tests), with test discovery passing. See [REGRESSION_RESULTS.md](REGRESSION_RESULTS.md).
- `INTEGRATION_READY`: NO; real DB/worker/provider/media/Messenger integration and merchant usability remain unverified.
- `PRODUCTION_RELEASE_NOT_AUTHORIZED`: YES.

The independent static review verdict is recorded in [FINAL_INDEPENDENT_REVIEW.md](FINAL_INDEPENDENT_REVIEW.md).
