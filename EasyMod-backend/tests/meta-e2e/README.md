# Meta-shaped E2E

Proves that the production-shaped pipeline preserves the invariant in
[`docs/ai-cost/AI_TRUST_BOUNDARY.md`](../../../docs/ai-cost/AI_TRUST_BOUNDARY.md):

> **LLM output is a candidate response, not an authoritative response.**

Run it:

```bash
npm run test:meta:e2e     # needs PostgreSQL + Redis; see the setup doc
```

Setup, fixtures and the live-Meta procedure:
[`docs/testing/META_E2E_TEST_SETUP.md`](../../../docs/testing/META_E2E_TEST_SETUP.md).

## Where automated transport ends

```
 signed Meta-shaped webhook ─┐
                             │  ← the suite writes this, with a real HMAC over
                             │    an ISOLATED integration-test App Secret
   meta-webhook.routes ──────┤  REAL: rate limit, HMAC verify, dispatcher
   meta-webhook-events ──────┤  REAL: durable receipt, dedup, consent, storage
   Redis / BullMQ ───────────┤  REAL queue, real job payload
   message-worker ───────────┤  REAL: dedup, HITL, automation mode, billing,
                             │        sentiment, order-flow, confidence gate
   intent-router ────────────┤  REAL: shop-scoped catalog search, FAQ retrieval
   llm.service ──────────────┤  REAL provider chain, failover, circuit breaker
        └─ HTTP to Gemini/OpenAI  ← CAPTURED (transport.js): the wire response
                             │      is scripted so a test can hand the pipeline
                             │      a deliberately hallucinated candidate
   outbound grounding gate ──┤  REAL, never mocked
   policy engine ────────────┤  REAL
   MetaMessengerProvider ────┤  REAL: attachment mapping, messaging_type, proof
        └─ POST graph.facebook.com/me/messages  ← CAPTURED: the assertion target
```

Two transports are replaced, both at the outermost network hop, both in
[`transport.js`](./transport.js). Nothing between them is stubbed — in
particular not shop scoping, product retrieval, knowledge retrieval, grounding,
worker behaviour, conversation history or attachment provenance.

## Assertions

Every scenario asserts on two things, never on model phrasing alone:

1. **What Meta would have received** — the exact Graph Send API bodies, text and
   attachments (`harness.sentTexts` / `sentAttachments`).
2. **The evidence EasyModerator recorded** — the grounding decision the worker
   really emitted (`decision`, `reasonCode`, `productStatus`, `mediaStatus`,
   `verifiedProductIds`, `mediaProductId`, `knowledgeIds`, `violations`,
   `provider`) plus the `grounding_*` stamps and `source_references` persisted
   on the stored `Message` row.

## Known boundaries

- **Queue timing.** The webhook really enqueues into Redis; the harness then
  drains those jobs and calls the real worker handler, rather than racing a live
  BullMQ `Worker`. The job payload, the queue round-trip and the handler are
  real; BullMQ's own scheduler is not under test here (`pipeline-canary.job.js`
  probes that in production).
- **Vector retrieval.** No Qdrant instance runs in CI, so the vector tier
  degrades to empty exactly as it does when Qdrant is down. The keyword-FAQ
  knowledge tier is exercised for real against PostgreSQL.
- **Gemini context caching** is disabled (`GEMINI_CACHE_MIN_CHARS`) so the
  request shape is constant across the suite. It is an input-token cost
  optimisation, not part of the trust boundary.
- **The intent-router response cache** is disabled (`INTENT_CACHE_TTL_SECONDS=0`)
  so every turn re-derives its answer from the catalog — which is the property
  META-E2E-002 exists to prove.
