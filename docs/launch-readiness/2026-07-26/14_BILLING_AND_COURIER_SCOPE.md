# 14 — Billing and Courier Scope Decision (Workstream M)

**Verdict for this workstream: FAIL for public launch.** Both features are exposed and
promised to merchants, and neither is production-certified.

The brief warns against assuming these are blockers merely because code exists. They are
blockers because they are **exposed, routed, and publicly sold** — not because the code
is present.

## Scope determination

| Question | bKash billing | Courier booking |
|---|---|---|
| Visible / promised to initial merchants | **YES** — public pricing section sells ৳999/mo with a 14-day trial | **YES** — landing page feature card "Courier Integrations — Book delivery across supported providers" |
| Routed in the app | **YES** — `/subscription`, `/payment-settings` (`routes.ts:154,173`) | **YES** — `/delivery-settings` (`routes.ts:153`), `CourierBookingModal.tsx` |
| Enabled in production config | **YES — and set to live money** | partially |
| Required for the initial merchant journey | trial-gated, so not on day 1 | no — COD is the default |
| Behind a feature flag | **NO** | **NO** |
| Credentials present | **NO** | **NO** |

**Neither is out of scope, and neither is operational.**

## bKash — exposed, configured LIVE, no credentials

`.github/workflows/ci-cd.yml`:

```yaml
BKASH_ENABLED: "true"      # line 246
BKASH_SANDBOX: "false"     # line 253
```

`BKASH_SANDBOX: "false"` means **live money mode**, not sandbox. The production-config
validator additionally forces `BKASH_SANDBOX` to be exactly `'false'` when bKash is
enabled, so this is a deliberate live configuration.

All six `BKASH_*` secrets are **absent** from the repository (`gh secret list`, names
only). This is precisely why the deploy preflight fails.

| Verification item | Status |
|---|---|
| Production vs sandbox mode | **live mode declared, no credentials** |
| Pricing accuracy | public copy ৳999/mo + ৳10-15/delivered order (partner); matches `subscription.plans.js` |
| Trial behaviour | 14-day, no card — implemented |
| Invoice creation | implemented (`invoice.service.js`) |
| Payment initiation | implemented |
| Callback validation | implemented + tested (`payment-webhook.controller.test.js`, `payment-callback-auth.middleware.test.js` passing) |
| **Payment idempotency** | **PASS** — atomic callback claim; a callback observing `processing` returns 202/pending and cannot re-fulfil |
| Failed payment / retry | implemented |
| Subscription activation / grace / suspension / reactivation | implemented (source) |
| Usage metering | implemented |
| Tenant isolation | **PASS** — owner payment actions are authenticated and owner-only; the public `/api/webhooks/owner/payment-confirmation/*` route was removed |
| Audit trail | present |
| Stale-payment reconciliation | read-only admin report, human-approved, no auto-replay |
| **Real-money production test** | **NEVER PERFORMED** |
| Refund / cancellation | not verified |

**Stated plainly: no real bKash charge has ever been executed in production.** It requires
founder approval and safe test credentials, and did not occur in this audit or any prior
one on record.

### The encryption hazard sits on this path

`PAYMENT_ENCRYPTION_KEY` is currently invalid per the validator and cannot be naively
rotated without destroying stored payment credentials. See **F-01** in `06_`. This is the
single most dangerous step in unblocking the deploy.

## Courier — exposed, no credentials

`PATHAO_CLIENT_ID`, `PATHAO_CLIENT_SECRET`, `STEADFAST_API_KEY`, `STEADFAST_SECRET_KEY`
are referenced at `ci-cd.yml:254-257` and are **all absent** from `gh secret list`. They
would render as empty values.

| Verification item | Status |
|---|---|
| Provider abstraction | PASS — delivery provider layer exists |
| Credential mode | **no credentials configured** |
| Booking creation / duplicate protection / address validation | implemented (source) |
| Failure handling / retry / tracking / cancellation | implemented (source) |
| Webhook status updates | **PASS** — unsigned courier webhooks are rejected fail-closed |
| **Tenant isolation** | **PASS, recently fixed** — `delivery_tracking` has no `shop_id` column, yet `entities.js` declared `DeliveryTracking.belongsTo(Shop, { foreignKey: 'shop_id' })`, so Sequelize synthesized the attribute and every `where: { shop_id }` emitted SQL for a nonexistent column (Postgres 42703). Tenancy now routes through the joined Order. Covered by `delivery-tracking.tenant-and-replay.test.js` (passing) |
| Terminal-state regression guard | PASS |
| **Real booking** | **NEVER PERFORMED** |

Note the tenant-isolation fix above is in `main` but **not in production** — the deploy
never ran. The broken query is what production is running today.

## The public-claim mismatch

The landing page states **"0 — BD couriers built-in"** in its stat strip, which is honest.
But the features grid promises *"Courier Integrations — Book delivery across supported
providers"*. A merchant reads the feature card, not the stat.

Recorded as **F-24 (P2)**: either configure at least one courier before launch, or
qualify the feature card as "coming soon".

## Recommendation

The cleanest path to unblock the deploy **without** taking on live-payment risk:

Set `BKASH_ENABLED: "false"` at `ci-cd.yml:246`. That drops the requirement from all six
bKash secrets to just `BKASH_WEBHOOK_SECRET` (which remains in `CORE_REQUIRED`), and
removes live-money exposure until a real end-to-end bKash test has been performed with
founder approval.

This is a founder decision, not mine to make — the trade-off is that merchants cannot
subscribe, so the 14-day trial must cover the pilot window. Given the pilot is 10 shops
on DRAFT mode for 7-14 days, that fits.
