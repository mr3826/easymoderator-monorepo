/**
 * Meta Webhook Routes — Unit Tests
 *
 * Covers: storeIncomingMessage (conversation pipeline), reply endpoint
 * (token decryption, platform mapping, 24h window), webhook GET verification,
 * and incoming webhook POST routing.
 */

// ── Environment ────────────────────────────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-jwt-access-secret-32chars!!';
process.env.META_APP_SECRET = 'test-app-secret';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'global-verify-token';
process.env.INTERNAL_WEBHOOK_SECRET = 'internal-secret-xyz';

// ── Mocks (before any require) ─────────────────────────────────────────────────

jest.mock('src/config/redis', () => ({
    sessionRedis: null, cacheRedis: null, rateLimitRedis: null,
    closeAllRedis: jest.fn(), checkRedisAvailability: jest.fn(() => ({}))
}));

// Mock rate-limit-redis so it never tries to connect
jest.mock('rate-limit-redis', () => ({ RedisStore: jest.fn() }));

jest.mock('src/utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }))
}));

// Mock config
jest.mock('src/config/config', () => ({
    metaWebhookAppSecret: null,  // disabled by default; override per test
    internalWebhookSecret: 'internal-secret-xyz',
    jwtAccessSecret: 'test-jwt-access-secret-32chars!!',
    metaAppId: 'test-app-id',
    metaAppSecret: 'test-app-secret',
    metaOAuthRedirectUri: 'https://example.com/callback'
}));

// ── Entity mocks ───────────────────────────────────────────────────────────────

const mockMetaIntegration = {
    findOne: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
};
jest.mock('src/modules/integration/meta-integration.entity', () => mockMetaIntegration);

const mockCustomer = { findOne: jest.fn(), findOrCreate: jest.fn(), update: jest.fn(), destroy: jest.fn() };
const mockConversation = { findOne: jest.fn(), create: jest.fn() };
const mockMessage = { findOne: jest.fn(), create: jest.fn() };

jest.mock('src/modules/entities', () => ({
    Customer: mockCustomer,
    Conversation: mockConversation,
    Message: mockMessage,
}));

jest.mock('src/modules/conversation/conversation.entity', () => ({
    Conversation: mockConversation,
    Message: mockMessage,
}));

const mockTransaction = {};
jest.mock('src/utils/database/database-setup', () => ({
    sequelize: {
        define: jest.fn(() => ({
            findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn(),
            belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
            addScope: jest.fn(), scope: jest.fn(function () { return this; })
        })),
        transaction: jest.fn(async (fn) => fn(mockTransaction)),
        authenticate: jest.fn(), sync: jest.fn(),
        literal: jest.fn(s => s)
    }
}));

// MetaService mock (for decryptToken in the reply endpoint)
const mockMetaService = {
    decryptToken: jest.fn(t => `DECRYPTED:${t}`),
    encryptToken: jest.fn(t => `ENCRYPTED:${t}`),
};
jest.mock('src/modules/integration/meta.service', () => mockMetaService);

// Global fetch mock
global.fetch = jest.fn();

// ── Requires (after mocks) ─────────────────────────────────────────────────────
const request = require('supertest');
const express = require('express');
const crypto = require('crypto');
const config = require('src/config/config');

let app;
let storeIncomingMessage;

beforeAll(() => {
    const webhookRouter = require('src/modules/integration/meta-webhook.routes');
    storeIncomingMessage = webhookRouter.storeIncomingMessage;

    app = express();
    app.use('/webhooks/meta', webhookRouter);
});

// ── Fixtures ───────────────────────────────────────────────────────────────────
const SHOP_ID = 'shop-uuid-1';
const PAGE_ID = 'page-111';
const CONV_ID = 'conv-uuid-1';
const CUSTOMER_ID = 'cust-uuid-1';
const ENCRYPTED_TOKEN = 'iv:authtag:ciphertext';

const buildIntegration = (overrides = {}) => ({
    id: 'integ-1',
    shop_id: SHOP_ID,
    platform: 'facebook',
    meta_asset_id: PAGE_ID,
    status: 'CONNECTED',
    access_token: ENCRYPTED_TOKEN,
    token_expires_at: null,
    ...overrides
});

