# Phase B Evidence Receipt

Status: **Engineering-complete, QA sign-off pending**

This receipt records implementation evidence for the Phase B read-only shadow
runtime. It is not a production promotion receipt and does not close Phase B
under `ROLLOUT_PLAN.md` until Product, QA, Security, and Operations complete
their human review.

## Proved

- The production deploy job now passes `AI_ACTION_GATE_SECRET` to the renderer,
  and missing required render inputs fail before production configuration
  validation or file output.
- The 22 active and 6 reserved intent IDs are frozen in the versioned registry;
  static-versus-live delivery and payment domains are deterministic.
- Stage 2 is a rules-only classifier. It preserves the pre-existing order-flow
  and router predicates, adds negation and handoff boundaries, and emits only
  registry IDs.
- Read-only actions require tenant scope, fresh evidence, a deterministic
  request fingerprint, and an audit row. Mutating action types are refused and
  `READ_ORDER_STATUS` denies an unbound customer identity.
- Shadow classification persists the intent record, intent, and confidence
  without changing live routing or creating a shadow mutation.
- Conversation turns have durable recovery states, retry states, immutable
  first-start timestamps, holding templates, and transactional
  `HUMAN_REQUIRED` plus `conversations.hitl` handling.
- The seed evaluation corpus is content-hashed and the receipt reproduces its
  `receiptHash` bit-for-bit. The committed receipt is [`bd-eval-receipt.json`](./bd-eval-receipt.json).

## Branch Protection Incident

The repository visibility toggle deleted `main` branch protection and GitHub did
not restore it when the repository became public again. As a result, PR `#66`
merged with an empty PR check rollup; it was docs-only, and the post-merge push
run on `54407ed` passed both gates: [CI / CD](https://github.com/mr3826/easymoderator-monorepo/actions/runs/32588448012)
and [Security Scan](https://github.com/mr3826/easymoderator-monorepo/actions/runs/32588447505).
Protection was restored and read back on `2026-08-23` with strict
`PR Merge Gate` and `Security Scan` contexts, admin enforcement, force-push and
deletion denial, and required conversation resolution.

## Evaluation Harness Correction

The original Phase B receipt counted 241 fixtures, including ten synthetic
`LOW_CONFIDENCE_OR_GROUNDING_FAILURE` messages that described internal
retrieval or grounding outcomes as if they were customer utterances. The
corrected receipt removes those impossible utterance fixtures, marks
`GENERAL_CHAT_OR_UNKNOWN` and `LOW_CONFIDENCE_OR_GROUNDING_FAILURE` as runtime
outcome classes, and records their exemption reasons separately from intent
accuracy. The corrected seed currently contains 238 fixtures and reports
handoff recall against 60 actual human-required turns. C3 now covers checkout,
cart, availability, handoff, cancellation, and post-purchase boundaries; the
seed receipt reports 60/60 handoff recall while keeping the remaining accuracy
and launch-size gaps explicit. Bangladesh Language QA remains pending.

Named test homes include:

- [`render-production-env.test.js`](../../../EasyMod-backend/scripts/__tests__/render-production-env.test.js)
- [`intent-registry.contract.test.js`](../../../EasyMod-backend/src/modules/ai/__tests__/intent-registry.contract.test.js)
- [`intent-stage2-rules.test.js`](../../../EasyMod-backend/src/modules/ai/__tests__/intent-stage2-rules.test.js)
- [`ai-read-action-tenant.security.test.js`](../../../EasyMod-backend/src/security/__tests__/ai-read-action-tenant.security.test.js)
- [`message-worker.intent-shadow.test.js`](../../../EasyMod-backend/src/jobs/__tests__/message-worker.intent-shadow.test.js)
- [`turn-recovery.test.js`](../../../EasyMod-backend/src/modules/ai/__tests__/turn-recovery.test.js)
- [`message-worker.recovery.integration.test.js`](../../../EasyMod-backend/src/jobs/__tests__/message-worker.recovery.integration.test.js)
- [`bd-eval-receipt.test.js`](../../../EasyMod-backend/scripts/__tests__/bd-eval-receipt.test.js)

## Not Proved

- This is not the 2,000-turn launch corpus. The corrected committed corpus
  contains 238 regression fixtures and is honestly labelled `SEED`; the
  superseded Phase B receipt contained 241 before the harness correction.
- No Cohen's kappa measurement or double-labelled human sample exists here.
- No native Bangladesh Language QA review has happened.
- No 10 real shop profiles, 14 consecutive production days, or production
  traffic evidence exists.
- No Product, QA, Security, or Operations human signatures exist;
  `signedBy` remains `[]`.
- Accuracy floors are reported measurements over seed denominators, not launch
  gates. The receipt must not be read as approval for customer reply activation.

## Pending Bangladesh Language QA

The following new Bengali literals are collected in one code block and remain
pending native review:

`বন্ধ করুন`, `আর মেসেজ চাই না`, `মেসেজ বন্ধ`, `মানুষের সাথে কথা বলতে চাই`,
`একজন মানুষের সাথে কথা বলুন`, `কাস্টমার কেয়ার চাই`, `ডেলিভারি চার্জ`,
`ঢাকার বাইরে কত`, `কুরিয়ার দিয়ে এখন কত লাগবে`, `কুরিয়ার দিয়ে এখন কত লাগবে`,
`ডেলিভারি দেন`, `কোথায় ডেলিভারি দেন`, `পেমেন্টটা গেছে`, `কি কি পেমেন্ট নেন`,
`পেমেন্ট পদ্ধতি`, `সাইজ`, `মাপ`, `রং`, `উপাদান`, `ব্র্যান্ড`, `বৈশিষ্ট্য`,
`এইটা নেব`, `অর্ডারটা বদলাতে চাই`, `অর্ডার ফেরত দিতে চাই`, `অভিযোগ করতে চাই`, `অর্ডার দেরি`,
`ঠিক আছে অর্ডার কনফার্ম`, `এই পণ্যটি কি আছে`, `নাই নাকি আছে`, `ভালো আছেন`,
`এই শার্টটা স্টকে আছে`, `কোন সাইজ স্টকে আছে`, `স্টক আছে`.

Source: [`stage2-rules.js`](../../../EasyMod-backend/src/modules/ai/intent/stage2-rules.js),
export `PENDING_BANGLA_LANGUAGE_QA_LITERALS`.

## Recorded Deviations

The recovery policy says the eight-second holding message is sent regardless
of internal state. The implementation also exempts `SENT` and `DEAD_LETTERED`,
because a turn that delivered at 7.9 seconds must not send a contradictory
reassurance afterward. The five- and eight-second timers share the same
Redis-durable holding key for a turn/recovery kind, so one retry cannot send a
second holding message.

## Meaning Of “Signed”

The normative documents do not define a human signature algorithm or key. Phase
B therefore resolves “signed” as tamper-evident content hashing only:

- `corpusVersion` is `sha256:` plus the hash of canonical frozen corpus content.
- `receiptHash` is `sha256:` plus the hash of the canonical receipt with its own
  `receiptHash` removed.
- `signedBy` is deliberately `[]` until human sign-off exists.

No production flag, customer-facing generated reply, production deployment, or
automation-mode activation is enabled by this receipt.
