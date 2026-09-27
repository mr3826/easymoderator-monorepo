# ADR-0006: Sales Opportunities Are Detected by a Deterministic Sweep

Status: Accepted
Date: 2026-09-27
Owners: Engineering + Product

## Context

A Sales Opportunity is a purchase-intent conversation that **stopped** without
an order. The platform already has two relevant pieces:

- a deterministic, versioned, negation-aware Bangla, Banglish and English
  classifier (`ai/intent/stage2-rules.js`, ruleset 1.1.0) emitting registered
  intents;
- `order_sessions` rows that record checkouts which never produced an order.

Stage-2 classification runs only inside the AI worker, after the HITL,
MANUAL-mode, billing and sentiment guards. The inbound webhook path was under
separate durability remediation at the time of writing.

## Decision

A BullMQ-scheduled sweep (`opportunity-detector.job`, every 10 minutes) runs,
per enabled shop, inside one transaction holding
`pg_try_advisory_xact_lock('opportunity-detector:<shop>')`. It:

1. reads conversations active in the last 72 hours;
2. skips customers whose last message is under 30 minutes old (still
   chatting), and customers who opted out;
3. classifies customer messages newer than a cursor with `stage2-rules.classify`,
   and adds order-session facts (`CHECKOUT_STARTED`);
4. qualifies without numeric scores:
   - **HIGH** = any strong signal;
   - **MEDIUM** = at least two distinct reasons, including a medium one;
   - an explicit cancel or STOP after the last positive signal suppresses it;
5. keeps **one live opportunity per customer**. A partial unique index enforces
   this. New signals merge into the live row with CAS on status.
6. converts on order creation, both through a post-commit hook in
   `_createOrderCore` (immediate) and through the sweep (backstop);
7. expires OPEN opportunities after 7 days, and ACTIONED ones 14 days after
   they were actioned.

The cursor is the latest of: the lookback start, the customer's last
opportunity signal, and the customer's last order. A dismissed opportunity
therefore never returns without new intent.

Stored signals keep the message id, intent id and rule id. They keep **no
message text**.

## Alternatives rejected

- **A hook in webhook ingestion.** It adds latency and a new failure mode to
  the path that must never lose a message, which was under concurrent
  remediation. It also cannot know that a conversation "stopped".
- **A hook after the worker's Stage-2 shadow classification.** It never runs
  for MANUAL-mode shops or turns stopped by guards, so detection would silently
  depend on AI settings.
- **LLM classification.** It is non-deterministic, costs money per message, is
  exposed to prompt injection through customer text, and is hard to explain.
- **A numeric lead score.** There is no calibration data; named reasons are
  explainable and auditable.

## Consequences

- Detection lags by up to 10 minutes plus the 30-minute quiet period. That is
  intentional: live chats are not opportunities.
- Redis being down stops scheduling, the same as for every other job. Nothing
  is lost, because the 72-hour lookback catches up.
- The per-run bounds are 200 conversations and 5,000 messages per shop, and a
  very busy shop has older threads skipped. This is documented as a pilot
  limit.
- The Bangla literals inherit the classifier's existing "pending native QA"
  status.
