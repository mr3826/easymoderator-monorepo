# 03 — Meta Login and Page Connection (Workstream B)

**Verdict for this workstream: BLOCKED for live verification; PASS on source + automated evidence.**

## The honest headline

**The real Meta login flow was not exercised in this audit.** No Meta tester account, no
test Page, and no app-role access is available to this environment, and obtaining them
requires founder action in the Meta App Dashboard. Per the brief, I therefore **do not
claim a full pass** on this workstream.

What follows separates what is proven from what is not.

## Scenario matrix

| # | Scenario | Method | Status |
|---|---|---|---|
| 1 | Fresh Facebook session | — | **BLOCKED** (no Meta tester access) |
| 2 | Merchant manages one Page | source + unit test | PASS (source) |
| 3 | Merchant manages multiple Pages | source + unit test | PASS (source) |
| 4 | Merchant selects only one Page | source | PASS (source) |
| 5 | Merchant cancels authorization | source | PASS (source) |
| 6 | Merchant denies a required permission | source | PASS (source) |
| 7 | Merchant retries after denial | — | **BLOCKED** |
| 8 | Disconnect and reconnect | source + unit test | PASS (source) |
| 9 | Wrong Page is not connected | source + unit test | **PASS** |
| 10 | Duplicate connection → no duplicate records | source (transactional upsert) | PASS (source) |
| 11 | Another shop cannot claim the Page | source | **PASS** |
| 12 | Expired/invalid token → honest recoverable state | source + unit test | **PASS** |
| 13 | Connection errors leave no false "connected" | source | **PASS** |
| 14 | No Instagram asset shown | source | **PASS** |
| 15 | Reauthorization preserves tenant isolation | source | PASS (source) |
| 16 | Disconnect revokes/disables access | source | PASS (source) |
| 17 | Multi-Page behaviour matches product decision | source | PASS (source) |

"PASS (source)" = verified by reading the implementation and the passing unit tests, but
**not** exercised against real Meta. "PASS" (bold) = a specific structural guarantee that
does not depend on live Meta behaviour.

## The four guarantees worth calling out

### 9 + 14 — Only Facebook-authorized Pages are connectable

`listManagedAssets` calls `/me/accounts`, then intersects the result with the granular
`debug_token` target IDs (`MetaMessengerProvider.js:186-192`):

```js
const visiblePages = selectedPageIds
    ? meAccountsRaw.filter((p) => selectedPageIds.has(String(p.id)))
    : meAccountsRaw;
```

A Page the merchant did not select in Facebook's own dialog is never displayed and is
rejected by the connect endpoint. No Instagram asset can appear — there is no Instagram
discovery edge and no Instagram provider.

### 11 — Cross-shop Page takeover is blocked

`meta-channel.service.js:88-108`. Inside a transaction, any `meta_channels` row for the
same `meta_asset_id` belonging to a *different* `shop_id` is examined; a modern active
claim blocks with `409 META_ASSET_ALREADY_CONNECTED`. Only stale/non-routable claims are
released, and only after fresh Meta OAuth proves the current user manages the Page.

### 13 — No false "connected" state

`meta-oauth.service.js:220-237`. The app does not trust the subscribe call:

```js
await provider.subscribeWebhook({ channel });
const verify = await provider.verifyWebhookSubscription({ channel });
if (verify.ok) { await metaChannelService.confirmWebhookActive(channel.id, verify.fields); }
else { await metaChannelService.updateStatus(channel.id, 'ERROR', 'webhook_subscription_unverified'); }
```

It re-reads `subscribed_apps` and only keeps `CONNECTED` if the app is genuinely
subscribed for `messages`. A subscribe that "succeeds" but does not deliver produces
`ERROR`, not a false green. Failure of the subscribe call likewise produces `ERROR` with
a `webhookWarning` returned to the UI.

This is the correct pattern and directly contradicts the failure mode the brief warns
about.

### 12 — Token expiry is honest and recoverable

Meta error codes 102 and 190 stop retries and move the channel to `TOKEN_EXPIRED` via
`meta-authorization-recovery.service` (`MetaMessengerProvider.js:496-504`). Identity
mapping is transactional and **fails closed** — a mapping failure disconnects the channel
and clears the Page token rather than leaving a half-connected row
(`meta-oauth.service.js:203-217`).

Covered by `meta-authorization-recovery.service.test.js` (passing).

## What a reviewer could still hit

The connection path is sound, but see `04_WEBHOOK_SECURITY_AND_RELIABILITY.md` finding
**F-02**: if a Page ends up in any non-`CONNECTED` state, inbound customer messages for
it are **dropped silently** with a `200` to Meta. During App Review that would present as
"the reviewer sent a DM and nothing appeared", with no durable trace to diagnose it. This
is the main reviewer-visible risk in an otherwise clean flow.

## Founder prerequisites to close this workstream

Exact steps are in `18_FOUNDER_ACTION_CHECKLIST.md`. In summary: a test Facebook Page, a
customer tester account with an app role, and reviewer credentials for a test merchant —
all created in the Meta App Dashboard, none of which this audit can perform or verify.
