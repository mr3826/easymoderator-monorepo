const request = require('supertest');
const express = require('express');
const crypto = require('crypto');

jest.mock('../../src/config/redis', () => ({
  rateLimitRedis: null
}));

jest.mock('../../src/modules/integration/meta-integration.entity', () => ({
  findOne: jest.fn()
}));

jest.mock('../../src/modules/entities', () => ({
  Customer: {
    destroy: jest.fn(),
    update: jest.fn()
  }
}));

jest.mock('../../src/modules/conversation/conversation.entity', () => ({
  Conversation: { findOne: jest.fn(), create: jest.fn() },
  Message: { findOne: jest.fn(), create: jest.fn() }
}));

jest.mock('../../src/utils/database/database-setup', () => ({
  sequelize: {
    transaction: jest.fn(async (fn) => fn({}))
  }
}));

jest.mock('../../src/config/config', () => ({
  metaWebhookAppSecret: 'test-webhook-secret',
  env: 'test'
}));

const MetaIntegration = require('../../src/modules/integration/meta-integration.entity');
const { Customer } = require('../../src/modules/entities');
const { Conversation, Message } = require('../../src/modules/conversation/conversation.entity');
const metaWebhookRoutes = require('../../src/modules/integration/meta-webhook.routes');

const createApp = () => {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use('/webhooks/meta', metaWebhookRoutes);
  app.use((err, req, res, next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
};

const createSignedRequest = (payload, secret) => {
  const encodedPayload = Buffer.from(JSON.stringify(payload))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const sig = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${sig}.${encodedPayload}`;
};

describe('Meta Webhook Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'verify-token-test';
  });

  test('GET /webhooks/meta returns challenge for valid verify token', async () => {
    MetaIntegration.findOne.mockResolvedValue(null);

    const res = await request(createApp())
      .get('/webhooks/meta')
      .query({
        'hub.mode': 'subscribe',
        'hub.challenge': 'challenge-abc',
        'hub.verify_token': 'verify-token-test'
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe('challenge-abc');
  });

  test('GET /webhooks/meta rejects invalid mode', async () => {
    const res = await request(createApp())
      .get('/webhooks/meta')
      .query({
        'hub.mode': 'ping',
        'hub.challenge': 'challenge-abc',
        'hub.verify_token': 'verify-token-test'
      });

    expect(res.status).toBe(403);
  });

  test('GET /webhooks/meta rejects invalid verify token', async () => {
    MetaIntegration.findOne.mockResolvedValue(null);

    const res = await request(createApp())
      .get('/webhooks/meta')
      .query({
        'hub.mode': 'subscribe',
        'hub.challenge': 'challenge-abc',
        'hub.verify_token': 'wrong-token'
      });

    expect(res.status).toBe(403);
  });

  test('POST /webhooks/meta returns 200 for malformed JSON payload', async () => {
    const res = await request(createApp())
      .post('/webhooks/meta')
      .set('Content-Type', 'application/json')
      .send('{broken-json');

    expect(res.status).toBe(200);
  });

  test('POST /webhooks/meta rejects invalid signature', async () => {
    const payload = { object: 'unknown', entry: [{ id: 'asset-1' }] };

    const res = await request(createApp())
      .post('/webhooks/meta')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', 'sha256=invalid-signature')
      .send(payload);

    expect(res.status).toBe(403);
  });

  test('POST /webhooks/meta accepts valid signature', async () => {
    const payload = { object: 'unknown', entry: [{ id: 'asset-1' }] };
    const body = JSON.stringify(payload);
    const signature = `sha256=${crypto.createHmac('sha256', 'test-webhook-secret').update(body).digest('hex')}`;

    const res = await request(createApp())
      .post('/webhooks/meta')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(payload);

    expect(res.status).toBe(200);
  });

  test('POST /webhooks/meta/data-deletion returns 400 when signed_request is missing', async () => {
    const res = await request(createApp())
      .post('/webhooks/meta/data-deletion')
      .type('form')
      .send({});

    expect(res.status).toBe(400);
  });

  test('POST /webhooks/meta/data-deletion returns 403 for invalid signed_request', async () => {
    const res = await request(createApp())
      .post('/webhooks/meta/data-deletion')
      .type('form')
      .send({ signed_request: 'bad.request' });

    expect(res.status).toBe(403);
  });

  test('POST /webhooks/meta/data-deletion returns confirmation payload for valid signed_request', async () => {
    Customer.destroy.mockResolvedValue(1);
    const signedRequest = createSignedRequest({ user_id: 'fb-user-123' }, 'test-webhook-secret');

    const res = await request(createApp())
      .post('/webhooks/meta/data-deletion')
      .type('form')
      .send({ signed_request: signedRequest });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('confirmation_code');
    expect(res.body).toHaveProperty('url');
  });

  test('POST /webhooks/meta/deauthorize returns 400 when signed_request is missing', async () => {
    const res = await request(createApp())
      .post('/webhooks/meta/deauthorize')
      .type('form')
      .send({});

    expect(res.status).toBe(400);
  });

  test('POST /webhooks/meta/deauthorize returns 200 for valid signed_request', async () => {
    Customer.update.mockResolvedValue([1]);
    const signedRequest = createSignedRequest({ user_id: 'fb-user-456' }, 'test-webhook-secret');

    const res = await request(createApp())
      .post('/webhooks/meta/deauthorize')
      .type('form')
      .send({ signed_request: signedRequest });

    expect(res.status).toBe(200);
  });

});
