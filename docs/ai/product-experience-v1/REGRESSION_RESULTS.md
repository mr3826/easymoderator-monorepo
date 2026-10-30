# Regression results

## Baseline and final tests

| Run | Suites | Tests | Result |
| --- | ---: | ---: | --- |
| Baseline SHA `07168f4` | 4 | 126 | PASS |
| Final product and order-boundary suite, including controller continuity | 21 | 275 | PASS |

The final run completed in 190.243 seconds and passed all 21 selected suites (275 tests). It covers dataset and fixture validation, product grounding, router and worker paths, persisted product-presentation continuity, product search/media, the action gate, tenant isolation, order dispatch, and order confidence-hold suites. The five focused route and grounding suites also passed separately (213 tests). Test discovery passed with all 307 tracked test files assigned exactly one execution home (305 coverage suites and 2 allowed quarantine files). The exact suite list and command are in `artifacts/final-test-results.json` (local evidence artifact; not committed).

The 200-turn deterministic replay completed twice with identical traces and 200 valid presentation contracts. The production-router replay completed 200 sequential turns twice with identical traces, 0 tenant-scope violations, 0 unscoped catalog reads, 0 detected phone/email patterns in fake-provider prompts, and 0 database, business-mutation, or Messenger calls. The 60 adversarial fake-model outputs per pass were all blocked by the production grounding gate. Its latest local-mock latency was p50 1.015 ms, p95 2.837 ms, and mean 1.301 ms; this is not production latency. All simulator turns executed, but the evidence-aware replay is not a 200-turn accuracy score: most source expectations need merchant policy, media inspection, live state, human review, or another domain, and only one turn matched a specific catalog product fixture.

## Severity and exit status

- **P0:** no cross-tenant or unauthorized mutation was observed in the covered offline suites. This does not certify the full application because no live DB/worker integration ran.
- **P1:** the covered regression and replay checks found no unresolved unsupported price/currency, stock/variant, payment-method/destination, or delivery-scope/timeline claims. All 60 unsupported fake-model candidates were replaced by safe fallback per pass. This remains a scoped local evidence claim, not a real-model accuracy evaluation.
- **P2/P3:** not human-rated. The synthetic fixture corpus verified only one simulator turn as a specific catalog product; customer usefulness, retrieval recall, tone, and Bangla/Banglish quality are not established.
- Payment-method regression cases reject unknown methods across scoped `with`, `to`, and `for` routes and direct return/refund phone destinations; positive controls preserve courier/logistics routes, seller contact numbers, receipts, tags, original packaging, booking confirmation, free delivery, and ordinary delivery timelines.
- **Real model / real vision:** NOT RUN.
- **Integration tests:** NOT RUN against real local Postgres/Redis, worker, or Messenger.

Jest emitted an environment warning about an invalid `--localstorage-file` path and a Force-exit open-handle notice. The selected suites exited with success. The checkout declares Node 20 in `.nvmrc`; this run used Node `v25.6.1`.

Postgres/Redis integration suites were not run: `jest.integration.config.js` requires a disposable Postgres URL and Redis, and this environment had no `DATABASE_URL` or `TEST_DATABASE_URL`. No shared database or service was started or modified.
