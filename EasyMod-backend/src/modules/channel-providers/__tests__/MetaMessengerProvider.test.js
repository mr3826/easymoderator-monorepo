/**
 * MetaMessengerProvider.test.js
 *
 * Unit tests for the Facebook Messenger provider — focused on pure functions
 * that don't require Meta API access: webhook parsing, signature verification,
 * webhook field list, pagination in listManagedAssets, and the abstract-class
 * contract.
 */

'use strict';

const crypto = require('crypto');
const axios = require('axios');
const MetaMessengerProvider = require('../providers/MetaMessengerProvider');
const ChannelProvider = require('../ChannelProvider');

jest.mock('axios');

describe('MetaMessengerProvider', () => {
    let provider;

    beforeEach(() => {
        process.env.META_WEBHOOK_APP_SECRET = 'test-webhook-secret';
        process.env.META_APP_SECRET = 'test-webhook-secret';
        provider = new MetaMessengerProvider();
    });

    test('extends ChannelProvider', () => {
        expect(provider).toBeInstanceOf(ChannelProvider);
    });

    test('platform getter returns "facebook"', () => {
        expect(provider.platform).toBe('facebook');
    });

    describe('webhookFields()', () => {
        test('includes messages and feed for comment-to-DM', () => {
            const fields = provider.webhookFields();
            expect(fields).toContain('messages');
            expect(fields).toContain('messaging_postbacks');
            expect(fields).toContain('messaging_optins');
            expect(fields).toContain('feed');
        });

        test('does NOT include whatsapp-related fields', () => {
            const fields = provider.webhookFields();
            expect(fields).not.toContain('message_template_status_update');
            expect(fields).not.toContain('phone_number_quality_update');
        });

        test('returns a fresh copy (mutating result does not affect provider)', () => {
            const a = provider.webhookFields();
            a.push('hacked');
            const b = provider.webhookFields();
            expect(b).not.toContain('hacked');
        });
    });

    describe('verifyWebhookSignature()', () => {
        const rawBody = Buffer.from('{"object":"page","entry":[]}');

        function sigFor(body, secret = 'test-webhook-secret') {
            return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
        }

        test('returns true for valid signature', async () => {
            const ok = await provider.verifyWebhookSignature({ rawBody, signature: sigFor(rawBody) });
            expect(ok).toBe(true);
        });

        test('returns false for tampered body', async () => {
            const ok = await provider.verifyWebhookSignature({
                rawBody: Buffer.from('{"object":"page","entry":["tampered"]}'),
                signature: sigFor(rawBody)
            });
            expect(ok).toBe(false);
        });

        test('returns false for wrong secret', async () => {
            const ok = await provider.verifyWebhookSignature({
                rawBody,
                signature: sigFor(rawBody, 'wrong-secret')
            });
            expect(ok).toBe(false);
        });

        test('returns false for missing or malformed signature', async () => {
            expect(await provider.verifyWebhookSignature({ rawBody, signature: '' })).toBe(false);
            expect(await provider.verifyWebhookSignature({ rawBody, signature: 'no-prefix' })).toBe(false);
            expect(await provider.verifyWebhookSignature({ rawBody, signature: null })).toBe(false);
        });
    });

    describe('parseWebhookEnvelope()', () => {
        test('returns [] for non-page payloads', () => {
            expect(provider.parseWebhookEnvelope({ object: 'instagram', entry: [] })).toEqual([]);
            expect(provider.parseWebhookEnvelope(null)).toEqual([]);
            expect(provider.parseWebhookEnvelope({})).toEqual([]);
        });

        test('extracts text messages from page messaging events', () => {
            const events = provider.parseWebhookEnvelope({
                object: 'page',
                entry: [{
                    id: 'PAGE_123',
                    messaging: [{
                        sender: { id: 'PSID_999' },
                        recipient: { id: 'PAGE_123' },
                        timestamp: 1700000000000,
                        message: { mid: 'mid_abc', text: 'Hello!' }
                    }]
                }]
            });
            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({
                externalId: 'mid_abc',
                senderExternalId: 'PSID_999',
                pageOrAccountId: 'PAGE_123',
                text: 'Hello!',
                isEcho: false,
                commentId: null,
                postId: null
            });
        });

        test('drops echo events (page\'s own outbound reflected back)', () => {
            const events = provider.parseWebhookEnvelope({
                object: 'page',
                entry: [{
                    id: 'PAGE_123',
                    messaging: [{
                        sender: { id: 'PAGE_123' },
                        recipient: { id: 'PSID_999' },
                        timestamp: 1700000000000,
                        message: { mid: 'mid_echo', text: 'Bot reply', is_echo: true }
                    }]
                }]
            });
            expect(events).toEqual([]);
        });

        test('emits comment events from feed changes', () => {
            const events = provider.parseWebhookEnvelope({
                object: 'page',
                entry: [{
                    id: 'PAGE_123',
                    changes: [{
                        field: 'feed',
                        value: {
                            item: 'comment',
                            comment_id: 'C_456',
                            post_id: 'P_789',
                            from: { id: 'USER_AAA', name: 'Test User' },
                            message: 'Send me details',
                            created_time: 1700000000
                        }
                    }]
                }]
            });
            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({
                externalId: 'C_456',
                senderExternalId: 'USER_AAA',
                pageOrAccountId: 'PAGE_123',
                text: 'Send me details',
                commentId: 'C_456',
                postId: 'P_789'
            });
        });

        test('ignores non-comment feed events', () => {
            const events = provider.parseWebhookEnvelope({
                object: 'page',
                entry: [{
                    id: 'PAGE_123',
                    changes: [{ field: 'feed', value: { item: 'reaction' } }]
                }]
            });
            expect(events).toEqual([]);
        });
    });

    describe('listManagedAssets() pagination', () => {
        beforeEach(() => {
            process.env.META_APP_SECRET = 'test-secret';
            process.env.META_APP_ID = 'test-app-id';
        });

        afterEach(() => {
            jest.resetAllMocks();
        });

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

        test('follows pagination cursor when next page exists', async () => {
            // 1. /me/accounts page 1 — signals more pages via `next`
            axios.get.mockResolvedValueOnce({
                data: {
                    data: [{ id: 'P1', name: 'Page 1', category: null, picture: null, instagram_business_account: null }],
                    paging: { next: 'https://graph.facebook.com/v22.0/me/accounts?after=CURSOR' }
                }
            });
            // 2. /me/accounts page 2 — no `next`, pagination ends
            axios.get.mockResolvedValueOnce({
                data: {
                    data: [{ id: 'P2', name: 'Page 2', category: null, picture: null, instagram_business_account: null }],
                    paging: { cursors: { before: 'x', after: 'y' } }
                }
            });
            // No /me/businesses mock — default flow does not call it

            const result = await provider.listManagedAssets({ userToken: 'tok_xyz' });

            expect(result).toHaveLength(2);
            expect(result.map(p => p.id)).toEqual(['P1', 'P2']);
            // 2 pages of me/accounts only (no businesses call)
            expect(axios.get).toHaveBeenCalledTimes(2);
            // Second call (cursor follow) uses the `next` URL directly (no extra params)
            expect(axios.get).toHaveBeenNthCalledWith(
                2,
                'https://graph.facebook.com/v22.0/me/accounts?after=CURSOR',
                { params: {} }
            );
        });

        test('returns empty array when me/accounts returns no pages and no businesses', async () => {
            // 1. /me/accounts — empty
            axios.get.mockResolvedValueOnce({
                data: { data: [], paging: {} }
            });
            // No /me/businesses mock — default flow does not call it
            const result = await provider.listManagedAssets({ userToken: 'tok_empty' });
            expect(result).toEqual([]);
            // Only 1 call: /me/accounts
            expect(axios.get).toHaveBeenCalledTimes(1);
        });
    });

    // ── Business Portfolio fallback ────────────────────────────────────────────
    // Pages owned by a Meta Business Portfolio are NOT returned by /me/accounts.
    // The fix: after exhausting /me/accounts, also query /me/businesses →
    // /{business-id}/owned_pages and /{business-id}/client_pages, then dedup by
    // page id.

    describe('listManagedAssets() Business Portfolio fallback', () => {
        beforeEach(() => {
            process.env.META_APP_SECRET = 'test-secret';
            process.env.META_APP_ID = 'test-app-id';
        });

        afterEach(() => {
            jest.resetAllMocks();
        });

        // (a) Only /me/accounts populated — no businesses, result unchanged
        test('(a) only me/accounts pages present — no business fallback needed', async () => {
            // 1. /me/accounts → 2 pages
            axios.get.mockResolvedValueOnce({
                data: {
                    data: [
                        { id: 'P1', name: 'Personal Page 1', category: 'Shopping', picture: null, instagram_business_account: null },
                        { id: 'P2', name: 'Personal Page 2', category: null, picture: null, instagram_business_account: { id: 'IG2', name: 'IG Shop', username: 'igshop' } },
                    ],
                    paging: {}
                }
            });
            // 2. /me/businesses → empty
            axios.get.mockResolvedValueOnce({
                data: { data: [], paging: {} }
            });

            const result = await provider.listManagedAssets({ userToken: 'tok_personal', includeBusinessPortfolio: true });

            expect(result).toHaveLength(2);
            expect(result.map(p => p.id)).toEqual(['P1', 'P2']);
            // me/accounts + me/businesses = 2 calls minimum
            expect(axios.get).toHaveBeenCalledTimes(2);
        });

        // (b) Only business-owned pages present — /me/accounts empty
        test('(b) only Business Portfolio pages present — me/accounts empty', async () => {
            // 1. /me/accounts → empty
            axios.get.mockResolvedValueOnce({
                data: { data: [], paging: {} }
            });
            // 2. /me/businesses → one business
            axios.get.mockResolvedValueOnce({
                data: {
                    data: [{ id: 'BIZ_1', name: 'Hexabyte Ltd' }],
                    paging: {}
                }
            });
            // 3. /BIZ_1/owned_pages → one page with IG
            axios.get.mockResolvedValueOnce({
                data: {
                    data: [
                        {
                            id: 'BP1',
                            name: 'Business Page 1',
                            category: 'E-Commerce',
                            access_token: 'PAGE_TOKEN_BP1',
                            picture: { data: { url: 'http://img/bp1' } },
                            instagram_business_account: { id: 'IGBP1', name: 'BizIG', username: 'bizig', profile_picture_url: 'http://img/igbp1' },
                        }
                    ],
                    paging: {}
                }
            });
            // 4. /BIZ_1/client_pages → empty
            axios.get.mockResolvedValueOnce({
                data: { data: [], paging: {} }
            });

            const result = await provider.listManagedAssets({ userToken: 'tok_biz', includeBusinessPortfolio: true });

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                id: 'BP1',
                name: 'Business Page 1',
                category: 'E-Commerce',
                pictureUrl: 'http://img/bp1',
            });
            expect(result[0].instagramAccount).toMatchObject({
                id: 'IGBP1',
                username: 'bizig',
            });
        });

        // (c) Both /me/accounts and business-owned pages present, with an overlapping page — dedup by id
        test('(c) both me/accounts and business-owned pages present — overlapping page deduped', async () => {
            // 1. /me/accounts → pages P1 and P_SHARED
            axios.get.mockResolvedValueOnce({
                data: {
                    data: [
                        { id: 'P1', name: 'Classic Page', category: 'Retail', picture: null, instagram_business_account: null },
                        { id: 'P_SHARED', name: 'Shared Page', category: 'Shopping', picture: null, instagram_business_account: null },
                    ],
                    paging: {}
                }
            });
            // 2. /me/businesses → one business
            axios.get.mockResolvedValueOnce({
                data: {
                    data: [{ id: 'BIZ_1', name: 'Acme Corp' }],
                    paging: {}
                }
            });
            // 3. /BIZ_1/owned_pages → P_SHARED (duplicate) + P_BIZ_ONLY
            axios.get.mockResolvedValueOnce({
                data: {
                    data: [
                        { id: 'P_SHARED', name: 'Shared Page', category: 'Shopping', access_token: 'tok_shared', picture: null, instagram_business_account: null },
                        { id: 'P_BIZ_ONLY', name: 'Biz Exclusive', category: 'E-Commerce', access_token: 'tok_biz_only', picture: null, instagram_business_account: null },
                    ],
                    paging: {}
                }
            });
            // 4. /BIZ_1/client_pages → empty
            axios.get.mockResolvedValueOnce({
                data: { data: [], paging: {} }
            });

            const result = await provider.listManagedAssets({ userToken: 'tok_overlap', includeBusinessPortfolio: true });

            // 3 unique pages: P1, P_SHARED (deduped), P_BIZ_ONLY
            expect(result).toHaveLength(3);
            const ids = result.map(p => p.id);
            expect(ids).toContain('P1');
            expect(ids).toContain('P_SHARED');
            expect(ids).toContain('P_BIZ_ONLY');
            // P_SHARED appears exactly once
            expect(ids.filter(id => id === 'P_SHARED')).toHaveLength(1);
        });

        // (d) IG account attached to business page vs not attached
        test('(d) IG account attached to business-owned page is exposed; missing IG returns null', async () => {
            // 1. /me/accounts → empty
            axios.get.mockResolvedValueOnce({ data: { data: [], paging: {} } });
            // 2. /me/businesses → one business
            axios.get.mockResolvedValueOnce({
                data: { data: [{ id: 'BIZ_2', name: 'Shop Biz' }], paging: {} }
            });
            // 3. /BIZ_2/owned_pages → one page WITH IG, one WITHOUT
            axios.get.mockResolvedValueOnce({
                data: {
                    data: [
                        {
                            id: 'BP_WITH_IG',
                            name: 'Page with IG',
                            category: 'Fashion',
                            access_token: 'PAGE_TOKEN_X',
                            picture: null,
                            instagram_business_account: { id: 'IG_OK', name: 'Fashion IG', username: 'fashionic', profile_picture_url: null },
                        },
                        {
                            id: 'BP_NO_IG',
                            name: 'Page without IG',
                            category: 'Food',
                            access_token: 'PAGE_TOKEN_Y',
                            picture: null,
                            instagram_business_account: null,
                        },
                    ],
                    paging: {}
                }
            });
            // 4. /BIZ_2/client_pages → empty
            axios.get.mockResolvedValueOnce({ data: { data: [], paging: {} } });

            const result = await provider.listManagedAssets({ userToken: 'tok_ig_check', includeBusinessPortfolio: true });

            expect(result).toHaveLength(2);
            const withIG = result.find(p => p.id === 'BP_WITH_IG');
            const noIG = result.find(p => p.id === 'BP_NO_IG');

            expect(withIG.instagramAccount).toMatchObject({ id: 'IG_OK', username: 'fashionic' });
            expect(noIG.instagramAccount).toBeNull();
        });

        // Diagnostic log: metaAssetsListed emitted with correct counts.
        // The logger writes JSON to console.log in test env — spy on console.log
        // and find the matching log entry.
        test('diagnostic log reports correct counts (source_me_accounts, source_owned_pages, source_client_pages, deduped, withIG)', async () => {
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

            // 1. /me/accounts → 1 page (PA, no IG)
            axios.get.mockResolvedValueOnce({
                data: { data: [{ id: 'PA', name: 'A', category: null, picture: null, instagram_business_account: null }], paging: {} }
            });
            // 2. /me/businesses → one business
            axios.get.mockResolvedValueOnce({
                data: { data: [{ id: 'B1', name: 'Biz' }], paging: {} }
            });
            // 3. owned_pages → PA (overlap) + PB (unique, has IG)
            axios.get.mockResolvedValueOnce({
                data: {
                    data: [
                        { id: 'PA', name: 'A', category: null, picture: null, instagram_business_account: null },
                        { id: 'PB', name: 'B', category: null, picture: null, instagram_business_account: { id: 'IG_B', name: 'IG B', username: 'igb', profile_picture_url: null } },
                    ],
                    paging: {}
                }
            });
            // 4. client_pages → 0
            axios.get.mockResolvedValueOnce({ data: { data: [], paging: {} } });

            await provider.listManagedAssets({ userToken: 'tok_log', includeBusinessPortfolio: true });

            // Parse all console.log calls and find the metaAssetsListed entry
            const parsed = consoleSpy.mock.calls
                .map(args => { try { return JSON.parse(args[0]); } catch { return null; } })
                .filter(Boolean);
            const entry = parsed.find(e => e.message === 'metaAssetsListed');
            expect(entry).toBeDefined();
            expect(entry).toMatchObject({
                source_me_accounts: 1,
                source_owned_pages: 2,
                source_client_pages: 0,
                portfolioAttempted: true,
                deduped: 2,   // PA appears in both; final unique count = 2
                withIG: 1,
            });

            consoleSpy.mockRestore();
        });

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
    });
});