const buildConversation = (overrides = {}) => ({
    id: CONV_ID,
    shop_id: SHOP_ID,
    customer_id: CUSTOMER_ID,
    channel: 'messenger',
    ...overrides
});

const buildMessage = (overrides = {}) => ({
    id: 'msg-uuid-1',
    conversation_id: CONV_ID,
    sender: 'customer',
    content: 'Hello',
    external_id: 'mid.12345',
    created_at: new Date(),
    ...overrides
});

// ── storeIncomingMessage ───────────────────────────────────────────────────────

describe('storeIncomingMessage', () => {
    const baseEvent = {
        platform: 'facebook',
        shop_id: SHOP_ID,
        sender: 'sender-fb-123',
        message: 'Hello there',
        attachments: [],
        timestamp: new Date(),
        raw_event: { message: { mid: 'mid.ABCDE', text: 'Hello there' } }
    };

    const customer = { id: CUSTOMER_ID, name: 'facebook user' };
    const conversation = buildConversation();
    const msgRecord = buildMessage({ id: 'msg-new' });

    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });

        mockCustomer.findOrCreate.mockResolvedValue([customer, true]);
        mockConversation.findOne.mockResolvedValue(null);
        mockConversation.create.mockResolvedValue(conversation);
        mockMessage.findOne.mockResolvedValue(null);
        mockMessage.create.mockResolvedValue(msgRecord);
    });

    it('creates customer, conversation and message on first message', async () => {
        const result = await storeIncomingMessage(baseEvent);

        expect(mockCustomer.findOrCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ shop_id: SHOP_ID, channel_type: 'messenger', channel_user_id: 'sender-fb-123' }),
                transaction: mockTransaction
            })
        );
        expect(mockConversation.create).toHaveBeenCalled();
        expect(mockMessage.create).toHaveBeenCalledWith(
            expect.objectContaining({ content: 'Hello there', sender: 'customer', external_id: 'mid.ABCDE' }),
            expect.objectContaining({ transaction: mockTransaction })
        );
        expect(result).toMatchObject({ customer_id: CUSTOMER_ID, conversation_id: CONV_ID });
    });

    it('maps facebook platform to messenger channel_type', async () => {
        await storeIncomingMessage(baseEvent);

        expect(mockCustomer.findOrCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ channel_type: 'messenger' })
            })
        );
    });

    it('reuses the existing active conversation within 24h window', async () => {
        mockConversation.findOne.mockResolvedValue(conversation);

        await storeIncomingMessage(baseEvent);

        expect(mockConversation.create).not.toHaveBeenCalled();
        expect(mockMessage.create).toHaveBeenCalledWith(
            expect.objectContaining({ conversation_id: CONV_ID }),
            expect.anything()
        );
    });

    it('creates a new conversation when none exists within 24h', async () => {
        mockConversation.findOne.mockResolvedValue(null);

        await storeIncomingMessage(baseEvent);

        expect(mockConversation.create).toHaveBeenCalledWith(
            expect.objectContaining({ shop_id: SHOP_ID, customer_id: CUSTOMER_ID, channel: 'messenger' }),
            expect.objectContaining({ transaction: mockTransaction })
        );
    });

    it('skips duplicate message by external_id (idempotency)', async () => {
        const existingMsg = buildMessage({ id: 'existing-msg', conversation_id: CONV_ID });
        mockMessage.findOne.mockResolvedValue(existingMsg);

        const result = await storeIncomingMessage(baseEvent);

        expect(mockCustomer.findOrCreate).not.toHaveBeenCalled();
        expect(result.message_id).toBe('existing-msg');
    });

    it('proceeds without idempotency check when raw_event has no message ID', async () => {
        const eventNoMid = { ...baseEvent, raw_event: { message: { text: 'hi' } } };
        await storeIncomingMessage(eventNoMid);

        expect(mockMessage.findOne).not.toHaveBeenCalled();
        expect(mockMessage.create).toHaveBeenCalled();
    });

    it('returns correct shape: customer_id, customer_name, conversation_id, message_id', async () => {
        const result = await storeIncomingMessage(baseEvent);
        expect(result).toHaveProperty('customer_id');
        expect(result).toHaveProperty('conversation_id');
        expect(result).toHaveProperty('message_id');
    });

    it('rethrows on DB error so the caller can log it', async () => {
        mockCustomer.findOrCreate.mockRejectedValue(new Error('DB connection lost'));

        await expect(storeIncomingMessage(baseEvent)).rejects.toThrow('DB connection lost');
    });
});

