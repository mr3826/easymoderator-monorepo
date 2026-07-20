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
        const channel = { page_access_token_ct: 'page-token' };
        const decision = { allow: true };

        beforeEach(() => {
            axios.post.mockResolvedValue({ data: { message_id: 'mid_sent' } });
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
                { params: { access_token: 'page-token' } }
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
