# Meta OAuth + App Review Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `business_management` permission from the live OAuth flow, make page discovery resilient to its absence, prove webhook subscriptions before marking a channel connected, move OAuth state to Redis for multi-instance safety, and surface channel health / reconnect / IG-link status in the UI — so EasyModerator can pass Meta App Review with the minimum permission surface.

**Architecture:** A modular monolith (Express + Sequelize + BullMQ). Meta integration lives in `EasyMod-backend/src/modules/channel-providers/` (OAuth service + provider classes + `meta_channels` entity) and `EasyMod-backend/src/modules/integration/` (webhook ingress). The React frontend's single connect surface is `EasyMod-frontend/src/app/components/ChatSettings.tsx`. We change behaviour at the provider + OAuth-service layer (backend) and the channel-card layer (frontend); the `meta_channels` table shape is unchanged except for one nullable timestamp already declared.

**Tech Stack:** Node 18 / Express / Sequelize (Postgres) / ioredis / BullMQ / Jest (backend) · React / TypeScript / Vitest / axios (frontend).

---

## Decision Gate (resolve before Wave 3 docs; does NOT block Waves 0–2)

`business_management` removal (Task 1) is unconditional and already planned. The remaining fork is **Task 11's deeper cut**:

- **Option A (recommended — keep):** retain `pages_manage_posts` + `instagram_manage_comments`, submit them for review with the public-reply / comment-to-DM screencast. Features stay live.
- **Option B (defer):** feature-flag Comment-to-DM and public replies OFF for v1, drop both scopes from every `DEFAULT_SCOPES`, ship the smallest possible request.

The code in this plan implements **Option A** (only `business_management` is removed). If Option B is chosen, Wave 0 Task A additionally removes those two scopes from both providers' `DEFAULT_SCOPES` and a follow-up feature-flag plan is needed. **Do not start Wave 3 Task 11 docs until this is decided.**

---

## File Structure

**Backend — modified**
- `EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js` — remove `business_management` from `unifiedScopes`; make `storeTemp`/`consumeTemp` Redis-backed; pass `includeBusinessPortfolio:false` to discovery.
- `EasyMod-backend/src/modules/channel-providers/providers/MetaMessengerProvider.js` — isolate Step 2 (business portfolio) behind an `includeBusinessPortfolio` flag + its own try/catch; per-source metrics; add `verifyWebhookSubscription()`.
- `EasyMod-backend/src/modules/channel-providers/providers/MetaInstagramProvider.js` — add `verifyWebhookSubscription()` (parent-page scoped).
- `EasyMod-backend/src/modules/channel-providers/ChannelProvider.js` — declare the `verifyWebhookSubscription()` abstract contract.
- `EasyMod-backend/src/modules/channel-providers/meta-channel.service.js` — write `webhook_last_verified_at` on verified connect.

**Backend — created**
- `EasyMod-backend/src/modules/channel-providers/oauth-state.store.js` — Redis-backed (cacheRedis) OAuth state store with in-memory fallback, 15-min TTL.

**Frontend — modified**
- `EasyMod-frontend/src/app/components/ChatSettings.tsx` — channel health block (Task 4), reconnect wiring (Task 5), IG-not-linked messaging (Task 6).
- `EasyMod-frontend/src/api/domains/meta-channels.ts` — already exposes `reconnectMetaChannel` + `webhookLastVerifiedAt`; extend `MetaChannel` type only if Task 7 adds a field.

**Docs — created/modified**
- `EasyMod-backend/.easymod/meta-app-review/permissions-justification.md` — backfill 4 missing entries (Task 9).
- `docs/meta-app-review.md` — permission→feature→screen→reviewer-steps matrix (Task 9) + reviewer test flow (Task 10).

**Tests — modified/created**
- `EasyMod-backend/src/modules/channel-providers/__tests__/MetaMessengerProvider.test.js` — update portfolio tests to opt-in flag; add default-off + isolation tests; add `verifyWebhookSubscription` tests.
- `EasyMod-backend/src/modules/channel-providers/__tests__/MetaInstagramProvider.test.js` — `verifyWebhookSubscription` tests.
- `EasyMod-backend/src/modules/channel-providers/__tests__/oauth-state.store.test.js` — new.
- `EasyMod-backend/src/modules/channel-providers/__tests__/meta-oauth.service.test.js` — assert `business_management` NOT in unified scopes.

---

# WAVE 0 — Scope Hardening (P0, single PR: Tasks 1 + 2 + 3)

### Task A: Isolate business-portfolio discovery behind an opt-in flag + per-source metrics

**Files:**
- Modify: `EasyMod-backend/src/modules/channel-providers/providers/MetaMessengerProvider.js:103-258` (the `listManagedAssets` method)
- Test: `EasyMod-backend/src/modules/channel-providers/__tests__/MetaMessengerProvider.test.js`

- [ ] **Step 1: Update the existing portfolio tests to opt-in, and add two new failing tests**

In `MetaMessengerProvider.test.js`, in the `listManagedAssets() pagination` describe block, change the two assertions that expect a `/me/businesses` call by default. The single-page test (`returns all pages from a single-page response`) must now expect **1** call, not 2:

```javascript
// REPLACE the second mock + the call-count assertions in
// 'returns all pages from a single-page response (no next cursor)':
test('returns all pages from a single-page response (no next cursor)', async () => {
    axios.get.mockResolvedValueOnce({
        data: {
            data: [
                { id: 'P1', name: 'Page 1', category: 'Shopping', picture: { data: { url: 'http://img/1' } }, instagram_business_account: null },
                { id: 'P2', name: 'Page 2', category: null, picture: null, instagram_business_account: { id: 'IG2', name: 'Shop IG', username: 'shopig' } },
            ],
            paging: { cursors: { before: 'abc', after: 'def' } }
        }
    });
    // NO /me/businesses mock — default flow must not call it.

    const result = await provider.listManagedAssets({ userToken: 'tok_abc' });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'P1', name: 'Page 1', pictureUrl: 'http://img/1', instagramAccount: null });
    expect(result[1]).toMatchObject({ id: 'P2', instagramAccount: { id: 'IG2', name: 'Shop IG', username: 'shopig' } });
    // Only /me/accounts is hit by default now.
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/me/accounts'),
        expect.objectContaining({ params: expect.objectContaining({ limit: 100 }) })
    );
});
```

In the `follows pagination cursor when next page exists` test, delete the third (`/me/businesses`) mock and change `toHaveBeenCalledTimes(3)` → `toHaveBeenCalledTimes(2)`. In `returns empty array...` delete the second mock and change `toHaveBeenCalledTimes(2)` → `toHaveBeenCalledTimes(1)`.

In the `listManagedAssets() Business Portfolio fallback` describe block, change **every** `provider.listManagedAssets({ userToken: '...' })` call to pass the opt-in flag:

```javascript
const result = await provider.listManagedAssets({ userToken: 'tok_biz', includeBusinessPortfolio: true });
```

Then append two new tests at the end of that describe block:

```javascript
test('does NOT query /me/businesses when includeBusinessPortfolio is false (default)', async () => {
    axios.get.mockResolvedValueOnce({
        data: { data: [{ id: 'P1', name: 'Page 1', category: null, picture: null, instagram_business_account: null }], paging: {} }
    });
    const result = await provider.listManagedAssets({ userToken: 'tok_default' });
    expect(result).toHaveLength(1);
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get).not.toHaveBeenCalledWith(
        expect.stringContaining('/me/businesses'),
        expect.anything()
    );
});

test('portfolio discovery failure does NOT discard /me/accounts results', async () => {
    // 1. /me/accounts succeeds with one page
    axios.get.mockResolvedValueOnce({
        data: { data: [{ id: 'P1', name: 'Page 1', category: null, picture: null, instagram_business_account: null }], paging: {} }
    });
    // 2. /me/businesses throws (e.g. permission missing)
    axios.get.mockRejectedValueOnce({ response: { status: 403, data: { error: { message: 'missing business_management', code: 200 } } } });

    const result = await provider.listManagedAssets({ userToken: 'tok_partial', includeBusinessPortfolio: true });

    // Step 1 pages survive even though Step 2 blew up.
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'P1' });
});
```

- [ ] **Step 2: Run the tests to verify the new/changed ones fail**

Run: `cd EasyMod-backend && npx jest MetaMessengerProvider --silent`
Expected: FAIL — default tests still see 2 calls (old code always calls `/me/businesses`); the isolation test fails because the shared try/catch rethrows.

- [ ] **Step 3: Rewrite `listManagedAssets` with isolated Step 2 + per-source metrics**

