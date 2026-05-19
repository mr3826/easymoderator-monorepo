/**
 * MetaMessengerProvider.test.js
 *
 * Unit tests for the Facebook Messenger provider — focused on pure functions
 * that don't require Meta API access: webhook parsing, signature verification,
 * webhook field list, and the abstract-class contract.
 */

'use strict';

const crypto = require('crypto');
const MetaMessengerProvider = require('../providers/MetaMessengerProvider');
const ChannelProvider = require('../ChannelProvider');

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
});