// ── GET /webhooks/meta (webhook verification) ──────────────────────────────────

describe('GET /webhooks/meta (webhook verification)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockMetaIntegration.findOne.mockResolvedValue(null);
    });

    it('returns 403 when hub.mode is not subscribe', async () => {
        await request(app)
            .get('/webhooks/meta')
            .query({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'global-verify-token', 'hub.challenge': 'ch1' })
            .expect(403);
    });

    it('returns 403 when verify_token is missing', async () => {
        await request(app)
            .get('/webhooks/meta')
            .query({ 'hub.mode': 'subscribe', 'hub.challenge': 'ch1' })
            .expect(403);
    });

    it('returns 403 when verify_token does not match global env var or any integration', async () => {
        await request(app)
            .get('/webhooks/meta')
            .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token', 'hub.challenge': 'ch1' })
            .expect(403);
    });

    it('returns 200 with challenge when verify_token matches global META_WEBHOOK_VERIFY_TOKEN', async () => {
        const res = await request(app)
            .get('/webhooks/meta')
            .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'global-verify-token', 'hub.challenge': 'challenge-abc' })
            .expect(200);

        expect(res.text).toBe('challenge-abc');
    });

    it('returns 200 with challenge when verify_token matches a per-tenant integration', async () => {
        mockMetaIntegration.findOne.mockResolvedValue(buildIntegration({ webhook_verify_token: 'tenant-token-xyz' }));

        const res = await request(app)
            .get('/webhooks/meta')
            .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tenant-token-xyz', 'hub.challenge': 'ch-tenant' })
            .expect(200);

        expect(res.text).toBe('ch-tenant');
    });
});

// ── POST /webhooks/meta/reply ──────────────────────────────────────────────────