Replace the body of `listManagedAssets` ([MetaMessengerProvider.js:103-258](../../EasyMod-backend/src/modules/channel-providers/providers/MetaMessengerProvider.js#L103)) with:

```javascript
async listManagedAssets({ userToken, includeBusinessPortfolio = false }) {
    const PAGE_FIELDS =
        'id,name,category,access_token,' +
        'picture{data{url}},' +
        'instagram_business_account{id,name,username,profile_picture_url},' +
        'tasks';

    // ── Step 1: /me/accounts — REQUIRED. A failure here is fatal (nothing to show).
    const meAccountsRaw = [];
    try {
        let url = `${GRAPH_BASE}/me/accounts`;
        let params = {
            fields: PAGE_FIELDS,
            limit: 100,
            access_token: userToken,
            appsecret_proof: appsecretProof(userToken),
        };
        while (url) {
            const resp = await axios.get(url, { params });
            const batch = resp.data?.data || [];
            meAccountsRaw.push(...batch);
            const next = resp.data?.paging?.next;
            if (next && batch.length > 0) { url = next; params = {}; }
            else { url = null; }
        }
    } catch (err) {
        throw metaError(err, 'listManagedAssets:me/accounts');
    }

    // ── Step 2: Business Portfolio — OPTIONAL + ISOLATED. Only runs when the
    // caller opts in (i.e. business_management was actually granted). ANY failure
    // here is swallowed so it can never discard the Step 1 results above.
    const bizPagesRaw = [];
    let ownedCount = 0;
    let clientCount = 0;
    let portfolioError = null;
    if (includeBusinessPortfolio) {
        try {
            let bizUrl = `${GRAPH_BASE}/me/businesses`;
            let bizParams = {
                fields: 'id,name',
                limit: 100,
                access_token: userToken,
                appsecret_proof: appsecretProof(userToken),
            };
            const businesses = [];
            while (bizUrl) {
                const resp = await axios.get(bizUrl, { params: bizParams });
                const batch = resp.data?.data || [];
                businesses.push(...batch);
                const next = resp.data?.paging?.next;
                if (next && batch.length > 0) { bizUrl = next; bizParams = {}; }
                else { bizUrl = null; }
            }

            for (const biz of businesses) {
                for (const edge of ['owned_pages', 'client_pages']) {
                    let edgeUrl = `${GRAPH_BASE}/${biz.id}/${edge}`;
                    let edgeParams = {
                        fields: PAGE_FIELDS,
                        limit: 100,
                        access_token: userToken,
                        appsecret_proof: appsecretProof(userToken),
                    };
                    while (edgeUrl) {
                        const resp = await axios.get(edgeUrl, { params: edgeParams });
                        const batch = resp.data?.data || [];
                        bizPagesRaw.push(...batch);
                        if (edge === 'owned_pages') ownedCount += batch.length;
                        else clientCount += batch.length;
                        const next = resp.data?.paging?.next;
                        if (next && batch.length > 0) { edgeUrl = next; edgeParams = {}; }
                        else { edgeUrl = null; }
                    }
                }
            }
        } catch (err) {
            portfolioError = err.response?.data?.error?.message || err.message;
            logger.warn('Business Portfolio discovery skipped (non-fatal)', { reason: portfolioError });
        }
    }

    // ── Step 3: merge + dedup by page id (me/accounts wins) ──
    const seenIds = new Set();
    const mergedRaw = [];
    for (const p of [...meAccountsRaw, ...bizPagesRaw]) {
        if (!seenIds.has(p.id)) { seenIds.add(p.id); mergedRaw.push(p); }
    }

    // ── Step 4: normalise ──
    const result = mergedRaw.map(p => ({
        id: p.id,
        name: p.name,
        category: p.category || null,
        pictureUrl: p.picture?.data?.url || p.picture?.url || null,
        instagramAccount: p.instagram_business_account
            ? {
                id: p.instagram_business_account.id,
                name: p.instagram_business_account.name,
                username: p.instagram_business_account.username,
            }
            : null,
    }));

    // ── Task 3: per-source discovery metrics — every callback emits this ──
    logger.info('metaAssetsListed', {
        source_me_accounts: meAccountsRaw.length,
        source_owned_pages: ownedCount,
        source_client_pages: clientCount,
        portfolioAttempted: includeBusinessPortfolio,
        portfolioError,
        deduped: result.length,
        withIG: result.filter(p => p.instagramAccount !== null).length,
    });

    return result;
}
```

- [ ] **Step 4: Update the diagnostic-log test to the new field names**

In `MetaMessengerProvider.test.js`, the `diagnostic log reports correct counts` test currently asserts `{ mePages, ownedPages, clientPages, deduped, withIG }`. Pass the opt-in flag and update the field names:

```javascript
await provider.listManagedAssets({ userToken: 'tok_log', includeBusinessPortfolio: true });
// ...
expect(entry).toMatchObject({
    source_me_accounts: 1,
    source_owned_pages: 2,
    source_client_pages: 0,
    portfolioAttempted: true,
    deduped: 2,
    withIG: 1,
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd EasyMod-backend && npx jest MetaMessengerProvider --silent`
Expected: PASS (all pagination + portfolio + isolation + diagnostic tests green).

- [ ] **Step 6: Commit**

```bash
git add EasyMod-backend/src/modules/channel-providers/providers/MetaMessengerProvider.js \
        EasyMod-backend/src/modules/channel-providers/__tests__/MetaMessengerProvider.test.js
git commit -m "fix(meta): isolate business-portfolio discovery behind opt-in flag + per-source metrics"
```

---

### Task B: Remove `business_management` from the unified OAuth scope and add a regression test

**Files:**
- Modify: `EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js:188-198` (unifiedScopes) and `:229` / `:215-262` (pass the flag)
- Test: `EasyMod-backend/src/modules/channel-providers/__tests__/meta-oauth.service.test.js` (create)

- [ ] **Step 1: Write the failing regression test**

Create `EasyMod-backend/src/modules/channel-providers/__tests__/meta-oauth.service.test.js`:

```javascript
'use strict';

// Capture the scopes passed into buildAuthUrl by stubbing the provider registry.
const mockBuildAuthUrl = jest.fn().mockResolvedValue('https://www.facebook.com/v22.0/dialog/oauth?scope=stub');

jest.mock('../provider.registry', () => ({
    getProvider: () => ({
        buildAuthUrl: mockBuildAuthUrl,
        exchangeCode: jest.fn(),
        listManagedAssets: jest.fn().mockResolvedValue([]),
        getAssetAccessToken: jest.fn(),
        subscribeWebhook: jest.fn(),
    }),
}));
jest.mock('../meta-channel.service', () => ({ upsertFromOAuth: jest.fn() }));

const oauthService = require('../meta-oauth.service');

describe('initiateUnifiedOAuth scopes', () => {
    beforeEach(() => mockBuildAuthUrl.mockClear());

    test('does NOT request business_management', async () => {
        await oauthService.initiateUnifiedOAuth('user-1', 'shop-1');
        const { scopes } = mockBuildAuthUrl.mock.calls[0][0];
        expect(scopes).not.toContain('business_management');
    });

    test('still requests the core messaging + IG scopes', async () => {
        await oauthService.initiateUnifiedOAuth('user-1', 'shop-1');
        const { scopes } = mockBuildAuthUrl.mock.calls[0][0];
        expect(scopes).toEqual(expect.arrayContaining([
            'pages_show_list', 'pages_messaging', 'pages_manage_metadata',
            'instagram_basic', 'instagram_manage_messages',
        ]));
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd EasyMod-backend && npx jest meta-oauth.service --silent`
Expected: FAIL on `does NOT request business_management` (scope still present).

- [ ] **Step 3: Remove the scope + add the explanatory comment**

In `meta-oauth.service.js`, delete `'business_management',` from the `unifiedScopes` array ([:197](../../EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js#L197)) and replace the multi-line `business_management is required...` comment block ([:173-186](../../EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js#L173)) with:

```javascript
    // business_management was intentionally REMOVED before App Review: it is a
    // high-sensitivity scope and the only thing it bought was discovering pages
    // owned by a Business Portfolio that /me/accounts omits — a minority of BD
    // f-commerce merchants, who are personal Page admins. Portfolio discovery is
    // now opt-in (MetaMessengerProvider.listManagedAssets includeBusinessPortfolio)
    // and isolated, so its absence degrades gracefully to /me/accounts only.
```

- [ ] **Step 4: Pass `includeBusinessPortfolio: false` explicitly at the call site**

In `handleUnifiedCallback`, change the discovery call ([:229](../../EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js#L229)):

```javascript
    const pages = await fb.listManagedAssets({ userToken, includeBusinessPortfolio: false });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd EasyMod-backend && npx jest meta-oauth.service MetaMessengerProvider --silent`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js \
        EasyMod-backend/src/modules/channel-providers/__tests__/meta-oauth.service.test.js
git commit -m "feat(meta-oauth): drop business_management from unified consent (App Review prep)"
```

---

# WAVE 1 — Backend Correctness (P0)

### Task C: Webhook subscription hard validation — "Connected means connected" (Task 7)

**Files:**
- Modify: `EasyMod-backend/src/modules/channel-providers/ChannelProvider.js` (abstract contract)
- Modify: `EasyMod-backend/src/modules/channel-providers/providers/MetaMessengerProvider.js` (add `verifyWebhookSubscription`)
- Modify: `EasyMod-backend/src/modules/channel-providers/providers/MetaInstagramProvider.js` (add `verifyWebhookSubscription`)
- Modify: `EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js` (`connectPage` verifies + sets status/last_error)
- Modify: `EasyMod-backend/src/modules/channel-providers/meta-channel.service.js` (write `webhook_last_verified_at`)
- Test: both provider test files

> **Status design:** the `meta_channels.status` ENUM is `CONNECTED|TOKEN_EXPIRED|REVOKED|DISCONNECTED|ERROR` ([meta-channel.entity.js:131](../../EasyMod-backend/src/modules/channel-providers/meta-channel.entity.js#L131)). To avoid a Postgres ENUM `ALTER` (fragile in this repo's `db:sync` path), an unverified webhook sets `status='ERROR'` with `last_error='webhook_subscription_unverified'`. The UI (Task D) maps exactly that pair to an "Action Required" badge — no migration required.

- [ ] **Step 1: Write the failing `verifyWebhookSubscription` test (Messenger)**

In `MetaMessengerProvider.test.js`, add a describe block:

```javascript
describe('verifyWebhookSubscription()', () => {
    beforeEach(() => { process.env.META_APP_SECRET = 'test-secret'; });
    afterEach(() => jest.resetAllMocks());

    const channel = { meta_asset_id: 'PAGE_1', page_access_token_ct: 'tok_page' };

    test('returns ok:true when the page has a subscription including messages', async () => {
        axios.get.mockResolvedValueOnce({
            data: { data: [{ subscribed_fields: ['messages', 'feed', 'messaging_postbacks'] }] }
        });
        const res = await provider.verifyWebhookSubscription({ channel });
        expect(res.ok).toBe(true);
        expect(axios.get).toHaveBeenCalledWith(
            expect.stringContaining('/PAGE_1/subscribed_apps'),
            expect.objectContaining({ params: expect.objectContaining({ access_token: 'tok_page' }) })
        );
    });

    test('returns ok:false when no app is subscribed', async () => {
        axios.get.mockResolvedValueOnce({ data: { data: [] } });
        const res = await provider.verifyWebhookSubscription({ channel });
        expect(res.ok).toBe(false);
    });

    test('returns ok:false when messages field is missing', async () => {
        axios.get.mockResolvedValueOnce({ data: { data: [{ subscribed_fields: ['feed'] }] } });
        const res = await provider.verifyWebhookSubscription({ channel });
        expect(res.ok).toBe(false);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd EasyMod-backend && npx jest MetaMessengerProvider --silent -t verifyWebhookSubscription`
Expected: FAIL — `provider.verifyWebhookSubscription is not a function`.

- [ ] **Step 3: Implement `verifyWebhookSubscription` on both providers + the abstract contract**

In `ChannelProvider.js`, add to the abstract class:

```javascript
    /**
     * Confirm the connected asset actually has this app subscribed for inbound
     * events. Returns { ok: boolean, fields: string[] }. Never throws on a
     * non-subscribed page — returns ok:false so the caller can flag the channel.
     */
    async verifyWebhookSubscription({ channel }) { // eslint-disable-line no-unused-vars
        throw new Error('verifyWebhookSubscription() not implemented');
    }
```

In `MetaMessengerProvider.js`, after `subscribeWebhook` add:

```javascript
    async verifyWebhookSubscription({ channel }) {
        const token = channel.page_access_token_ct;
        const targetId = channel.meta_asset_id;
        if (!token) return { ok: false, fields: [] };
        try {
            const resp = await axios.get(`${GRAPH_BASE}/${targetId}/subscribed_apps`, {
                params: { access_token: token }
            });
            const apps = resp.data?.data || [];
            const fields = apps.flatMap(a => a.subscribed_fields || []);
            return { ok: apps.length > 0 && fields.includes('messages'), fields };
        } catch (err) {
            logger.warn('verifyWebhookSubscription failed', { error: err.message, channelId: channel.id });
            return { ok: false, fields: [] };
        }
    }
```

In `MetaInstagramProvider.js`, add the same method but target the parent page:

```javascript
    async verifyWebhookSubscription({ channel }) {
        const token = channel.page_access_token_ct;
        const targetId = channel.linked_fb_page_id || channel.meta_asset_id;
        if (!token) return { ok: false, fields: [] };
        try {
            const resp = await axios.get(`${GRAPH_BASE}/${targetId}/subscribed_apps`, {
                params: { access_token: token }
            });
            const apps = resp.data?.data || [];
            const fields = apps.flatMap(a => a.subscribed_fields || []);
            return { ok: apps.length > 0 && fields.includes('messages'), fields };
        } catch (err) {
            logger.warn('verifyWebhookSubscription failed', { error: err.message, channelId: channel.id });
            return { ok: false, fields: [] };
        }
    }
```

- [ ] **Step 4: Run provider tests to verify pass**

Run: `cd EasyMod-backend && npx jest MetaMessengerProvider MetaInstagramProvider --silent`
Expected: PASS.

- [ ] **Step 5: Wire verification into `connectPage` and write `webhook_last_verified_at`**

In `meta-oauth.service.js` `connectPage`, replace the best-effort webhook block ([:144-155](../../EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js#L144)) with subscribe → verify → status update:

```javascript
    // Subscribe, then HARD-VERIFY. A page can report success on subscribe yet not
    // actually deliver — so we re-read subscribed_apps and only keep CONNECTED if
    // the app is really subscribed for `messages`.
    let webhookWarning = null;
    try {
        await provider.subscribeWebhook({ channel });
        const verify = await provider.verifyWebhookSubscription({ channel });
        if (verify.ok) {
            await metaChannelService.markWebhookVerified(channel.id);
            logger.info('Webhook subscribed + verified', { channelId: channel.id, platform });
        } else {
            webhookWarning = 'Webhook subscription could not be verified — action required.';
            await metaChannelService.updateStatus(channel.id, 'ERROR', 'webhook_subscription_unverified');
            logger.warn('Webhook unverified after subscribe', { channelId: channel.id, fields: verify.fields });
        }
    } catch (err) {
        webhookWarning = `Webhook subscription failed: ${err.message}`;
        await metaChannelService.updateStatus(channel.id, 'ERROR', 'webhook_subscription_failed');
        logger.warn('Webhook subscription failed', { channelId: channel.id, err: err.message });
    }
```

In `meta-channel.service.js`, add a method near `updateStatus`:

```javascript
    /**
     * Stamp a successful webhook verification: writes webhook_last_verified_at and
     * (re)asserts CONNECTED. Called only after verifyWebhookSubscription returns ok.
     */
    async markWebhookVerified(channelId) {
        const channel = await MetaChannel.findByPk(channelId);
        if (!channel) throw new Error(`markWebhookVerified: channel ${channelId} not found`);
        channel.webhook_last_verified_at = new Date();
        channel.status = 'CONNECTED';
        channel.last_error = null;
        await channel.save();
        return channel;
    }
```

- [ ] **Step 6: Add a connectPage integration test (mocked provider)**

Create/extend `EasyMod-backend/src/modules/channel-providers/__tests__/meta-oauth.service.test.js` with a `connectPage` block that mocks `getProvider` to return `verifyWebhookSubscription: () => ({ ok: false })` and asserts `metaChannelService.updateStatus` is called with `('...', 'ERROR', 'webhook_subscription_unverified')`. (Mock `meta-channel.service` with jest.fn()s for `upsertFromOAuth`, `updateStatus`, `markWebhookVerified`.)

Run: `cd EasyMod-backend && npx jest meta-oauth.service --silent`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add EasyMod-backend/src/modules/channel-providers/
git commit -m "feat(meta): hard-verify webhook subscription on connect; flag unverified as ERROR"
```

---

### Task D: Move OAuth state to Redis (Task 8)

**Files:**
- Create: `EasyMod-backend/src/modules/channel-providers/oauth-state.store.js`
- Modify: `EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js` (use the store; make store/consume async)
- Test: `EasyMod-backend/src/modules/channel-providers/__tests__/oauth-state.store.test.js`

- [ ] **Step 1: Write the failing store test**

Create `oauth-state.store.test.js`:

```javascript
'use strict';

// Force the in-memory fallback path (no real Redis in unit tests).
jest.mock('../../../config/redis', () => ({
    cacheRedis: { _isMemoryFallback: true }
}));

const store = require('../oauth-state.store');

describe('oauth-state.store (memory fallback)', () => {
    test('stores and consumes a payload exactly once', async () => {
        await store.put('state-1', { shopId: 's1', platform: 'unified' });
        const first = await store.take('state-1');
        expect(first).toMatchObject({ shopId: 's1', platform: 'unified' });
        const second = await store.take('state-1');
        expect(second).toBeNull(); // single-use
    });

    test('returns null for unknown state', async () => {
        expect(await store.take('nope')).toBeNull();
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd EasyMod-backend && npx jest oauth-state.store --silent`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the store**

Create `oauth-state.store.js`:

```javascript
'use strict';

/**
 * Redis-backed OAuth state store (15-min TTL). Replaces the per-process Map so
 * OAuth initiate/callback survive landing on different backend instances.
 * Falls back to an in-memory Map only when Redis is the dev memory-fallback.
 */

const { cacheRedis } = require('../../config/redis');

const TTL_SECONDS = 15 * 60;
const PREFIX = 'oauth:state:';

const useRedis = cacheRedis && cacheRedis._isMemoryFallback !== true;

// Dev-only fallback (single process). TTL enforced lazily on read.
const _mem = new Map();

async function put(key, payload) {
    const value = JSON.stringify(payload);
    if (useRedis) {
        await cacheRedis.set(PREFIX + key, value, 'EX', TTL_SECONDS);
    } else {
        _mem.set(key, { value, expiresAt: Date.now() + TTL_SECONDS * 1000 });
    }
}

async function take(key) {
    if (useRedis) {
        const raw = await cacheRedis.get(PREFIX + key);
        if (raw == null) return null;
        await cacheRedis.del(PREFIX + key); // single-use
        try { return JSON.parse(raw); } catch { return null; }
    }
    const entry = _mem.get(key);
    if (!entry) return null;
    _mem.delete(key);
    if (Date.now() > entry.expiresAt) return null;
    try { return JSON.parse(entry.value); } catch { return null; }
}

module.exports = { put, take, TTL_SECONDS };
```

- [ ] **Step 4: Run the store test to verify pass**

Run: `cd EasyMod-backend && npx jest oauth-state.store --silent`
Expected: PASS.

- [ ] **Step 5: Swap the in-memory Map in `meta-oauth.service.js` for the store**

Delete the `_tempTokenStore` Map + `storeTemp`/`consumeTemp` helpers ([:23-39](../../EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js#L23)). Add at the top:

```javascript
const stateStore = require('./oauth-state.store');
```

Then replace every `storeTemp(k, v)` with `await stateStore.put(k, v)` and every `consumeTemp(k)` with `await stateStore.take(k)`. The affected sites: `initiateOAuth` ([:54](../../EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js#L54)), `handleCallback` ([:75](../../EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js#L75), [:93](../../EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js#L93)), `connectPage` ([:119](../../EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js#L119) — now `await`), `initiateUnifiedOAuth` ([:171](../../EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js#L171)), `handleUnifiedCallback` ([:217](../../EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js#L217), [:252-253](../../EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js#L252)). All five functions are already `async`.

- [ ] **Step 6: Run the full meta suite to verify nothing regressed**

Run: `cd EasyMod-backend && npx jest channel-providers --silent`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add EasyMod-backend/src/modules/channel-providers/oauth-state.store.js \
        EasyMod-backend/src/modules/channel-providers/__tests__/oauth-state.store.test.js \
        EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js
git commit -m "fix(meta-oauth): Redis-backed OAuth state store for multi-instance safety"
```

---

# WAVE 2 — Channel UX (P1; depends on Wave 1 fields)

> These three tasks all live in `EasyMod-frontend/src/app/components/ChatSettings.tsx`. They are FE-only and use the existing `meta-channels.ts` client (which already exposes `reconnectMetaChannel`, `webhookLastVerifiedAt`, `linkedFbPageId`, and per-channel `status`). Each step names the exact insertion point.

### Task E: Channel health block (Task 4)

**Files:** Modify `ChatSettings.tsx` (the `isConnected && channel` block, after `ChannelAutoReplyToggle` at [:1003](../../EasyMod-frontend/src/app/components/ChatSettings.tsx#L1003)); add an `ActionRequired` badge mapping next to the existing badges ([:745-762](../../EasyMod-frontend/src/app/components/ChatSettings.tsx#L745)).

- [ ] **Step 1: Add an "Action Required" badge for the webhook-unverified state**

After the `isErrored` badge ([:757-762](../../EasyMod-frontend/src/app/components/ChatSettings.tsx#L757)), the existing `ERROR` status already renders an "Error" pill. Refine it: when `channel?.lastError === 'webhook_subscription_unverified' || 'webhook_subscription_failed'`, render an amber **"Action Required"** pill with a Reconnect affordance instead of the generic red "Error". Compute near the other status flags ([:681-683](../../EasyMod-frontend/src/app/components/ChatSettings.tsx#L681)):

```tsx
const isActionRequired =
  channel?.status === "ERROR" &&
  (channel?.lastError === "webhook_subscription_unverified" ||
   channel?.lastError === "webhook_subscription_failed");
```

- [ ] **Step 2: Render a compact health grid**

Insert immediately after `<ChannelAutoReplyToggle channelId={channel.id} />` ([:1003](../../EasyMod-frontend/src/app/components/ChatSettings.tsx#L1003)):

```tsx
<div className="mb-3 grid grid-cols-2 gap-1.5 text-[11px]">
  <HealthRow label="Connection" ok={channel.status === "CONNECTED"}
             okText="Connected" badText={channel.status} />
  <HealthRow label="Webhook" ok={!!channel.webhookLastVerifiedAt}
             okText="Active" badText="Not verified" />
  <HealthRow label="Token" ok={!channel.tokenExpiresAt ||
             new Date(channel.tokenExpiresAt).getTime() > Date.now()}
             okText="Valid" badText="Expired" />
  <HealthRow label="Last webhook"
             ok={!!channel.webhookLastVerifiedAt}
             okText={channel.webhookLastVerifiedAt
               ? new Date(channel.webhookLastVerifiedAt).toLocaleDateString() : "—"}
             badText="None yet" neutral />
  {channel.platform === "instagram" && (
    <HealthRow label="Instagram" ok={!!channel.linkedFbPageId}
               okText="Linked" badText="Not linked" />
  )}
</div>
```

Add a small `HealthRow` helper component at the bottom of the file (sibling to `ChannelAutoReplyToggle`):

```tsx
function HealthRow({ label, ok, okText, badText, neutral = false }:
  { label: string; ok: boolean; okText: string; badText: string; neutral?: boolean }) {
  const tone = neutral ? "text-gray-500" : ok ? "text-green-700" : "text-amber-700";
  return (
    <div className="flex items-center justify-between rounded bg-gray-50 px-2 py-1">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium ${tone}`}>{ok ? okText : badText}</span>
    </div>
  );
}
```

> **Backend prerequisite:** `webhookLastVerifiedAt` is now populated by Task C (`markWebhookVerified`). `linkedFbPageId` and `status`/`lastError` already serialize ([meta-channel.controller.js:38-49](../../EasyMod-backend/src/modules/channel-providers/meta-channel.controller.js#L38)). No API change needed. "Last webhook received" is approximated by `webhookLastVerifiedAt` for v1; a true `last_webhook_received_at` column is out of scope (note in PR).

- [ ] **Step 3: Verify in the dev app**

Run the frontend (`cd EasyMod-frontend && npm run dev`), connect a test page, confirm the health grid renders with Webhook=Active after a verified connect and Webhook=Not verified when Task C flags it.

- [ ] **Step 4: Commit**

```bash
git add EasyMod-frontend/src/app/components/ChatSettings.tsx
git commit -m "feat(channels-ui): per-channel health grid (connection/webhook/token/IG)"
```

### Task F: Wire the Reconnect / Refresh-Permissions button (Task 5)

**Files:** Modify `ChatSettings.tsx` — import `reconnectMetaChannel` ([meta-channels.ts:199](../../EasyMod-frontend/src/api/domains/meta-channels.ts#L199)); add a handler that opens the returned `redirectUrl` in the same popup flow as `handleConnectClick`; render a **"Refresh permissions"** button in the connected-card action grid ([:1005-1039](../../EasyMod-frontend/src/app/components/ChatSettings.tsx#L1005)).

- [ ] **Step 1:** Add `reconnectMetaChannel` to the import block ([:22-41](../../EasyMod-frontend/src/app/components/ChatSettings.tsx#L22)).
- [ ] **Step 2:** Add `handleReconnect(channel)`: `const { redirectUrl } = await reconnectMetaChannel(channel.id)`, then reuse the existing popup-open + `BroadcastChannel`/`message` listener pattern from `handleConnectClick` ([:201-253](../../EasyMod-frontend/src/app/components/ChatSettings.tsx#L201)) so the callback returns to the page picker and re-runs `connectMetaAsset` (which upserts in place). Guard with `oauthInProgressRef`.
- [ ] **Step 3:** In the 3-button action grid, change it to a 4-button grid (or add a row) with a `RefreshCw`+`ShieldCheck` "Refresh permissions" button calling `handleReconnect(channel)`. Keep the existing list-refresh button labelled "Refresh list" to disambiguate.
- [ ] **Step 4:** Verify: click "Refresh permissions" on a connected channel → Meta consent popup → on completion the channel's `tokenExpiresAt`/`webhookLastVerifiedAt` update without a disconnect.
- [ ] **Step 5: Commit** `git commit -m "feat(channels-ui): wire reconnect → refresh permissions/token without full disconnect"`

### Task G: Surface Instagram-not-linked status (Task 6)

**Files:** Modify `ChatSettings.tsx` — the unified picker's IG section ([:314-322](../../EasyMod-frontend/src/app/components/ChatSettings.tsx#L314)) and the picker empty-state ([:571-574](../../EasyMod-frontend/src/app/components/ChatSettings.tsx#L571)).

- [ ] **Step 1:** When `result.instagramAccounts.length === 0` but `result.facebookPages.length > 0`, push a non-selectable informational entry (or render a banner above the picker): **"No Instagram Business account is linked to these Pages."** with a "Learn more" link to Meta's "Connect IG to a Page" doc (`https://www.facebook.com/business/help/connect-instagram-to-page`).
- [ ] **Step 2:** In the connected-card IG health row (Task E), `linkedFbPageId == null` already shows "Not linked"; add a one-line helper under it: *"Link this IG account to its Facebook Page in Meta Business Suite, then Refresh permissions."*
- [ ] **Step 3:** Verify with a test FB page that has no linked IG → picker shows the explanatory message instead of silently listing only FB pages.
- [ ] **Step 4: Commit** `git commit -m "feat(channels-ui): explain when no Instagram Business account is linked"`

---

# WAVE 3 — Submission Docs (P0 for submit; parallelizable)

### Task H: Permission→Feature matrix + backfill justification doc (Task 9)

**Files:** Create `docs/meta-app-review.md`; modify `EasyMod-backend/.easymod/meta-app-review/permissions-justification.md`.

- [ ] **Step 1:** In `permissions-justification.md`, add the 4 missing sections (the file currently documents only `pages_messaging`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_manage_messages`): add `pages_show_list`, `pages_manage_metadata`, `instagram_manage_comments`. **Do NOT add `business_management`** — it is no longer requested (Task B). Each entry follows the existing template: use case · user-facing screen · Graph API calls · data retention.
- [ ] **Step 2:** Create `docs/meta-app-review.md` with the permission→feature→screen→reviewer-steps matrix (8 rows = the final requested set). Source the content from the audit table in §6/§7 of the architecture report; the reviewer screen for each is `Settings → Chat Settings`.
- [ ] **Step 3:** Cross-check: every scope in `MetaMessengerProvider.DEFAULT_SCOPES` + `MetaInstagramProvider.DEFAULT_SCOPES` + `meta-oauth.service.unifiedScopes` appears in both docs, and no scope appears in the docs that the code doesn't request. (After Task B, the union is exactly the 8-permission set.)
- [ ] **Step 4: Commit** `git commit -m "docs(meta-review): permission matrix + backfill 4 missing justifications; drop business_management"`

### Task I: Reviewer test flow + screencast script (Task 10)

**Files:** Append to `docs/meta-app-review.md`.

- [ ] **Step 1:** Write the numbered reviewer walkthrough (target 2–4 min): (1) login with supplied tester creds, (2) Settings → Chat Settings → "Facebook + Instagram একসাথে সংযুক্ত করুন", (3) grant consent, (4) pick the test Page + IG, (5) confirm health grid shows Webhook=Active, (6) tester sends a DM, (7) AI auto-reply round-trip, (8) human reply from inbox. Reuse the live-server steps already in [dashboard-setup-walkthrough.md §12](../EasyMod-backend/.easymod/meta-app-review/dashboard-setup-walkthrough.md) and the storyboards in `screencast-storyboards.md`.
- [ ] **Step 2:** Note the Dev-mode webhook gating caveat for the reviewer (sender must be on App Roles, or app must be Live) so the inbound demo isn't mistaken for a bug.
- [ ] **Step 3: Commit** `git commit -m "docs(meta-review): 2–4 min reviewer test flow + screencast script"`

### Task J: Record the minimization decision (Task 11)

**Files:** Append a "Permission minimization decision" section to `docs/meta-app-review.md` capturing the Decision Gate outcome (Option A kept comment/post scopes, or Option B deferred them), the final requested set, and the rationale. No code change beyond what Task B already did (unless Option B was chosen — then also remove the two scopes from both `DEFAULT_SCOPES` and gate the features).

- [ ] **Step 1:** Write the section. **Step 2:** Commit `git commit -m "docs(meta-review): record final permission set + minimization rationale"`

---

# Validation Checklist (gate before App Review submission)

- [ ] No `business_management` requested — `npx jest meta-oauth.service -t business_management` green; manual: consent screen shows no "manage your business".
- [ ] OAuth works end-to-end on a single instance (dev smoke per dashboard-walkthrough §9).
- [ ] OAuth works across instances — state survives a callback on a different process (Redis store).
- [ ] Page picker works with **only** `/me/accounts` (portfolio path off) — connect a personal-admin test page.
- [ ] IG picker works; IG-not-linked shows the explanatory message.
- [ ] Webhooks hard-verified — a freshly connected page shows Webhook=Active; a page that fails `subscribed_apps` shows Action Required (not a false "Connected").
- [ ] Reconnect / Refresh-permissions button recovers token/permission drift without disconnect.
- [ ] Health grid visible per channel (connection / webhook / token / last webhook / IG).
- [ ] `permissions-justification.md` covers all 8 requested scopes; `docs/meta-app-review.md` matrix matches code exactly.
- [ ] Reviewer instructions + screencast recorded.
- [ ] Test accounts prepared and on the App Roles roster.
- [ ] Full backend suite green: `cd EasyMod-backend && npm test`.

---

## Self-Review (author checklist — completed)

- **Spec coverage:** Task 1→Task B; Task 2→Task A; Task 3→Task A (per-source metrics); Task 4→Task E; Task 5→Task F; Task 6→Task G; Task 7→Task C; Task 8→Task D; Task 9→Task H; Task 10→Task I; Task 11→Decision Gate + Task J. All 11 mapped.
- **Type/name consistency:** new method `verifyWebhookSubscription({channel})` used identically in providers, ChannelProvider contract, and `connectPage`. Store API `put`/`take` consistent across store + service + tests. Status/`last_error` strings (`webhook_subscription_unverified` / `webhook_subscription_failed`) identical in backend Task C and frontend Task E. `includeBusinessPortfolio` flag identical in provider + service call + tests.
- **No placeholders:** backend tasks carry full code; FE/doc tasks name exact files, line ranges, API functions (`reconnectMetaChannel`, `webhookLastVerifiedAt`, `linkedFbPageId`) and insertion points rather than vague directives.
- **Known scope note:** "Last webhook received" is approximated by `webhook_last_verified_at`; a dedicated `last_webhook_received_at` column is deliberately out of scope (flagged in Task E).

---

## Deferred Technical Debt (surfaced during execution — needs human review)

These were raised by code review during the Wave 2 build and **deliberately deferred** as out-of-scope/high-risk. They are NOT regressions from this work — they are pre-existing conditions the plan told Task F to replicate. Schedule as a focused follow-up with proper OAuth-flow test coverage before touching:

1. **Extract a shared `runOAuthPopup({ redirectUrl, state, platform, onSuccess })` helper (DRY).** `ChatSettings.tsx` now has THREE near-identical copies of the OAuth popup + `BroadcastChannel` + message-listener + nonce/origin-validation machinery: `handleConnectClick`, `handleConnectUnified`, and the new `handleReconnect`. A future fix to one (e.g. tightening the origin/nonce check) can silently miss the others. Extraction is feasible (only `platform` is closure-captured; pass it as a param) but it restructures security-critical OAuth code and there is currently **no automated test of the real popup lifecycle**, so it warrants human review + manual OAuth QA.

2. **Fix the `cleanup()` timing race in all three OAuth handlers.** On the success branch, `cleanup()` runs synchronously after the callback promise is dispatched (`.then()`) but before it settles — prematurely resetting `oauthInProgressRef` and closing the `BroadcastChannel`. Window is typically <500ms (rare), but under slow network a second OAuth could bypass the guard or a late BC message be dropped. Pre-existing in `handleConnectClick`/`handleConnectUnified`; `handleReconnect` inherits it. Best fixed once, inside the extracted helper from (1), by moving `cleanup()` into `.finally()`.

**Controller decision (2026-06-04):** landed Wave 2 as spec-compliant + secure; deferred (1)+(2) rather than have a subagent autonomously refactor the product's most critical flow without popup-lifecycle test coverage. See [[oauth-popup-dedup-debt]].
