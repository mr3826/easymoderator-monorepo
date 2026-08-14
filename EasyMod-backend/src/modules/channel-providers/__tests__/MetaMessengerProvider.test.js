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

    function debugTokenResponse(targetIds) {
        return {
            data: {
                data: {
                    granular_scopes: [
                        { scope: 'pages_messaging', target_ids: targetIds },
                        { scope: 'pages_manage_metadata', target_ids: targetIds },
                    ],
                },
            },
        };
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
        // MetaMessengerProvider.sendMessage (write side) and rateLimit.rule
        // (read side) — patched here with a tiny in-memory ZSET so the test
        // proves both sides actually agree on key format, not just that each
        // mock was called with *something*.
        const { cacheRedis } = require('src/config/redis');
        const rateLimitRule = require('src/modules/policy/rules/rateLimit.rule');
        let zsets;

        beforeEach(() => {
            zsets = new Map(); // key -> Map(member -> score)
            axios.post.mockResolvedValue({ data: { message_id: 'mid_rl' } });
            cacheRedis.zadd = jest.fn(async (key, score, member) => {
                if (!zsets.has(key)) zsets.set(key, new Map());
                zsets.get(key).set(member, score);
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

        test('a burst past META_SEND_LIMIT is rejected by rateLimit.rule', async () => {
            const channel = { id: 'c-rl2', page_access_token_ct: 'tok', meta_asset_id: 'PAGE_RL2' };
            for (let i = 0; i < rateLimitRule.META_SEND_LIMIT; i++) {
                await provider.sendMessage({
                    channel,
                    recipientId: 'PSID_RL2',
                    normalizedMessage: { text: `msg ${i}`, attachments: [] },
                    decision: { allow: true },
                });
            }
            // The rule's own read-side peek must now see the limit as reached.
            const result = await rateLimitRule.evaluate({}, { channel });
            expect(result.allow).toBe(false);
            expect(result.reason).toBe('RATE_LIMIT');
        });

        test('does not fail the send when Redis is unavailable', async () => {
            cacheRedis.zadd = jest.fn().mockRejectedValue(new Error('redis down'));
            const channel = { id: 'c-rl3', page_access_token_ct: 'tok', meta_asset_id: 'PAGE_RL3' };
            const result = await provider.sendMessage({
                channel,
                recipientId: 'PSID_RL3',
                normalizedMessage: { text: 'still sends', attachments: [] },
                decision: { allow: true },
            });
            expect(result.providerMessageId).toBe('mid_rl');
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
            }).mockResolvedValueOnce(debugTokenResponse(['P1', 'P2']));
            // NO /me/businesses mock — default flow must not call it.

            const result = await provider.listManagedAssets({ userToken: 'tok_abc' });

            expect(result).toHaveLength(2);
            // Facebook-only launch: the provider no longer exposes a linked IG
            // account, even when /me/accounts includes instagram_business_account.
            expect(result[0]).toMatchObject({ id: 'P1', name: 'Page 1', pictureUrl: 'http://img/1' });
            expect(result[0]).not.toHaveProperty('instagramAccount');
            expect(result[1]).toMatchObject({ id: 'P2', name: 'Page 2' });
            expect(result[1]).not.toHaveProperty('instagramAccount');
            // Only /me/accounts is hit by default now.
            expect(axios.get).toHaveBeenCalledTimes(2);
            expect(axios.get).toHaveBeenCalledWith(
                expect.stringContaining('/me/accounts'),
                expect.objectContaining({ params: expect.objectContaining({ limit: 100 }) })
            );
            expect(axios.get).toHaveBeenCalledWith(
                expect.stringContaining('/debug_token'),
                expect.objectContaining({ params: expect.objectContaining({ input_token: 'tok_abc' }) })
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
            }).mockResolvedValueOnce(debugTokenResponse(['P1', 'P2']));
            // No /me/businesses mock — default flow does not call it

            const result = await provider.listManagedAssets({ userToken: 'tok_xyz' });

            expect(result).toHaveLength(2);
            expect(result.map(p => p.id)).toEqual(['P1', 'P2']);
            // 2 pages of me/accounts plus token introspection (no businesses call)
            expect(axios.get).toHaveBeenCalledTimes(3);
            // Second call (cursor follow) uses the `next` URL directly (no extra params)
            expect(axios.get).toHaveBeenNthCalledWith(
                2,
                'https://graph.facebook.com/v22.0/me/accounts?after=CURSOR',
                { params: {} }
            );
            expect(axios.get).toHaveBeenNthCalledWith(
                3,
                expect.stringContaining('/debug_token'),
                expect.objectContaining({ params: expect.objectContaining({ input_token: 'tok_xyz' }) })
            );
        });

        test('filters out pages not selected in Meta granular permissions', async () => {
            axios.get.mockResolvedValueOnce({
                data: {
                    data: [
                        { id: 'P1', name: 'Selected Page', category: null, picture: null },
                        { id: 'P2', name: 'Unselected Page', category: null, picture: null },
                    ],
                    paging: {},
                },
            }).mockResolvedValueOnce(debugTokenResponse(['P1']));

            const result = await provider.listManagedAssets({ userToken: 'tok_selected' });

            expect(result.map((page) => page.id)).toEqual(['P1']);
        });

        test('returns no connectable pages when granular target ids are missing', async () => {
            axios.get.mockResolvedValueOnce({
                data: {
                    data: [
                        { id: 'P1', name: 'Page 1', category: null, picture: null },
                        { id: 'P2', name: 'Page 2', category: null, picture: null },
                    ],
                    paging: {},
                },
            }).mockResolvedValueOnce({
                data: { data: { granular_scopes: [{ scope: 'pages_messaging' }] } },
            });

            const result = await provider.listManagedAssets({ userToken: 'tok_no_targets' });

            expect(result).toEqual([]);
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
            axios.get.mockResolvedValueOnce({
                data: {
                    data: [{ id: 'P1', name: 'Page 1', category: null, picture: null }],
                    paging: {},
                },
            }).mockResolvedValueOnce(debugTokenResponse(['P1']));

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

            axios.get.mockResolvedValueOnce({
                data: { data: [{ id: 'PA', name: 'A', category: null, picture: null }], paging: {} },
            }).mockResolvedValueOnce(debugTokenResponse(['PA']));

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
                selected_target_ids: 1,
                filtered_unselected_pages: 0,
                deduped: 1,
            });
            expect(entry).not.toHaveProperty('withIG');

            consoleSpy.mockRestore();
        });
    });
});
