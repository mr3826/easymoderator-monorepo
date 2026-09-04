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
const mockRecoverInvalidToken = jest.fn();

jest.mock('../meta-authorization-recovery.service', () => ({
    recoverInvalidToken: mockRecoverInvalidToken,
}));

const MetaMessengerProvider = require('../providers/MetaMessengerProvider');
const ChannelProvider = require('../ChannelProvider');

jest.mock('axios');

describe('MetaMessengerProvider', () => {
    let provider;

    beforeEach(() => {
        process.env.META_APP_SECRET = 'test-webhook-secret';
        provider = new MetaMessengerProvider();
    });

    test('extends ChannelProvider', () => {
        expect(provider).toBeInstanceOf(ChannelProvider);
    });

    test('platform getter returns "facebook"', () => {
        expect(provider.platform).toBe('facebook');
    });

    describe('getAssetAccessToken()', () => {
        afterEach(() => jest.resetAllMocks());

        test('rejects when Meta omits the Page access token', async () => {
            axios.get.mockResolvedValueOnce({ data: {} });

            await expect(provider.getAssetAccessToken({
                assetId: 'PAGE_1',
                userToken: 'user-token',
            })).rejects.toMatchObject({
                status: 502,
                code: 'META_PAGE_ACCESS_TOKEN_MISSING',
            });
        });

        test('returns a non-empty Page access token', async () => {
            axios.get.mockResolvedValueOnce({ data: { access_token: 'page-token' } });

            await expect(provider.getAssetAccessToken({
                assetId: 'PAGE_1',
                userToken: 'user-token',
            })).resolves.toEqual({ token: 'page-token', expiresAt: null });
        });
    });

    function debugTokenResponse(targetIds, manageTargetIds = targetIds, showListTargetIds = targetIds) {
        return {
            data: {
                data: {
                    granular_scopes: [
                        { scope: 'pages_messaging', target_ids: targetIds },
                        { scope: 'pages_manage_metadata', target_ids: manageTargetIds },
                        { scope: 'pages_show_list', target_ids: showListTargetIds },
                    ],
                },
            },
        };
    }

    function page(id, overrides = {}) {
        return {
            id,
            name: `Page ${id}`,
            category: null,
            picture: null,
            tasks: ['MESSAGING', 'MANAGE'],
            access_token: `page-token-${id}`,
            ...overrides,
        };
    }

    /**
     * Configure all Graph responses by URL rather than by call order. This
     * keeps the tests honest when discovery adds hydration or pagination calls.
     */
    function configureGraph({ accountPages = [{ data: [], paging: {} }], targetIds = [], debug, hydration = {} }) {
        const normalizedAccountPages = accountPages.map((response) => ({
            ...response,
            data: {
                ...(response.data || {}),
                data: Array.isArray(response.data?.data)
                    ? response.data.data.map((asset) => asset && asset.id !== undefined
                        && !Object.prototype.hasOwnProperty.call(asset, 'access_token')
                        ? { ...asset, access_token: `page-token-${asset.id}` }
                        : asset)
                    : response.data?.data,
            },
        }));
        const pageByCursor = new Map();
        normalizedAccountPages.forEach((response, index) => {
            if (index === 0) return;
            const cursor = normalizedAccountPages[index - 1].data?.paging?.cursors?.after;
            if (cursor !== undefined && cursor !== null && String(cursor).length > 0) {
                pageByCursor.set(String(cursor), response);
            }
        });

        axios.get.mockImplementation((url, request = {}) => {
            const requestUrl = String(url);
            if (requestUrl.includes('/debug_token')) {
                return Promise.resolve(debug || debugTokenResponse(targetIds));
            }
            if (requestUrl.includes('/me/accounts')) {
                const after = request.params?.after;
                return Promise.resolve(
                    after === undefined || after === null
                        ? normalizedAccountPages[0]
                        : pageByCursor.get(String(after)) || { data: { data: [], paging: {} } },
                );
            }
            const pageId = decodeURIComponent(requestUrl.slice(requestUrl.lastIndexOf('/') + 1));
            const hydrationResult = hydration[pageId];
            if (hydrationResult?.error) return Promise.reject(hydrationResult.error);
            return Promise.resolve({ data: hydrationResult || page(pageId) });
        });
    }

    describe('buildAuthUrl() default scopes (App Review surface)', () => {
        test('requests exactly the Messenger-only Facebook scopes when none are passed', async () => {
            const url = await provider.buildAuthUrl({ state: 'facebook:s:u:n', scopes: [] });
            const scope = new URL(url).searchParams.get('scope') || '';
            expect(scope.split(',').sort()).toEqual([
                'pages_manage_metadata',
                'pages_messaging',
                'pages_show_list',
            ]);
        });

        test('never requests Instagram or business_management scopes', async () => {
            const url = await provider.buildAuthUrl({ state: 'facebook:s:u:n', scopes: [] });
            const scope = new URL(url).searchParams.get('scope') || '';
            expect(scope).not.toMatch(/instagram_/);
            expect(scope).not.toContain('business_management');
        });

        test('ignores forbidden caller-supplied scopes and preserves the exact allowlist', async () => {
            const url = await provider.buildAuthUrl({
                state: 'facebook:s:u:n',
                scopes: [
                    'business_management',
                    'instagram_basic',
                    'instagram_manage_messages',
                    'pages_read_engagement',
                ],
            });
            const scope = new URL(url).searchParams.get('scope') || '';

            expect(scope.split(',').sort()).toEqual([
                'pages_manage_metadata',
                'pages_messaging',
                'pages_show_list',
            ]);
            expect(scope).not.toContain('business_management');
            expect(scope).not.toMatch(/instagram_/);
        });
    });

    describe('webhookFields()', () => {
        test('includes only Messenger messages', () => {
            const fields = provider.webhookFields();
            expect(fields).toEqual(['messages']);
            expect(fields).not.toContain('messaging_postbacks');
            expect(fields).not.toContain('messaging_optins');
            expect(fields).not.toContain('message_deliveries');
            expect(fields).not.toContain('message_reads');
            expect(fields).not.toContain('feed');
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

        test('ignores comment events from feed changes', () => {
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
            expect(events).toEqual([]);
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

    describe('sendMessage()', () => {
        const channel = { id: 'channel-1', page_access_token_ct: 'page-token' };
        const decision = { allow: true };

        beforeEach(() => {
            axios.post.mockResolvedValue({ data: { message_id: 'mid_sent' } });
            mockRecoverInvalidToken.mockResolvedValue(undefined);
        });

        afterEach(() => {
            jest.resetAllMocks();
        });

        test('sends image attachment through Messenger Send API', async () => {
            const result = await provider.sendMessage({
                channel,
                recipientId: 'PSID_1',
                normalizedMessage: {
                    text: '',
                    attachments: [{ type: 'image', url: 'https://cdn.example.com/photo.jpg' }],
                },
                decision,
            });

            expect(result.providerMessageId).toBe('mid_sent');
            expect(axios.post).toHaveBeenCalledWith(
                expect.stringContaining('/me/messages'),
                expect.objectContaining({
                    recipient: { id: 'PSID_1' },
                    messaging_type: 'RESPONSE',
                    message: {
                        attachment: {
                            type: 'image',
                            payload: {
                                url: 'https://cdn.example.com/photo.jpg',
                                is_reusable: true,
                            },
                        },
                    },
                }),
                { params: { access_token: 'page-token', appsecret_proof: expect.any(String) } }
            );
        });

        test('sends text then file when both are present', async () => {
            axios.post
                .mockResolvedValueOnce({ data: { message_id: 'mid_text' } })
                .mockResolvedValueOnce({ data: { message_id: 'mid_file' } });

            const result = await provider.sendMessage({
                channel,
                recipientId: 'PSID_2',
                normalizedMessage: {
                    text: 'Invoice attached',
                    attachments: [{ type: 'file', url: 'https://cdn.example.com/invoice.pdf' }],
                },
                decision,
            });

            expect(result.providerMessageIds).toEqual(['mid_text', 'mid_file']);
            expect(axios.post).toHaveBeenCalledTimes(2);
            expect(axios.post.mock.calls[0][1].message).toEqual({ text: 'Invoice attached' });
            expect(axios.post.mock.calls[1][1].message.attachment).toMatchObject({
                type: 'file',
                payload: { url: 'https://cdn.example.com/invoice.pdf', is_reusable: true },
            });
        });

        test.each([102, 190])(
            'marks Meta error %s permanent only after durable recovery succeeds',
            async (metaCode) => {
                axios.post.mockRejectedValue({
                    response: {
                        status: 401,
                        data: { error: { code: metaCode, message: 'Invalid access token' } },
                    },
                });

                await expect(provider.sendMessage({
                    channel,
                    recipientId: 'PSID_3',
                    normalizedMessage: { text: 'test', attachments: [] },
                    decision,
                })).rejects.toMatchObject({
                    code: 'META_AUTHORIZATION_REQUIRED',
                    status: 401,
                });
                expect(mockRecoverInvalidToken).toHaveBeenCalledWith(
                    channel,
                    expect.objectContaining({ metaCode }),
                );
            },
        );

        test('keeps invalid-token delivery retryable when durable recovery fails', async () => {
            axios.post.mockRejectedValue({
                response: {
                    status: 401,
                    data: { error: { code: 190, message: 'Invalid access token' } },
                },
            });
            mockRecoverInvalidToken.mockRejectedValue(new Error('database unavailable'));

            await expect(provider.sendMessage({
                channel,
                recipientId: 'PSID_4',
                normalizedMessage: { text: 'test', attachments: [] },
                decision,
            })).rejects.toMatchObject({
                code: 'META_AUTHORIZATION_RECOVERY_FAILED',
                status: 503,
                details: expect.objectContaining({ recoveryPending: true }),
            });
        });
    });

    describe('sendMessage() rate-limit + message_tag wiring', () => {
        // The real (memory-fallback in test env) cacheRedis singleton, shared by
        // MetaMessengerProvider.sendMessage (via rateLimit.rule's reserveSendSlot/
        // releaseSendSlot) and rateLimit.rule's own evaluate() peek — patched here
        // with a tiny in-memory ZSET plus an eval() that reproduces the Lua
        // script's atomic prune+count+conditional-add, so the test proves both
        // sides actually agree on key format and the real reserve/release control
        // flow, not just that each mock was called with *something*.
        const { cacheRedis } = require('src/config/redis');
        const rateLimitRule = require('src/modules/policy/rules/rateLimit.rule');
        let zsets;

        beforeEach(() => {
            zsets = new Map(); // key -> Map(member -> score)
            axios.post.mockResolvedValue({ data: { message_id: 'mid_rl' } });
            cacheRedis.eval = jest.fn(async (_script, _numKeys, key, now, windowMs, limit, member) => {
                if (!zsets.has(key)) zsets.set(key, new Map());
                const m = zsets.get(key);
                for (const [mem, score] of [...m.entries()]) {
                    if (score < Number(now) - Number(windowMs)) m.delete(mem);
                }
                if (m.size < Number(limit)) {
                    m.set(member, Number(now));
                    return 1;
                }
                return 0;
            });
            cacheRedis.zrem = jest.fn(async (key, member) => {
                zsets.get(key)?.delete(member);
                return 1;
            });
            cacheRedis.zcard = jest.fn(async (key) => zsets.get(key)?.size || 0);
            cacheRedis.zremrangebyscore = jest.fn(async (key, _min, max) => {
                const m = zsets.get(key);
                if (!m) return 0;
                let removed = 0;
                for (const [member, score] of [...m.entries()]) {
                    if (score <= Number(max)) { m.delete(member); removed++; }
                }
                return removed;
            });
            cacheRedis.zrange = jest.fn(async (key) => {
                const m = zsets.get(key);
                if (!m || m.size === 0) return [];
                const [member, score] = [...m.entries()].sort((a, b) => a[1] - b[1])[0];
                return [member, String(score)];
            });
        });

        afterEach(() => {
            jest.resetAllMocks();
        });

        test('a successful send adds one entry to the rate-limit ZSET', async () => {
            const channel = { id: 'c-rl', page_access_token_ct: 'tok', meta_asset_id: 'PAGE_RL1' };
            await provider.sendMessage({
                channel,
                recipientId: 'PSID_RL',
                normalizedMessage: { text: 'hi', attachments: [] },
                decision: { allow: true },
            });
            expect(await cacheRedis.zcard(rateLimitRule.keyFor('PAGE_RL1'))).toBe(1);
        });

        test('a text+attachment message reserves two separate slots, one per real Graph API call', async () => {
            const channel = { id: 'c-rl-multi', page_access_token_ct: 'tok', meta_asset_id: 'PAGE_RL_MULTI' };
            axios.post
                .mockResolvedValueOnce({ data: { message_id: 'mid_text' } })
                .mockResolvedValueOnce({ data: { message_id: 'mid_file' } });

            await provider.sendMessage({
                channel,
                recipientId: 'PSID_RL_MULTI',
                normalizedMessage: {
                    text: 'Invoice attached',
                    attachments: [{ type: 'file', url: 'https://cdn.example.com/invoice.pdf' }],
                },
                decision: { allow: true },
            });

            expect(axios.post).toHaveBeenCalledTimes(2);
            expect(await cacheRedis.zcard(rateLimitRule.keyFor('PAGE_RL_MULTI'))).toBe(2);
        });

        test('a burst past META_SEND_LIMIT is rejected mid-send with retryAfterMs', async () => {
            const channel = { id: 'c-rl2', page_access_token_ct: 'tok', meta_asset_id: 'PAGE_RL2' };
            for (let i = 0; i < rateLimitRule.META_SEND_LIMIT; i++) {
                await provider.sendMessage({
                    channel,
                    recipientId: 'PSID_RL2',
                    normalizedMessage: { text: `msg ${i}`, attachments: [] },
                    decision: { allow: true },
                });
            }
            // The next real send is denied at the atomic reservation itself —
            // not just at the read-side peek — proving the gate that matters is
            // the one immediately guarding the Graph API call.
            await expect(provider.sendMessage({
                channel,
                recipientId: 'PSID_RL2',
                normalizedMessage: { text: 'one too many', attachments: [] },
                decision: { allow: true },
            })).rejects.toMatchObject({ code: 'META_RATE_LIMIT', retryAfterMs: expect.any(Number) });
            expect(axios.post).toHaveBeenCalledTimes(rateLimitRule.META_SEND_LIMIT);

            const result = await rateLimitRule.evaluate({}, { channel });
            expect(result.allow).toBe(false);
            expect(result.reason).toBe('RATE_LIMIT');
        });

        test('releases the reservation and bubbles the original error when the Graph API call fails', async () => {
            const channel = { id: 'c-rl-fail', page_access_token_ct: 'tok', meta_asset_id: 'PAGE_RL_FAIL' };
            axios.post.mockRejectedValueOnce({ response: { status: 500, data: {} } });

            await expect(provider.sendMessage({
                channel,
                recipientId: 'PSID_RL_FAIL',
                normalizedMessage: { text: 'will fail', attachments: [] },
                decision: { allow: true },
            })).rejects.toMatchObject({ code: 'META_API_ERROR' });

            // The failed send's reservation was released, so a fresh send has
            // the full quota available rather than one slot already burned.
            expect(await cacheRedis.zcard(rateLimitRule.keyFor('PAGE_RL_FAIL'))).toBe(0);
        });

        test('fails closed (does not send) when the rate-limit reservation is unavailable', async () => {
            cacheRedis.eval = jest.fn().mockRejectedValue(new Error('redis down'));
            const channel = { id: 'c-rl3', page_access_token_ct: 'tok', meta_asset_id: 'PAGE_RL3' };
            await expect(provider.sendMessage({
                channel,
                recipientId: 'PSID_RL3',
                normalizedMessage: { text: 'must not send', attachments: [] },
                decision: { allow: true },
            })).rejects.toMatchObject({ code: 'META_RATE_LIMIT' });
            expect(axios.post).not.toHaveBeenCalled();
        });

        test('includes messaging_type MESSAGE_TAG and tag when decision carries an out-of-window message_tag', async () => {
            const channel = { id: 'c-tag', page_access_token_ct: 'tok', meta_asset_id: 'PAGE_TAG' };
            await provider.sendMessage({
                channel,
                recipientId: 'PSID_TAG',
                normalizedMessage: { text: 'order shipped', attachments: [] },
                decision: { allow: true, augment: { message_tag: 'POST_PURCHASE_UPDATE' } },
            });
            expect(axios.post).toHaveBeenCalledWith(
                expect.stringContaining('/me/messages'),
                expect.objectContaining({ messaging_type: 'MESSAGE_TAG', tag: 'POST_PURCHASE_UPDATE' }),
                expect.anything(),
            );
        });

        test('in-window send (no augment) is unaffected: RESPONSE type, no tag field', async () => {
            const channel = { id: 'c-notag', page_access_token_ct: 'tok', meta_asset_id: 'PAGE_NOTAG' };
            await provider.sendMessage({
                channel,
                recipientId: 'PSID_NOTAG',
                normalizedMessage: { text: 'hello', attachments: [] },
                decision: { allow: true },
            });
            const [, body] = axios.post.mock.calls[0];
            expect(body.messaging_type).toBe('RESPONSE');
            expect(body).not.toHaveProperty('tag');
        });
    });

    describe('listManagedAssets() discovery and pagination', () => {
        beforeEach(() => {
            process.env.META_APP_SECRET = 'test-secret';
            process.env.META_APP_ID = 'test-app-id';
        });

        afterEach(() => {
            jest.resetAllMocks();
        });

        test('returns all granted Pages from /me/accounts and omits legacy Instagram data', async () => {
            configureGraph({
                accountPages: [{
                    data: {
                        data: [
                            page('P1', { name: 'Page 1', category: 'Shopping', picture: { data: { url: 'http://img/1' } } }),
                            page('P2', { name: 'Page 2', instagram_business_account: { id: 'IG2' } }),
                        ],
                        paging: {},
                    },
                }],
                targetIds: ['P1', 'P2'],
            });
            const result = await provider.listManagedAssets({ userToken: 'tok_abc' });

            expect(result).toHaveLength(2);
            expect(result[0]).toMatchObject({ id: 'P1', name: 'Page 1', pictureUrl: 'http://img/1' });
            expect(result[0]).not.toHaveProperty('instagramAccount');
            expect(result[1]).toMatchObject({ id: 'P2', name: 'Page 2' });
            expect(result[1]).not.toHaveProperty('instagramAccount');
            expect(axios.get).toHaveBeenCalledTimes(2);
            expect(axios.get).toHaveBeenCalledWith(
                expect.stringContaining('/me/accounts'),
                expect.objectContaining({ params: expect.objectContaining({ limit: 100 }) })
            );
            expect(axios.get).toHaveBeenCalledWith(
                expect.stringContaining('/debug_token'),
                expect.objectContaining({ params: expect.objectContaining({ input_token: 'tok_abc' }) })
            );
            const debugCall = axios.get.mock.calls.find(([url]) => String(url).includes('/debug_token'));
            expect(debugCall[1].params.appsecret_proof).toBe(
                crypto.createHmac('sha256', 'test-secret').update('test-app-id|test-secret').digest('hex'),
            );
        });

        test('recovers a granted Business Portfolio Page omitted by /me/accounts', async () => {
            configureGraph({
                accountPages: [{ data: { data: [page('P1')], paging: {} } }],
                targetIds: ['P1', 'P_PORTFOLIO'],
                hydration: {
                    P_PORTFOLIO: page('P_PORTFOLIO', {
                        name: 'Business Portfolio Page',
                        access_token: 'hydrated-page-token',
                    }),
                },
            });

            const result = await provider.listManagedAssets({ userToken: 'tok_xyz' });

            expect(result.map((asset) => asset.id)).toEqual(['P1', 'P_PORTFOLIO']);
            expect(result.find((asset) => asset.id === 'P_PORTFOLIO')).toMatchObject({
                name: 'Business Portfolio Page',
                connectable: true,
            });
            expect(result.find((asset) => asset.id === 'P_PORTFOLIO')).not.toHaveProperty('source');
            const hydrationCall = axios.get.mock.calls.find(([url]) => String(url).endsWith('/P_PORTFOLIO'));
            expect(hydrationCall).toBeDefined();
            expect(hydrationCall[1].params).toEqual(expect.objectContaining({
                fields: 'id,name,category,picture{data{url}},tasks,access_token',
                access_token: 'tok_xyz',
                appsecret_proof: expect.any(String),
            }));
        });

        test('recovers a granted Page when /me/accounts is empty', async () => {
            configureGraph({
                accountPages: [{ data: { data: [], paging: {} } }],
                targetIds: ['P_EMPTY'],
                hydration: { P_EMPTY: page('P_EMPTY', { name: 'Empty Edge Page' }) },
            });

            const result = await provider.listManagedAssets({ userToken: 'tok_empty' });

            expect(result.map((asset) => asset.id)).toEqual(['P_EMPTY']);
            expect(result[0]).toMatchObject({ name: 'Empty Edge Page', connectable: true });
        });

        test.each([
            ['missing', undefined],
            ['null', null],
            ['blank', '  '],
        ])('hydrates a /me/accounts row with %s access_token before offering it', async (_label, accessToken) => {
            configureGraph({
                accountPages: [{ data: { data: [page('P_TOKEN', { access_token: accessToken })], paging: {} } }],
                targetIds: ['P_TOKEN'],
                hydration: { P_TOKEN: page('P_TOKEN', { access_token: 'hydrated-token' }) },
            });

            const result = await provider.listManagedAssets({ userToken: `tok_${_label}` });

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('P_TOKEN');
            expect(axios.get.mock.calls.filter(([url]) => String(url).endsWith('/P_TOKEN'))).toHaveLength(1);
        });

        test('excludes a matching hydration response without a Page token and counts it', async () => {
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
            try {
                configureGraph({
                    accountPages: [{ data: { data: [], paging: {} } }],
                    targetIds: ['P_NO_TOKEN'],
                    hydration: { P_NO_TOKEN: page('P_NO_TOKEN', { access_token: null }) },
                });

                await expect(provider.listManagedAssets({ userToken: 'tok_no_page_token' })).resolves.toEqual([]);

                const parsed = consoleSpy.mock.calls
                    .map(args => { try { return JSON.parse(args[0]); } catch { return null; } })
                    .filter(Boolean);
                const entry = parsed.find((candidate) => candidate.message === 'metaAssetsListed');
                expect(entry).toMatchObject({
                    hydration_attempted: 1,
                    hydration_succeeded: 0,
                    hydration_failed: 0,
                    hydration_rejected: 1,
                    deduped: 0,
                });
            } finally {
                consoleSpy.mockRestore();
            }
        });

        test('excludes an unauthorized hydration target without aborting the rest of the listing', async () => {
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
            try {
                configureGraph({
                    accountPages: [{ data: { data: [page('P_OK')], paging: {} } }],
                    targetIds: ['P_OK', 'P_DENIED'],
                    hydration: {
                        P_DENIED: {
                            error: {
                                response: {
                                    status: 403,
                                    data: { error: { code: 10, error_subcode: 200, message: 'Permission denied' } },
                                },
                            },
                        },
                    },
                });

                const result = await provider.listManagedAssets({ userToken: 'tok_denied' });

                expect(result.map((asset) => asset.id)).toEqual(['P_OK']);
                const output = consoleSpy.mock.calls.flat().join(' ');
                const proof = crypto.createHmac('sha256', 'test-secret').update('tok_denied').digest('hex');
                expect(output).not.toContain('tok_denied');
                expect(output).not.toContain(proof);
                expect(output).toContain('"hydration_failed":1');
            } finally {
                consoleSpy.mockRestore();
            }
        });

        test('merges selected Pages from both sources exactly once', async () => {
            configureGraph({
                accountPages: [{ data: { data: [page('P_A')], paging: {} } }],
                targetIds: ['P_A', 'P_B'],
                hydration: { P_B: page('P_B', { name: 'Page B from target ID' }) },
            });

            const result = await provider.listManagedAssets({ userToken: 'tok_union' });

            expect(result.map((asset) => asset.id)).toEqual(['P_A', 'P_B']);
            expect(new Set(result.map((asset) => asset.id)).size).toBe(2);
        });

        test('never shows an unselected Page present in /me/accounts', async () => {
            configureGraph({
                accountPages: [{ data: { data: [page('P_SELECTED'), page('P_UNSELECTED')], paging: {} } }],
                targetIds: ['P_SELECTED'],
            });

            const result = await provider.listManagedAssets({ userToken: 'tok_selected' });

            expect(result.map((asset) => asset.id)).toEqual(['P_SELECTED']);
        });

        test('uses pages_messaging as the grant boundary and keeps valid tasks around invalid values', async () => {
            configureGraph({
                accountPages: [{
                    data: {
                        data: [
                            page('P_SCOPE', { tasks: ['MESSAGING'] }),
                            page('P_TASKS', { tasks: [' messaging ', 'MANAGE', 'MANAGE!'] }),
                            page('P_INELIGIBLE', { tasks: ['CREATE_CONTENT'] }),
                        ],
                        paging: {},
                    },
                }],
                targetIds: ['P_SCOPE', 'P_TASKS', 'P_INELIGIBLE'],
                debug: debugTokenResponse(['P_SCOPE', 'P_TASKS', 'P_INELIGIBLE'], []),
            });

            const result = await provider.listManagedAssets({ userToken: 'tok_tasks' });

            expect(result).toHaveLength(3);
            expect(result.find((asset) => asset.id === 'P_SCOPE')).toMatchObject({
                tasks: ['MESSAGING'],
                connectable: false,
                reason: 'META_PAGE_TASKS_REQUIRED',
            });
            expect(result.find((asset) => asset.id === 'P_TASKS')).toMatchObject({
                tasks: ['MESSAGING', 'MANAGE'],
                connectable: true,
            });
            expect(result.find((asset) => asset.id === 'P_INELIGIBLE')).toMatchObject({
                tasks: ['CREATE_CONTENT'],
                connectable: false,
                reason: 'META_PAGE_TASKS_REQUIRED',
            });
        });

        test('preserves appsecret_proof and follows cursors even across an empty batch', async () => {
            const userToken = 'tok_cursor';
            configureGraph({
                accountPages: [
                    {
                        data: { data: [page('P1')], paging: {
                            next: 'https://graph.facebook.com/v22.0/me/accounts?access_token=tok_cursor&after=CURSOR',
                            cursors: { after: 'CURSOR' },
                        } },
                    },
                    {
                        data: { data: [], paging: {
                            next: 'https://graph.facebook.com/v22.0/me/accounts?access_token=tok_cursor&after=FINAL',
                            cursors: { after: 'FINAL' },
                        } },
                    },
                    { data: { data: [page('P2')], paging: {} } },
                ],
                targetIds: ['P1', 'P2'],
            });

            const result = await provider.listManagedAssets({ userToken });

            expect(result.map((asset) => asset.id)).toEqual(['P1', 'P2']);
            const accountCalls = axios.get.mock.calls.filter(([url]) => String(url).includes('/me/accounts'));
            expect(accountCalls).toHaveLength(3);
            expect(accountCalls[1][0]).toBe('https://graph.facebook.com/v22.0/me/accounts');
            expect(accountCalls[1][1].params).toEqual(expect.objectContaining({
                fields: 'id,name,category,access_token,picture{data{url}},tasks',
                access_token: userToken,
                appsecret_proof: expect.any(String),
                after: 'CURSOR',
            }));
            expect(accountCalls[2][1].params.after).toBe('FINAL');
            const proof = crypto.createHmac('sha256', 'test-secret').update(userToken).digest('hex');
            for (const [url, request] of accountCalls) {
                expect(String(url)).not.toContain(userToken);
                expect(request.params.appsecret_proof).toBe(proof);
            }
        });

        test('returns no Pages when Meta provides no pages_messaging target IDs', async () => {
            configureGraph({
                accountPages: [{ data: { data: [page('P1'), page('P2')], paging: {} } }],
                debug: { data: { data: { granular_scopes: [{ scope: 'pages_messaging' }] } } },
            });

            const result = await provider.listManagedAssets({ userToken: 'tok_no_targets' });

            expect(result).toEqual([]);
        });

        test('does not expose Page access tokens or source metadata in the response', async () => {
            configureGraph({
                accountPages: [{ data: { data: [page('P_SECRET', { access_token: 'page-secret-must-not-leak' })], paging: {} } }],
                targetIds: ['P_SECRET'],
            });

            const result = await provider.listManagedAssets({ userToken: 'tok_secret' });

            expect(result[0]).not.toHaveProperty('access_token');
            expect(result[0]).not.toHaveProperty('source');
            expect(JSON.stringify(result)).not.toContain('page-secret-must-not-leak');
        });

        test('redacts user tokens and proofs from Graph error logs', async () => {
            const userToken = 'tok_error_log';
            const proof = crypto.createHmac('sha256', 'test-secret').update(userToken).digest('hex');
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
            try {
                axios.get.mockImplementation((url) => {
                    if (String(url).includes('/debug_token')) {
                        return Promise.resolve(debugTokenResponse(['P_ERROR']));
                    }
                    return Promise.reject({
                        message: `request failed ${userToken} ${proof}`,
                        config: { params: { access_token: userToken, appsecret_proof: proof } },
                    });
                });

                await expect(provider.listManagedAssets({ userToken })).rejects.toMatchObject({
                    code: 'META_API_ERROR',
                });

                const output = consoleSpy.mock.calls.flat().join(' ');
                expect(output).not.toContain(userToken);
                expect(output).not.toContain(proof);
            } finally {
                consoleSpy.mockRestore();
            }
        });
    });

    describe('getOAuthIdentity() pagination', () => {
        beforeEach(() => {
            process.env.META_APP_SECRET = 'test-secret';
        });

        afterEach(() => {
            jest.resetAllMocks();
        });

        test('follows ids_for_pages cursors after an empty batch and signs every request', async () => {
            const userToken = 'tok_identity';
            const idsUrl = 'https://graph.facebook.com/v22.0/app-user-1/ids_for_pages';
            axios.get.mockImplementation((url, request = {}) => {
                if (String(url).endsWith('/me')) return Promise.resolve({ data: { id: 'app-user-1' } });
                if (String(url) === idsUrl && request.params?.after === 'CURSOR') {
                    return Promise.resolve({
                        data: {
                            data: [{ id: 'psid-1', page: { id: 'P1' } }],
                            paging: {},
                        },
                    });
                }
                if (String(url) === idsUrl) {
                    return Promise.resolve({
                        data: {
                            data: [],
                            paging: {
                                next: `${idsUrl}?access_token=${userToken}&after=CURSOR`,
                                cursors: { after: 'CURSOR' },
                            },
                        },
                    });
                }
                throw new Error(`unexpected Graph URL: ${url}`);
            });

            await expect(provider.getOAuthIdentity({ userToken })).resolves.toEqual({
                appScopedUserId: 'app-user-1',
                pageScopedIdentities: [{ pageId: 'P1', pageScopedUserId: 'psid-1' }],
            });

            const idsCalls = axios.get.mock.calls.filter(([url]) => String(url).includes('/ids_for_pages'));
            expect(idsCalls).toHaveLength(2);
            expect(idsCalls[1][0]).toBe(idsUrl);
            expect(idsCalls[1][1].params).toEqual(expect.objectContaining({
                fields: 'id,page',
                limit: 100,
                access_token: userToken,
                appsecret_proof: expect.any(String),
                after: 'CURSOR',
            }));
            expect(String(idsCalls[1][0])).not.toContain(userToken);
        });
    });

    describe('subscribeWebhook()', () => {
        beforeEach(() => { process.env.META_APP_SECRET = 'test-secret'; });
        afterEach(() => jest.resetAllMocks());

        // If the App Dashboard has "Require App Secret Proof" on and this call
        // omits the proof, Meta rejects it and the reviewer's Page connects
        // without a live webhook — the demo then shows no inbound message.
        test('subscribes only `messages` and signs the call with appsecret_proof', async () => {
            axios.post.mockResolvedValueOnce({ data: { success: true } });
            await provider.subscribeWebhook({
                channel: { meta_asset_id: 'PAGE_1', page_access_token_ct: 'tok_page' },
            });
            expect(axios.post).toHaveBeenCalledWith(
                expect.stringContaining('/PAGE_1/subscribed_apps'),
                null,
                expect.objectContaining({
                    params: expect.objectContaining({
                        access_token: 'tok_page',
                        subscribed_fields: 'messages',
                        appsecret_proof: expect.any(String),
                    })
                })
            );
        });
    });

    describe('verifyWebhookSubscription()', () => {
        beforeEach(() => { process.env.META_APP_SECRET = 'test-secret'; });
        afterEach(() => jest.resetAllMocks());

        const channel = { meta_asset_id: 'PAGE_1', page_access_token_ct: 'tok_page' };

        test('returns ok:true when the page has all required subscriptions', async () => {
            axios.get.mockResolvedValueOnce({
                data: { data: [{ subscribed_fields: ['messages'] }] }
            });
            const res = await provider.verifyWebhookSubscription({ channel });
            expect(res.ok).toBe(true);
            expect(axios.get).toHaveBeenCalledWith(
                expect.stringContaining('/PAGE_1/subscribed_apps'),
                expect.objectContaining({
                    params: expect.objectContaining({
                        access_token: 'tok_page',
                        appsecret_proof: expect.any(String),
                    })
                })
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

    describe('listManagedAssets() Meta policy containment', () => {
        beforeEach(() => {
            process.env.META_APP_SECRET = 'test-secret';
            process.env.META_APP_ID = 'test-app-id';
        });

        afterEach(() => {
            jest.resetAllMocks();
        });

        test('ignores the legacy includeBusinessPortfolio flag and never queries /me/businesses', async () => {
            configureGraph({
                accountPages: [{ data: { data: [page('P1', { name: 'Page 1' })], paging: {} } }],
                targetIds: ['P1'],
            });

            const result = await provider.listManagedAssets({
                userToken: 'tok_default',
                includeBusinessPortfolio: true,
            });

            expect(result).toHaveLength(1);
            expect(axios.get).toHaveBeenCalledTimes(2);
            expect(axios.get).toHaveBeenCalledWith(
                expect.stringContaining('/me/accounts'),
                expect.anything(),
            );
            expect(axios.get).not.toHaveBeenCalledWith(
                expect.stringContaining('/me/businesses'),
                expect.anything(),
            );
        });

        test('diagnostic log reports Messenger-only discovery counts', async () => {
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
            try {
                configureGraph({
                    accountPages: [{ data: { data: [page('PA', { name: 'A' })], paging: {} } }],
                    targetIds: ['PA'],
                });

                await provider.listManagedAssets({ userToken: 'tok_log' });

                const parsed = consoleSpy.mock.calls
                    .map(args => { try { return JSON.parse(args[0]); } catch { return null; } })
                    .filter(Boolean);
                const entry = parsed.find(e => e.message === 'metaAssetsListed');
                expect(entry).toBeDefined();
                expect(entry).toMatchObject({
                    source_me_accounts: 1,
                    source_owned_pages: 0,
                    source_client_pages: 0,
                    portfolioAttempted: false,
                    portfolioError: null,
                    source_granular_target: 0,
                    selected_target_ids: 1,
                    filtered_unselected_pages: 0,
                    hydration_attempted: 0,
                    hydration_succeeded: 0,
                    hydration_failed: 0,
                    hydration_rejected: 0,
                    deduped: 1,
                });
                expect(entry).not.toHaveProperty('withIG');
            } finally {
                consoleSpy.mockRestore();
            }
        });
    });
});