describe('POST /webhooks/meta/reply', () => {
    const replyBody = {
        conversation_id: CONV_ID,
        message: 'Here is your order update!',
        platform: 'facebook',
        recipient_id: 'fb-user-456',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });

        mockConversation.findOne.mockResolvedValue(buildConversation());
        mockMessage.findOne.mockResolvedValue(null);
        mockMessage.create.mockResolvedValue(buildMessage({ sender: 'ai' }));
        mockMetaIntegration.findOne.mockResolvedValue(buildIntegration());
        mockMetaService.decryptToken.mockReturnValue('REAL_ACCESS_TOKEN');
    });

    it('returns 400 when conversation_id is missing', async () => {
        await request(app)
            .post('/webhooks/meta/reply')
            .set('x-internal-webhook-secret', 'internal-secret-xyz')
            .send({ message: 'hello' })
            .expect(400);
    });

    it('returns 400 when message is missing', async () => {
        await request(app)
            .post('/webhooks/meta/reply')
            .set('x-internal-webhook-secret', 'internal-secret-xyz')
            .send({ conversation_id: CONV_ID })
            .expect(400);
    });

    it('returns 403 when internal webhook secret is wrong', async () => {
        await request(app)
            .post('/webhooks/meta/reply')
            .set('x-internal-webhook-secret', 'wrong-secret')
            .send(replyBody)
            .expect(403);
    });

    it('returns 404 when conversation is not found', async () => {
        mockConversation.findOne.mockResolvedValue(null);

        await request(app)
            .post('/webhooks/meta/reply')
            .set('x-internal-webhook-secret', 'internal-secret-xyz')
            .send(replyBody)
            .expect(404);
    });

    it('CRITICAL: decrypts the stored token before sending to Meta', async () => {
        await request(app)
            .post('/webhooks/meta/reply')
            .set('x-internal-webhook-secret', 'internal-secret-xyz')
            .send(replyBody)
            .expect(200);

        // decryptToken must be called with the encrypted value from the DB
        expect(mockMetaService.decryptToken).toHaveBeenCalledWith(ENCRYPTED_TOKEN);

        // fetch (sendMetaReply) must receive the DECRYPTED token, not the raw encrypted string
        expect(global.fetch).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                body: expect.stringContaining('REAL_ACCESS_TOKEN')
            })
        );
        expect(global.fetch).not.toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                body: expect.stringContaining(ENCRYPTED_TOKEN)
            })
        );
    });

    it('maps messenger platform to facebook MetaIntegration record', async () => {
        await request(app)
            .post('/webhooks/meta/reply')
            .set('x-internal-webhook-secret', 'internal-secret-xyz')
            .send({ ...replyBody, platform: 'messenger' })
            .expect(200);

        expect(mockMetaIntegration.findOne).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ platform: 'facebook' })
            })
        );
    });

    it('facebook platform also maps to facebook MetaIntegration record', async () => {
        await request(app)
            .post('/webhooks/meta/reply')
            .set('x-internal-webhook-secret', 'internal-secret-xyz')
            .send({ ...replyBody, platform: 'facebook' })
            .expect(200);

        expect(mockMetaIntegration.findOne).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ platform: 'facebook' })
            })
        );
    });

    it('instagram platform is not remapped', async () => {
        mockMetaIntegration.findOne.mockResolvedValue(buildIntegration({ platform: 'instagram' }));

        await request(app)
            .post('/webhooks/meta/reply')
            .set('x-internal-webhook-secret', 'internal-secret-xyz')
            .send({ ...replyBody, platform: 'instagram' })
            .expect(200);

        expect(mockMetaIntegration.findOne).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ platform: 'instagram' })
            })
        );
    });

    it('returns 503 and does not send when token is expired', async () => {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        mockMetaIntegration.findOne.mockResolvedValue(buildIntegration({ token_expires_at: yesterday }));

        await request(app)
            .post('/webhooks/meta/reply')
            .set('x-internal-webhook-secret', 'internal-secret-xyz')
            .send(replyBody)
            .expect(503);

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns 422 when outside the 24-hour messaging window', async () => {
        const oldMsg = buildMessage({
            sender: 'customer',
            created_at: new Date(Date.now() - 25 * 60 * 60 * 1000)
        });
        mockMessage.findOne.mockResolvedValue(oldMsg);

        await request(app)
            .post('/webhooks/meta/reply')
            .set('x-internal-webhook-secret', 'internal-secret-xyz')
            .send(replyBody)
            .expect(422);
    });

    it('stores the bot message and returns 200 even when Meta send fails', async () => {
        global.fetch.mockRejectedValue(new Error('Meta API unavailable'));

        const res = await request(app)
            .post('/webhooks/meta/reply')
            .set('x-internal-webhook-secret', 'internal-secret-xyz')
            .send(replyBody)
            .expect(200);

        expect(res.body.success).toBe(true);
        expect(mockMessage.create).toHaveBeenCalled();
    });

    it('deduplicates by idempotency_key — returns existing message without re-sending', async () => {
        const existingBotMsg = buildMessage({ id: 'existing-bot-msg', sender: 'ai', external_id: 'idem-key-1' });
        mockMessage.findOne.mockResolvedValue(existingBotMsg);

        const res = await request(app)
            .post('/webhooks/meta/reply')
            .set('x-internal-webhook-secret', 'internal-secret-xyz')
            .send({ ...replyBody, idempotency_key: 'idem-key-1' })
            .expect(200);

        expect(res.body.duplicate).toBe(true);
        expect(res.body.message_id).toBe('existing-bot-msg');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('still returns 200 when no integration found (message stored, send silently skipped)', async () => {
        mockMetaIntegration.findOne.mockResolvedValue(null);

        await request(app)
            .post('/webhooks/meta/reply')
            .set('x-internal-webhook-secret', 'internal-secret-xyz')
            .send(replyBody)
            .expect(200);

        expect(mockMessage.create).toHaveBeenCalled();
        expect(global.fetch).not.toHaveBeenCalled();
    });
});

// ── POST /webhooks/meta (incoming webhook) ─────────────────────────────────────

