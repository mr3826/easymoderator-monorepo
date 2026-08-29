# Billing operations

Operational rules for EasyModerator's subscription billing. Written after a
yearly subscriber was invoiced and suspended as if they were monthly.

## Annual billing invariant

> A subscription is billed when **its own paid period ends**, never when the
> calendar month turns.

```
yearly entitlement  → annual renewal only
monthly entitlement → monthly renewal
```

Concretely, for a subscription paid at `T0`:

| | monthly | yearly |
| --- | --- | --- |
| `current_period_start` | `T0` | `T0` |
| `current_period_end` | `T0 + 1 month` | `T0 + 1 year` |
| `next_billing_date` | `T0 + 1 month` | `T0 + 1 year` |
| renewal invoice issued | once `next_billing_date` passes | once `next_billing_date` passes |
| `invoice_type` | `monthly_subscription` | `yearly_subscription` |
| dunning may begin | after that invoice's 3-day due window | after that invoice's 3-day due window |

`invoice-generator` runs daily (`0 1 * * *` UTC) and bills only subscriptions
whose `next_billing_date` has passed — see `InvoiceGenerator.isRenewalDue`. The
usage reset runs at `00:00` UTC. The `usage_reset_at < current_period_start`
marker lets the `01:00` invoice run derive the exact period that just ended
before the next period is billed.

## Current commercial model

| Plan | Price | Conversation allowance | Top-ups | Billing |
|---|---:|---:|---|---|
| Shuru | ৳0 | 100/month | No | Free forever |
| Growth | ৳999/month | 500/month | Yes: `PACK_100` ৳250, `PACK_300` ৳500, `PACK_700` ৳1,000 | Flat monthly |
| Partner | ৳0 upfront | Unlimited | No | 300–999 delivered orders ৳15/order; 1,000–2,999 ৳12/order; 3,000+ ৳10/order |

Every plan shares the same core features. A new shop is created as active
Shuru with a synthetic monthly period anchored at signup. Annual Growth rows
remain valid for renewal but annual billing is not marketed to new signups.

Conversation metering consumes the included allowance, then `topup_balance`.
When both are exhausted, the inbound message remains in the manual inbox and
the worker skips only the automated reply with reason `usage_exhausted`. No
conversation overage charge is generated.

**What broke before.** The generator billed every `status='active'` subscription
on the 1st of the month with no reference to its period, typed every non-per-order
invoice `monthly_subscription`, and dated it to the previous calendar month. A
yearly subscriber was charged the full annual amount a month into a year they had
already paid for, given three days to pay, and suspended by the failed-payment
reconciler. The yearly guard that existed was scoped to the *calendar year*, so it
suppressed only the 2nd–12th invoice of a year and re-opened every 1 January
regardless of the subscriber's anniversary.

### Invariants to preserve

- `recurringInvoiceTypeFor(billing_cycle)` in `subscription.plans.js` is the only
  place a cycle becomes an invoice type. `RECURRING_INVOICE_TYPES` is defined once
  in the same module — three call sites previously kept their own copy, so a new
  type had to be added to all of them to be honoured.
- Idempotency is keyed to `billing_period_start`, which comes deterministically
  from the subscription. Re-running the job for the same boundary matches the same
  row. **Do not** backfill a historical invoice's `billing_period_start` to equal a
  live subscription's `current_period_start` — that would make the generator treat
  the next genuine renewal as already invoiced and silently stop billing.
- A subscription with no period recorded at all is billed, not skipped. Failing
  closed there would silently stop invoicing a real customer.
- Deferring annual dunning does not exempt annual subscribers from it. Once a
  yearly renewal is genuinely past due — only possible after the entitlement has
  expired — it suspends like any other renewal.

Covered by `src/jobs/__tests__/invoice-generator.test.js` (BILLING-YEARLY-002…005,
BILLING-MONTHLY-REGRESSION, BILLING-IDEMPOTENCY) and
`src/modules/subscription/__tests__/annual-billing.test.js` (BILLING-YEARLY-001).

## Production verification receipt

Locked-account Messenger smoke test, **2026-08-13T11:43:34Z**, commit `d5b8f55`,
merchant `admin@easymod.tech` / shop `Easy Style Fashion`, customer
`EasyModerator Tester`. Run because the billing-paused work modified the
production message worker.

One real Messenger turn — `Premium Black Panjabi ache?` — end to end:

| layer | evidence |
| --- | --- |
| Meta webhook | receipt `0d038f06`, `page_id 1213925798474895`, `event_type message`, `status PROCESSED`, `retry_count 0` |
| resolution | shop `458b6a78…`, channel `77091ba8…`, customer `9cd4521d…` — resolved in 79 ms |
| inbound | message `702242db…` persisted |
| worker | `burstflush_03c2e7d9…_slow3s done`, confidence 0.9 |
| billing guard | **did not fire** — `ai_skipped_reason` null; zero skipped rows shop-wide that day |
| grounding | `SEND` / `GROUNDED` / `VERIFIED`, product `65f0d40d…`, violations `[]` |
| delivery | `delivered = true`, Meta mid `m_oujFD86…` |
| duplicate sends | **0** — 1 AI row, 1 delivered, 1 distinct mid |
| DLQ / queues | empty; `message-processing` and `message-dlq` both 0/0/0/0/0 |
| Redis | `maxmemory-policy = noeviction`, `evicted_keys 0` |
| health | `/health` ok, `/health/ready` ready, DB + Redis connected |

