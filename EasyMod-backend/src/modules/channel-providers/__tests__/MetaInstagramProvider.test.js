/**
 * MetaInstagramProvider.test.js
 *
 * Same coverage as Messenger provider, focused on the IG-specific payload shape
 * and the IG webhook field list (no whatsapp).
 */

'use strict';

const crypto = require('crypto');
const axios = require('axios');
const MetaInstagramProvider = require('../providers/MetaInstagramProvider');
const ChannelProvider = require('../ChannelProvider');

jest.mock('axios');

describe('MetaInstagramProvider', () => {
    let provider;

    beforeEach(() => {
        process.env.META_WEBHOOK_APP_SECRET = 'ig-webhook-secret';
        process.env.META_APP_SECRET = 'ig-webhook-secret';
        provider = new MetaInstagramProvider();
    });

    test('extends ChannelProvider', () => {
        expect(provider).toBeInstanceOf(ChannelProvider);
    });

    test('platform getter returns "instagram"', () => {
        expect(provider.platform).toBe('instagram');
    });

    describe('webhookFields()', () => {
        test('uses only valid PAGE subscribed_fields (no IG-object fields)', () => {
            const fields = provider.webhookFields();
            expect(fields).toContain('messages');
            expect(fields).toContain('messaging_postbacks');
            // `comments`/`live_comments` are Instagram-OBJECT webhook fields and are
            // INVALID as page subscribed_fields — Meta rejects the whole subscribe
            // call ("... got 'comments'"). IG comment/message delivery comes via the
            // app-level `instagram` webhook object, not these page fields.
            expect(fields).not.toContain('comments');
            expect(fields).not.toContain('live_comments');
        });

        test('does NOT include whatsapp fields', () => {
            const fields = provider.webhookFields();
            expect(fields).not.toContain('message_template_status_update');
        });
    });

    describe('verifyWebhookSignature()', () => {
        const rawBody = Buffer.from('{"object":"instagram","entry":[]}');

        function sigFor(body, secret = 'ig-webhook-secret') {
            return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
        }

        test('valid signature passes', async () => {
            expect(await provider.verifyWebhookSignature({ rawBody, signature: sigFor(rawBody) })).toBe(true);
        });

        test('tampered body fails', async () => {
            expect(await provider.verifyWebhookSignature({
                rawBody: Buffer.from('{"object":"instagram","entry":["x"]}'),
                signature: sigFor(rawBody)
            })).toBe(false);
        });
    });

    describe('parseWebhookEnvelope()', () => {
        test('returns [] for non-instagram payloads', () => {
            expect(provider.parseWebhookEnvelope({ object: 'page', entry: [] })).toEqual([]);
        });

        test('extracts IG DM messages', () => {
            const events = provider.parseWebhookEnvelope({
                object: 'instagram',
                entry: [{
                    id: 'IG_123',
                    messaging: [{
                        sender: { id: 'IGSID_999' },
                        recipient: { id: 'IG_123' },
                        timestamp: 1700000000000,
                        message: { mid: 'ig_mid_xyz', text: 'Hi from IG' }
                    }]
                }]
            });
            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({
                externalId: 'ig_mid_xyz',
                senderExternalId: 'IGSID_999',
                pageOrAccountId: 'IG_123',
                text: 'Hi from IG',
                isEcho: false
            });
        });

        test('drops echo events', () => {
            const events = provider.parseWebhookEnvelope({
                object: 'instagram',
                entry: [{
                    id: 'IG_123',
                    messaging: [{
                        sender: { id: 'IG_123' },
                        recipient: { id: 'IGSID_999' },
                        timestamp: 1700000000000,
                        message: { mid: 'echo', text: 'bot', is_echo: true }
                    }]
                }]
            });
            expect(events).toEqual([]);
        });

        test('emits comment events from IG comments changes', () => {
            const events = provider.parseWebhookEnvelope({
                object: 'instagram',
                entry: [{
                    id: 'IG_123',
                    changes: [{
                        field: 'comments',
                        value: {
                            id: 'IG_C_456',
                            from: { id: 'IGUSER_AAA' },
                            text: 'How much?',
                            media: { id: 'IG_POST_789' }
                        }
                    }]
                }]
            });
            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({
                externalId: 'IG_C_456',
                senderExternalId: 'IGUSER_AAA',
                pageOrAccountId: 'IG_123',
                text: 'How much?',
                commentId: 'IG_C_456',
                postId: 'IG_POST_789'
            });
        });
    });

    describe('verifyWebhookSubscription()', () => {
        beforeEach(() => { process.env.META_APP_SECRET = 'test-secret'; });
        afterEach(() => jest.resetAllMocks());

        // IG verifies against the PARENT page id (linked_fb_page_id), not the IG asset id
        const channel = {
            meta_asset_id: 'IG_1',
            linked_fb_page_id: 'PAGE_1',
            page_access_token_ct: 'tok_page'
        };

        test('returns ok:true when the parent page has a subscription including messages', async () => {
            axios.get.mockResolvedValueOnce({
                data: { data: [{ subscribed_fields: ['messages', 'messaging_postbacks', 'comments'] }] }
            });
            const res = await provider.verifyWebhookSubscription({ channel });
            expect(res.ok).toBe(true);
            // Must target the PARENT page id, not the IG account id
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
            axios.get.mockResolvedValueOnce({ data: { data: [{ subscribed_fields: ['comments'] }] } });
            const res = await provider.verifyWebhookSubscription({ channel });
            expect(res.ok).toBe(false);
        });
    });
});
