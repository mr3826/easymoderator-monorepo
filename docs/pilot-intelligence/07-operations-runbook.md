# Pilot Intelligence — Operations Runbook

Audience: platform operators (SUPER_ADMIN) and on-call engineers.

## 1. Enable for a pilot shop

Prerequisites:

- The release containing migration `20260927_001_pilot_customer_rto_intelligence`
  is deployed, and the `worker` service is running (for the detector).
- The shop's courier setup and Page connection are healthy. Pilot features do
  not fix a broken courier.

Steps:

1. **Admin UI.** Go to Admin → Shops → *shop* → **Orders & Courier** → Pilot
   features. You can use the API instead:

   ```bash
   curl -X PATCH https://api.easymod.tech/api/admin/shops/<SHOP_ID>/pilot-features \
     -H "Authorization: Bearer <SUPER_ADMIN token>" -H "Content-Type: application/json" \
     -d '{"customer_intelligence": true, "order_confidence_mode": "shadow"}'
   ```

2. **Shadow first**, for at least 7 days. Decisions are recorded and shown, and
   no booking is paused. Check `GET /api/order-confidence/summary` as the shop
   owner:
   - `shadow_would_hold` ÷ `evaluated_orders` is the hold rate the merchant
     would see;
   - read the reasons behind the holds (order panels) with the merchant.
3. Optionally tune the thresholds:

   ```json
   {"order_confidence_config": {"high_value_cod_threshold": 8000, "address_min_length": 12}}
   ```

4. **Enforce**: `{"order_confidence_mode": "enforce"}`. Tell the merchant that
   held orders show on the order detail with **Mark verified** / **Approve for
   booking**, and that a Telegram/push alert "Order needs review before courier
   booking" is sent at most once per held order per 24 hours (notification
   dedupe key `<orderId>:confidence_hold`).

Customer 360 works as soon as `customer_intelligence` is true: state is
computed on read. Opportunities appear after the next 10-minute sweep, with a
72-hour lookback.

## 2. Disable or roll back

| Scope | Action | Effect | Time |
| --- | --- | --- | --- |
| One shop | PATCH `{"order_confidence_mode": "off"}` and/or `{"customer_intelligence": false}` | Pre-pilot behaviour immediately (the next request). Held orders can be booked normally again; their `delivery_status` stays `confidence_hold` until booked. | Instant, no deploy |
| All shops | `POST /api/admin/pilot-features/disable-all` | Every shop is back to pre-pilot behaviour | Instant, no deploy |
| Code | Revert the release | Old code ignores the new tables | Deploy |
| Schema | `npm run migrate:down` (last migration only) | **Deletes pilot data.** This is a destructive production data operation, so it needs the human gate in `CONTRIBUTING-AI.md` §3. It is never part of the automated deploy rollback, which forbids `migrate:down`. | Only if abandoning the pilot |

All flag changes are audited (`admin:pilot_features_*`).

## 3. Signals to watch

`GET /health/detailed` → `pilotIntelligence.counters`. These are in-process
counters, so they reset on restart. Read deltas, per instance.

| Counter | Meaning | Alert when |
| --- | --- | --- |
| `order_confidence.engine_failure` | The gate could not evaluate. In enforce, bookings are held with `ENGINE_UNAVAILABLE`. | > 0 in 15 min: **page**. Merchants cannot ship. |
| `order_confidence.input_unavailable` | History or RTO Shield lookup failed; the order fell to VERIFY | Sustained > 0 |
| `pilot_features.lookup_failed` | Flag read failed; the feature ran as *off* | > 0: investigate the database |
| `order_confidence.gate_held` / `gate_allowed` | Hold rate | Hold rate > 30% for a shop: review the rules with the merchant |
| `order_confidence.shadow_would_hold` | Shadow holds | Use for the enforce decision |
| `order_confidence.resolution_stale` | Clearances voided by edits | Informational |
| `order_confidence.cas_conflict` | Lost CAS races (retried or refused) | A spike points at concurrency hot spots |
| `order_confidence.committed_reconcile_allowed` | A held order had a COMMITTED parcel; it was reconciled, not re-booked | Informational |
| `order_confidence.outcome_recorded` / `outcome_hook_failed` | Ground-truth capture | `outcome_hook_failed` > 0 |
| `opportunity.detector_run` / `detector_shop_failed` | Sweep health | `detector_shop_failed` > 0, or no `detector_run` for 30 min while shops are enabled |
| `opportunity.detector_lock_skipped` | Another instance held the shop lock | Informational |
| `opportunity.created` / `converted` / `dismissed` / `expired` / `actioned` | Funnel | — |
| `opportunity.conversion_hook_failed` | The post-commit convert failed; the sweep converts later | > 0 sustained |
| `customer.phone_match_ambiguous` | One phone matches several customers in a shop | Informational (data quality) |