Subscription state at the time of the turn, unmodified. This is a **legacy
annual Growth subscriber** retained to prove anniversary billing; it is not a
new-signup or current Shuru default:

```
GROWTH / yearly / active   ৳11,988
current_period  2026-08-10T11:40:39Z → 2027-08-10T11:40:39Z   (365 days)
next_billing    2027-08-10T11:40:39Z
MONTHLY_RENEWAL_PENDING = false     (invoice-generator dry run: 0 generated)
MONTHLY_DUNNING_ACTIVE  = false     (reconciler dry run: 0 overdue, 0 suspended)
AI_ALLOWED              = true
open/overdue invoices   = none
```

Noted during the smoke test, **unrelated to billing and pre-existing**: the worker
logged `handleOrderFlow failed … relation "order_sessions" does not exist`. The
table is genuinely absent from production (51 public tables, `to_regclass` null),
so the deterministic order-capture step-machine cannot run there. It is caught and
does not block the AI reply — this turn was answered normally — but order capture
via chat is silently inoperative. Tracked separately; no billing PR touches the
order module.

## When billing pauses the AI

Pausing automated replies when billing lapses is correct. Leaving nobody aware of
it is not.

```
customer message arrives
  → inbound persists as normal
  → AI is skipped  (reason: subscription_inactive)
  → the reason is written to the inbound message's metadata
  → the merchant is alerted, once per shop per day
  → the Shared Inbox still shows the message and can still reply by hand
  → the customer is told nothing
```

**The customer receives no automated reply.** This is deliberate. A suspended
shop may have churned, so "the shop will respond shortly" is a promise the
product cannot keep; it would also spend Meta Send API calls on a shop that is
not paying. The customer is never told anything about the merchant's billing.

**The conversation is not flagged `hitl`.** The HITL guard runs *before* the
billing guard, so flagging it would outlive the pause: paying the invoice would
restore billing while the AI stayed silent on every conversation touched during
the suspension, until a human cleared each one by hand.

A consequence worth knowing: `customer-waiting-notifier` only scans conversations
with `hitl = true`, so it does not see billing-paused conversations. That is why
the alert is raised directly from the worker rather than left to that job.

**Alert volume.** One notification per shop per day, keyed
`billing_paused:<shopId>:<YYYY-MM-DD>` with a 24-hour TTL, however many customers
write in. `PAYMENT_SUBSCRIPTION_ISSUE` is the event; merchant notification
preferences and rate limiting apply as they do for any other alert.

**Diagnosing a silence after the fact.** The inbound message carries
`metadata.ai_skipped_reason = 'subscription_inactive'`, `ai_skipped_at` and
`subscription_status`. A container log rotates; "why did my customer get no answer
on the 3rd?" is asked much later than that.

Covered by `src/jobs/__tests__/message-worker.billing-pause.test.js`.

### When conversation allowance pauses the AI

The same operator-visible behavior applies when a fresh conversation crosses
the effective allowance:

```
conversation is metered → included allowance/topup balance is consumed
  → within_allowance=false is persisted on the usage event and job payload
  → worker records ai_skipped_reason=usage_exhausted
  → merchant receives one daily subscription/usage alert
  → manual inbox remains available; customer receives no automated billing message
```

The worker does not query usage again, and jobs from before the payload field
was deployed fail open during a rolling deploy. Covered by
`src/jobs/__tests__/message-worker.billing-pause.test.js` and the subscription
usage integration suite.

### Partner reversals

Courier delivery callbacks stamp `orders.delivered_at` once. If an admin later
approves or refunds a return after a paid Partner invoice covered that order,
the settled invoice is never rewritten. A row in
`partner_billing_adjustments` records the per-order credit, and the next
month-end Partner invoice applies it as `adjustment_credit` in its metadata.

## Test reconciliation and revenue

The founder-controlled tester merchant (`Easy Style Fashion`) is settled without
money changing hands so it can hold a valid paid entitlement for production
testing. Such a settlement is marked on the invoice row:

```
payment_method = 'manual_test_reconciliation'
```

plus a note stating that no real money was collected and the row must be excluded
from revenue.

**There is currently no subscription revenue reporting in EasyModerator.** Nothing
aggregates paid invoices — no MRR calculation, no collected-revenue figure, no
financial export, no founder financial dashboard. The admin billing view reports
`outstandingAmount` from *pending and overdue* invoices only, so a settled test
invoice never appears in it. `PaymentTransaction` is a merchant order-payment
ledger keyed to `order_id`, unrelated to subscription revenue, and has no writers.

So there is nothing for a test settlement to pollute today. **When revenue
reporting is built, it must filter on `payment_method`**, excluding
`manual_test_reconciliation` specifically — not "manual payments" generally, since
legitimate manual settlement is a plausible future product feature and must still
count as revenue.

The tester account is a fixture, not a business-rule exception: no production code
branches on its email, shop id or subscription id.