describe('POST /webhooks/meta (incoming webhook)', () => {
    const buildPagePayload = (overrides = {}) => ({
        object: 'page',
        entry: [{
            id: PAGE_ID,
            messaging: [{
                sender: { id: 'fb-user-789' },
                recipient: { id: PAGE_ID },
                timestamp: Date.now(),
                message: { mid: 'mid.XYZ', text: 'Order status?' }
            }]
        }],
        ...overrides
    });

    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch.mockResolvedValue({ ok: true });

        mockMetaIntegration.findOne.mockResolvedValue(buildIntegration());
        mockMetaIntegration.findAll.mockResolvedValue([]);
        mockCustomer.findOrCreate.mockResolvedValue([{ id: CUSTOMER_ID }, true]);
        mockConversation.findOne.mockResolvedValue(null);
        mockConversation.create.mockResolvedValue(buildConversation());
        mockMessage.findOne.mockResolvedValue(null);
        mockMessage.create.mockResolvedValue(buildMessage());
    });

    const sendWebhook = (payload) =>
        request(app)
            .post('/webhooks/meta')
            .set('Content-Type', 'application/json')
            .send(payload);

    it('always returns 200 — never 5xx (Meta must not retry)', async () => {
        await sendWebhook(buildPagePayload()).expect(200);
    });

    it('returns 200 even when page integration is missing (message dropped gracefully)', async () => {
        mockMetaIntegration.findOne.mockResolvedValue(null);
        await sendWebhook(buildPagePayload()).expect(200);
    });

    it('returns 200 for unrecognised object type', async () => {
        await sendWebhook({ object: 'user', entry: [] }).expect(200);
    });

    it('routes page events and stores the incoming message', async () => {
        await sendWebhook(buildPagePayload()).expect(200);
        expect(mockMessage.create).toHaveBeenCalled();
    });

    it('skips echo events (page own outbound messages)', async () => {
        const echoPayload = buildPagePayload();
        echoPayload.entry[0].messaging[0].message.is_echo = true;

        await sendWebhook(echoPayload).expect(200);
        expect(mockMessage.create).not.toHaveBeenCalled();
    });

    it('skips non-message events (read receipts, delivery reports)', async () => {
        const noMsgPayload = {
            object: 'page',
            entry: [{
                id: PAGE_ID,
                messaging: [{
                    sender: { id: 'fb-user-789' },
                    recipient: { id: PAGE_ID },
                    timestamp: Date.now(),
                    delivery: { watermark: 12345 }  // delivery event, no message
                }]
            }]
        };
        await sendWebhook(noMsgPayload).expect(200);
        expect(mockMessage.create).not.toHaveBeenCalled();
    });

    it('routes instagram events and stores the message', async () => {
        mockMetaIntegration.findOne.mockResolvedValue(buildIntegration({ platform: 'instagram' }));

        const igPayload = {
            object: 'instagram',
            entry: [{
                id: 'ig-acct-111',
                messaging: [{
                    sender: { id: 'ig-user-999' },
                    recipient: { id: 'ig-acct-111' },
                    timestamp: Date.now(),
                    message: { mid: 'ig.mid.ABC', text: 'Hi from IG' }
                }]
            }]
        };
        await sendWebhook(igPayload).expect(200);
        expect(mockMessage.create).toHaveBeenCalled();
    });

    it('returns 200 even when message storage fails (per-message error isolation)', async () => {
        mockMessage.create.mockRejectedValue(new Error('DB write failed'));

        await sendWebhook(buildPagePayload()).expect(200);
    });

    it('rejects webhook with invalid signature when META_WEBHOOK_APP_SECRET is set', async () => {
        config.metaWebhookAppSecret = 'my-app-secret';
        try {
            await request(app)
                .post('/webhooks/meta')
                .set('Content-Type', 'application/octet-stream')
                .set('x-hub-signature-256', 'sha256=invalidsignature')
                .send(Buffer.from(JSON.stringify(buildPagePayload())))
                .expect(403);
        } finally {
            config.metaWebhookAppSecret = null;
        }
    });

    it('accepts webhook with valid HMAC-SHA256 signature', async () => {
        const secret = 'my-app-secret';
        config.metaWebhookAppSecret = secret;
        try {
            const body = Buffer.from(JSON.stringify(buildPagePayload()));
            const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

            await request(app)
                .post('/webhooks/meta')
                .set('Content-Type', 'application/octet-stream')
                .set('x-hub-signature-256', sig)
                .send(body)
                .expect(200);
        } finally {
            config.metaWebhookAppSecret = null;
        }
    });
});
