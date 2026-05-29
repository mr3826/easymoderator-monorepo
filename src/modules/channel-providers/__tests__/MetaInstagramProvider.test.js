/**
 * MetaInstagramProvider.test.js
 *
 * Same coverage as Messenger provider, focused on the IG-specific payload shape
 * and the IG webhook field list (no whatsapp).
 */

'use strict';

const crypto = require('crypto');
const MetaInstagramProvider = require('../providers/MetaInstagramProvider');
const ChannelProvider = require('../ChannelProvider');

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
        test('includes IG-specific fields (messages, comments)', () => {
            const fields = provider.webhookFields();
            expect(fields).toContain('messages');
            expect(fields).toContain('comments');
            expect(fields).toContain('live_comments');
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
});