Structured log events carry ids and codes only:

- `order_confidence.evaluated` (with `latencyMs`);
- `order_confidence.gate_held`, `order_confidence.engine_failure`;
- `order_confidence.verified` / `.approved`;
- `order_confidence.outcome_recorded`;
- `opportunity.created` / `.converted`;
- `opportunity.detector_shop_complete`, `opportunity.detector_run_complete`,
  `opportunity.detector_shop_failed`.

## 4. Troubleshooting

**A merchant says an order will not book ("needs checking").**

1. Open the order detail. The panel lists the reasons and the required action.
2. For VERIFY: any team member confirms with the customer and clicks **Mark
   verified**. For MANUAL_REVIEW: the owner or an admin approves, with a
   reason.
3. If the panel says "edited after it was cleared", the order changed; verify
   or approve again.
4. If it says "Order checks are temporarily unavailable"
   (`ENGINE_UNAVAILABLE`), check `order_confidence.engine_failure` and the
   logs. To unblock the merchant immediately, set the shop to `shadow` or
   `off`.

**A held order is shown booked or delivered.** Expected when a parcel was
already COMMITTED. Reconciliation is always allowed and no second parcel is
created (`committed_reconcile_allowed`).

**No opportunities appear.**

- Check that `customer_intelligence` is true.
- Check that the worker is running and Redis is reachable, since jobs are
  scheduled through BullMQ.
- Check that `opportunity.detector_run` is increasing. To run the sweep by
  hand:

  ```bash
  docker compose exec worker node src/jobs/job-runner.js opportunity_detector --dry-run   # count only
  docker compose exec worker node src/jobs/job-runner.js opportunity_detector
  ```

- Remember that a conversation must be quiet for 30 minutes and must contain a
  strong signal or two distinct buying questions.

**Too many or noisy opportunities.** Look at the `reasons` on the dismissed
ones, which are grouped by `resolution_reason`. The rules live in
`opportunity-signals.js` (`assess`). Tighten them in code, since they are
versioned, not per shop.

**Courier provider problems.** These are unchanged by this feature. A provider
timeout still leaves an `INDETERMINATE` `courier_dispatch` claim that needs
reconciliation, and retries are refused until then.

**Queue or Redis outage.** The detector does not run, and neither does any
other scheduled job. The gate, APIs and conversion hook are unaffected. After
recovery the next sweep catches up within the 72-hour lookback.

## 5. Data checks (read-only SQL)

```sql
-- Live opportunities per shop (should never exceed one per customer)
SELECT shop_id, customer_id, count(*) FROM customer_opportunities
 WHERE status IN ('OPEN','ACTIONED') GROUP BY 1,2 HAVING count(*) > 1;   -- expect 0 rows

-- Held orders awaiting action
SELECT o.order_number, c.decision, c.last_gate_at FROM order_confidence c
  JOIN orders o ON o.id = c.order_id
 WHERE c.shop_id = :shop AND c.last_gate_result = 'HELD' AND o.delivery_consignment_id IS NULL;

-- Outcome by released decision (pilot evaluation)
SELECT released_decision->>'decision' AS released, released_decision->>'resolution' AS cleared_by,
       outcome, count(*) FROM order_confidence
 WHERE shop_id = :shop AND outcome IS NOT NULL GROUP BY 1,2,3;
```
