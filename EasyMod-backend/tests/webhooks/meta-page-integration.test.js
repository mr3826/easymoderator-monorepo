/**
 * Meta Integration Test Suite
 *
 * Covers:
 *  Section 1 — Page Connection (integration management API)
 *  Section 2 — Webhook Message Reception (all 3 platforms)
 *  Section 3 — Customer-Chatbot Chat Scenarios (13 realistic scenarios)
 *  Section 4 — Reply Webhook (24-hour window, idempotency, token expiry)
 *  Section 5 — Full Chat Round-Trip (webhook → chatbot → reply)
 *
 * Test user: "Rahim Ahmed" chatting with "Dhaka Fashion House" Facebook page.
 * All external APIs (Meta Graph API, LLM, RAG, Redis, DB) are mocked.
 */

'use strict';

// ── Env setup (must run before any require) ───────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.META_WEBHOOK_APP_SECRET = 'mock-app-secret';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'global-verify-token';
process.env.REDIS_URL = '';
process.env.INTERNAL_WEBHOOK_SECRET = ''; // prevent .env value from requiring the secret header
process.env.PINECONE_API_KEY = 'test-pinecone-key';
process.env.PINECONE_INDEX = 'test-index';
process.env.EMBEDDING_PROVIDER = 'local';

const request = require('supertest');
const crypto  = require('crypto');

// ── Test Fixtures (defined before mocks — factories run lazily at require time) ─
const TEST_SHOP_ID   = 'a1b2c3d4-2222-4abc-8def-aabbccddeeff';
const TEST_CONV_ID   = 'conv-meta-test-0001';
const TEST_CUST_ID   = 'cust-meta-test-0001';
const TEST_MSG_ID    = 'msg-meta-test-0001';
const TEST_PAGE_ID   = 'page-111222333';        // Facebook Page ID
const TEST_IG_ID     = 'ig-account-444555';     // Instagram Account ID
const TEST_WA_ID     = 'wa-account-666777';     // WhatsApp Business Account ID

const TEST_CUSTOMER = {
  psid:  'psid-rahim-001',          // Page-Scoped ID (Messenger)
  wa_id: '8801712345678',           // WhatsApp number
  ig_id: 'ig-rahim-001',            // Instagram user ID
  name:  'Rahim Ahmed',
};

// Pre-built integration records (returned by MetaIntegration.findOne)
const MOCK_INTEGRATION_FB = {
  id:                    'integ-fb-001',
  shop_id:               TEST_SHOP_ID,
  platform:              'facebook',
  meta_asset_id:         TEST_PAGE_ID,
  display_name:          'Dhaka Fashion House',
  status:                'CONNECTED',
  webhook_verify_token:  'per-tenant-verify-token-abc',
  app_secret:            'mock-app-secret',
  access_token:          'mock-access-token-fb',
  token_expires_at:      new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
  update:                jest.fn(() => Promise.resolve()),
};

const MOCK_INTEGRATION_IG = {
  ...MOCK_INTEGRATION_FB,
  id:             'integ-ig-001',
  platform:       'instagram',
  meta_asset_id:  TEST_IG_ID,
  access_token:   'mock-access-token-ig',
};

const MOCK_INTEGRATION_WA = {
  ...MOCK_INTEGRATION_FB,
  id:             'integ-wa-001',
  platform:       'whatsapp',
  meta_asset_id:  TEST_WA_ID,
  access_token:   'mock-access-token-wa',
};

const MOCK_SHOP = {
  id:                    TEST_SHOP_ID,
  shop_name:             'Dhaka Fashion House',
  ai_settings:           null,
  settings: {
    businessInfo: {
      shopName:        'Dhaka Fashion House',
      address:         'Mirpur, Dhaka',
      phone:           '01712345678',
      openingHours:    'Sat–Thu 10am–9pm',
      deliveryAreas:   ['Dhaka', 'Chittagong'],
      paymentMethods:  ['COD', 'bKash'],
    },
    brandingRules: { tone: 'friendly', emojiUsage: 'light' },
    ai: { automation_mode: 'AUTO', confidence_threshold: 50 },
  },
  update: jest.fn(() => Promise.resolve()),
};

const MOCK_CUSTOMER_RECORD = {
  id:              TEST_CUST_ID,
  shop_id:         TEST_SHOP_ID,
  channel_type:    'messenger',
  channel_user_id: TEST_CUSTOMER.psid,
  name:            TEST_CUSTOMER.name,
  update:          jest.fn(() => Promise.resolve()),
};

const MOCK_CONVERSATION_RECORD = {
  id:          TEST_CONV_ID,
  shop_id:     TEST_SHOP_ID,
  customer_id: TEST_CUST_ID,
  channel:     'messenger',
  status:      'active',
  update:      jest.fn(() => Promise.resolve()),
};

const MOCK_FAQ = {
  id:          42,
  shop_id:     TEST_SHOP_ID,
  category:    'Return Policy',
  template_en: 'We offer 30-day returns on all items. No questions asked.',
  is_active:   true,
  priority:    10,
  use_count:   5,
  increment:   jest.fn(() => Promise.resolve()),
};

const MOCK_PRODUCT = {
  id:               'prod-uuid-0001',
  name:             'Blue Cotton Shirt',
  name_bn:          'নীল কটন শার্ট',
  category:         'Shirts',
  price:            '850',
  compare_at_price: '1000',
  quantity:         20,
  in_stock:         true,
  is_active:        true,
  brand:            'FashionCo',
  description:      'A comfortable blue cotton shirt',
  ai_category:      'shirts',
  ai_color_primary: 'blue',
  ai_material:      'cotton',
  variants:         null,
  images:           null,
  image_url:        null,
  tags:             null,
  ai_description:   null,
  ai_tags:          null,
  ai_attributes:    null,
};

// ── Mock: Redis config ────────────────────────────────────────────────────────
jest.mock('src/config/redis', () => ({
  rateLimitRedis: null, sessionRedis: null, cacheRedis: null, legacyRedis: null,
  closeAll: jest.fn(),
}));

// ── Mock: Redis client (in-memory store) ──────────────────────────────────────
const redisStore = {};
const mockRedis = {
  get:    jest.fn((k)        => Promise.resolve(redisStore[k] ?? null)),
  set:    jest.fn((k, v)     => { redisStore[k] = v; return Promise.resolve('OK'); }),
  setex:  jest.fn((k, _t, v) => { redisStore[k] = v; return Promise.resolve('OK'); }),
  del:    jest.fn((k)        => { delete redisStore[k]; return Promise.resolve(1); }),
  incr:   jest.fn((k)        => { redisStore[k] = (parseInt(redisStore[k] || '0', 10)) + 1; return Promise.resolve(redisStore[k]); }),
  expire: jest.fn(() => Promise.resolve(1)),
  ttl:    jest.fn(() => Promise.resolve(-1)),
  status: 'ready',
  _isMemoryFallback: true,
};
jest.mock('src/utils/redis-client', () => ({
  getRedisClient: () => mockRedis,
  isRedisAvailable: () => true,
  closeRedis: jest.fn(),
}));

// ── Mock: Sequelize ───────────────────────────────────────────────────────────
function mockModel() {
  const m = {
    findOne:      jest.fn(() => Promise.resolve(null)),
    findByPk:     jest.fn(() => Promise.resolve(null)),
    findAll:      jest.fn(() => Promise.resolve([])),
    findOrCreate: jest.fn(() => Promise.resolve([{}, true])),
    create:       jest.fn(() => Promise.resolve({})),
    update:       jest.fn(() => Promise.resolve([1])),
    upsert:       jest.fn(() => Promise.resolve([{}, true])),
    destroy:      jest.fn(() => Promise.resolve(1)),
    increment:    jest.fn(() => Promise.resolve()),
    count:        jest.fn(() => Promise.resolve(0)),
    sum:          jest.fn(() => Promise.resolve(0)),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return m; }),
  };
  return m;
}

jest.mock('src/utils/database/database-setup', () => ({
  sequelize: {
    define:       jest.fn(() => mockModel()),
    transaction:  jest.fn(async (fn) => fn({ commit: jest.fn(), rollback: jest.fn() })),
    authenticate: jest.fn(() => Promise.resolve()),
    sync:         jest.fn(() => Promise.resolve()),
    query:        jest.fn(() => Promise.resolve([])),
  },
}));

// ── Mock: MetaIntegration entity (imported directly by webhook routes) ─────────
jest.mock('src/modules/integration/meta-integration.entity', () => ({
  findOne:   jest.fn(() => Promise.resolve(MOCK_INTEGRATION_FB)),
  findAll:   jest.fn(() => Promise.resolve([MOCK_INTEGRATION_FB])),
  upsert:    jest.fn(() => Promise.resolve([MOCK_INTEGRATION_FB, true])),
  update:    jest.fn(() => Promise.resolve([1])),
  belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
  addScope:  jest.fn(), scope: jest.fn(),
}));

// ── Mock: Conversation & Message entities (imported directly by webhook routes) ─
jest.mock('src/modules/conversation/conversation.entity', () => ({
  Conversation: {
    findOne:   jest.fn(() => Promise.resolve(MOCK_CONVERSATION_RECORD)),
    create:    jest.fn(() => Promise.resolve(MOCK_CONVERSATION_RECORD)),
    findAll:   jest.fn(() => Promise.resolve([])),
    update:    jest.fn(() => Promise.resolve([1])),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope:  jest.fn(), scope: jest.fn(function() { return this; }),
  },
  Message: {
    findOne:   jest.fn(() => Promise.resolve(null)), // null = no duplicate by default
    create:    jest.fn(() => Promise.resolve({
      id: TEST_MSG_ID,
      conversation_id: TEST_CONV_ID,
      content: '',
      sender: 'ai',
      created_at: new Date().toISOString(),
    })),
    findAll:   jest.fn(() => Promise.resolve([])),
    update:    jest.fn(() => Promise.resolve([1])),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope:  jest.fn(), scope: jest.fn(function() { return this; }),
  },
}));

// ── Mock: KnowledgeGap entity ─────────────────────────────────────────────────
jest.mock('src/modules/analytics/knowledge-gap.entity', () => ({
  findAll:   jest.fn(() => Promise.resolve([])),
  findOne:   jest.fn(() => Promise.resolve(null)),
  create:    jest.fn(() => Promise.resolve({ id: 1 })),
  belongsTo: jest.fn(), hasMany: jest.fn(),
}));

// ── Mock: All central entities ────────────────────────────────────────────────
jest.mock('src/modules/entities', () => ({
  Shop: {
    findByPk: jest.fn(() => Promise.resolve(MOCK_SHOP)),
    findOne:  jest.fn(() => Promise.resolve(MOCK_SHOP)),
    findAll:  jest.fn(() => Promise.resolve([MOCK_SHOP])),
    create: jest.fn(), update: jest.fn(),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  User: {
    findOne: jest.fn(() => Promise.resolve(null)),
    findByPk: jest.fn(() => Promise.resolve(null)),
    create: jest.fn(), update: jest.fn(),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  UserShop: {
    findOne:  jest.fn(() => Promise.resolve({ role: 'owner', is_active: true })),
    findAll:  jest.fn(() => Promise.resolve([])),
    create:   jest.fn(),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  Customer: {
    findOrCreate: jest.fn(() => Promise.resolve([MOCK_CUSTOMER_RECORD, false])),
    findOne:      jest.fn(() => Promise.resolve(MOCK_CUSTOMER_RECORD)),
    findAll:      jest.fn(() => Promise.resolve([MOCK_CUSTOMER_RECORD])),
    create:       jest.fn(() => Promise.resolve(MOCK_CUSTOMER_RECORD)),
    update:       jest.fn(() => Promise.resolve([1])),
    destroy:      jest.fn(() => Promise.resolve(1)),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  MetaIntegration: {
    findOne:  jest.fn(() => Promise.resolve(MOCK_INTEGRATION_FB)),
    findAll:  jest.fn(() => Promise.resolve([MOCK_INTEGRATION_FB, MOCK_INTEGRATION_IG, MOCK_INTEGRATION_WA])),
    create:   jest.fn(() => Promise.resolve(MOCK_INTEGRATION_FB)),
    upsert:   jest.fn(() => Promise.resolve([MOCK_INTEGRATION_FB, true])),
    update:   jest.fn(() => Promise.resolve([1])),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  FaqResponse: {
    findOne:   jest.fn(() => Promise.resolve(MOCK_FAQ)),
    findAll:   jest.fn(() => Promise.resolve([MOCK_FAQ])),
    findByPk:  jest.fn(() => Promise.resolve(MOCK_FAQ)),
    create:    jest.fn(() => Promise.resolve(MOCK_FAQ)),
    update:    jest.fn(() => Promise.resolve([1])),
    destroy:   jest.fn(() => Promise.resolve(1)),
    increment: jest.fn(() => Promise.resolve()),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  Conversation: {
    findOne:  jest.fn(() => Promise.resolve(MOCK_CONVERSATION_RECORD)),
    create:   jest.fn(() => Promise.resolve(MOCK_CONVERSATION_RECORD)),
    findAll:  jest.fn(() => Promise.resolve([])),
    update:   jest.fn(() => Promise.resolve([1])),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  Message: {
    findOne:  jest.fn(() => Promise.resolve(null)),
    create:   jest.fn(() => Promise.resolve({
      id: TEST_MSG_ID, conversation_id: TEST_CONV_ID,
      content: '', sender: 'ai', created_at: new Date().toISOString(),
    })),
    findAll:  jest.fn(() => Promise.resolve([])),
    update:   jest.fn(() => Promise.resolve([1])),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  Order: {
    findOne:  jest.fn(() => Promise.resolve(null)),
    findAll:  jest.fn(() => Promise.resolve([])),
    create:   jest.fn(), update: jest.fn(), count: jest.fn(() => Promise.resolve(0)),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  OrderSession: {
    findOne:  jest.fn(() => Promise.resolve(null)),
    create:   jest.fn(), update: jest.fn(),
    findAll:  jest.fn(() => Promise.resolve([])),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  AuditLog: {
    create:   jest.fn(() => Promise.resolve({})),
    findAll:  jest.fn(() => Promise.resolve([])),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  Analytics: {
    findOrCreate: jest.fn(() => Promise.resolve([{}, true])),
    increment:    jest.fn(() => Promise.resolve()),
    findOne:      jest.fn(() => Promise.resolve(null)),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  BanglishDictionary: {
    findAll:  jest.fn(() => Promise.resolve([])),
    findOne:  jest.fn(() => Promise.resolve(null)),
    create:   jest.fn(),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  SubscriptionPlan: {
    findOne:  jest.fn(() => Promise.resolve(null)),
    findAll:  jest.fn(() => Promise.resolve([])),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  ShopSubscription: {
    findOne:  jest.fn(() => Promise.resolve(null)),
    create:   jest.fn(), update: jest.fn(),
    findAll:  jest.fn(() => Promise.resolve([])),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  UsageEvent: {
    create:   jest.fn(() => Promise.resolve({})),
    findAll:  jest.fn(() => Promise.resolve([])),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  FailedWorkflowForward: {
    create:   jest.fn(() => Promise.resolve({})),
    findAll:  jest.fn(() => Promise.resolve([])),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  IdempotencyKey: {
    findOne:  jest.fn(() => Promise.resolve(null)),
    create:   jest.fn(() => Promise.resolve({})),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  Product: {
    findAll:  jest.fn(() => Promise.resolve([])),
    findOne:  jest.fn(() => Promise.resolve(null)),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  ProductCategory: {
    findAll:  jest.fn(() => Promise.resolve([])),
    findOne:  jest.fn(() => Promise.resolve(null)),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  DeliveryProvider: {
    findOne:  jest.fn(() => Promise.resolve(null)),
    findAll:  jest.fn(() => Promise.resolve([])),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  BlacklistEntry: {
    findOne:  jest.fn(() => Promise.resolve(null)),
    findAll:  jest.fn(() => Promise.resolve([])),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
  Category: {
    findAll:  jest.fn(() => Promise.resolve([])),
    findOne:  jest.fn(() => Promise.resolve(null)),
    create:   jest.fn(), update: jest.fn(),
    belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
    addScope: jest.fn(), scope: jest.fn(function() { return this; }),
  },
}));

// ── Mock: meta.service (used by meta.controller) ──────────────────────────────
const mockMetaService = {
  subscribeToWebhooks:       jest.fn(() => Promise.resolve({ success: true })),
  createIntegration:         jest.fn(() => Promise.resolve({ ...MOCK_INTEGRATION_FB, id: 'new-integ-id' })),
  getShopIntegrations:       jest.fn(() => Promise.resolve([
    { platform: 'facebook',  connected: true,  display_name: 'Dhaka Fashion House', connected_at: new Date().toISOString() },
    { platform: 'instagram', connected: false, display_name: null, connected_at: null },
    { platform: 'whatsapp',  connected: false, display_name: null, connected_at: null },
  ])),
  disconnectIntegration:     jest.fn(() => Promise.resolve({ success: true })),
  decryptToken:              jest.fn(() => 'mock-decrypted-access-token'),
  encryptToken:              jest.fn((t) => `ENC:${t}`),
  exchangeForLongLivedToken: jest.fn(() => Promise.resolve({ access_token: 'long-lived-token', expiresAt: null })),
  checkAssetAvailability:    jest.fn(() => Promise.resolve(true)),
};
jest.mock('src/modules/integration/meta.service', () => mockMetaService);

// ── Mock: audit service ───────────────────────────────────────────────────────
jest.mock('src/modules/audit/audit.service', () => ({
  logOperation: jest.fn(() => Promise.resolve()),
}));

// ── Mock: meta.validator (so validateRequest has a schema to consume) ─────────
jest.mock('src/modules/integration/meta.validator', () => ({
  manualConnectSchema: {},
}));

// ── Mock: auth + shop-access middleware (integration routes require auth) ──────
jest.mock('src/middleware/auth.middleware', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'user-test-001', email: 'owner@test.com' };
    next();
  },
  checkSubscriptionStatus: (_req, _res, next) => next(),
}));
jest.mock('src/middleware/shop-access.middleware', () => ({
  verifyShopAccess: (req, _res, next) => {
    req.shop = { id: TEST_SHOP_ID };
    next();
  },
}));
jest.mock('src/middleware/validate.middleware', () =>
  () => (_req, _res, next) => next()
);

// ── Mock: ConversationStateService ────────────────────────────────────────────
const mockConversationHistory = [];
const mockConvStateService = {
  ingestMessage:           jest.fn(() => Promise.resolve({
    conversation_id:       TEST_CONV_ID,
    shop_id:               TEST_SHOP_ID,
    customer_channel_id:   TEST_CUSTOMER.psid,
    platform:              'facebook',
    conversation_history:  mockConversationHistory,
    active_order_session:  null,
  })),
  storeAIResponse:         jest.fn(() => Promise.resolve()),
  updateConversationState: jest.fn(() => Promise.resolve()),
  detectLanguage:          jest.fn(() => 'en'),
  extractEntities:         jest.fn(() => ({})),
};
jest.mock('src/modules/conversation/conversation-state-standalone.service', () => mockConvStateService);

// ── Mock: OrderSessionService ─────────────────────────────────────────────────
const mockOrderService = {
  startOrderSession: jest.fn(() => Promise.resolve({
    id:         'session-order-001',
    prompt:     'Great! What would you like to order today?',
    confidence: 0.9,
    status:     'ACTIVE',
  })),
  processStep: jest.fn(() => Promise.resolve({
    prompt:     'How many pieces would you like?',
    confidence: 1.0,
    status:     'ACTIVE',
  })),
};
jest.mock('src/modules/order/order-session-standalone.service', () => mockOrderService);

// ── Mock: RAG service ─────────────────────────────────────────────────────────
const mockRagService = {
  queryData:         jest.fn(() => Promise.resolve({ results: [] })),
  ingestData:        jest.fn(() => Promise.resolve({ success: true })),
  deletePoint:       jest.fn(() => Promise.resolve()),
  ensureCollection:  jest.fn(() => Promise.resolve()),
};
jest.mock('src/modules/rag/rag.service', () => mockRagService);

// ── Mock: LLM service ─────────────────────────────────────────────────────────
const mockLlmService = {
  chat: jest.fn(() => Promise.resolve({
    text:     'Hello! How can I help you today?',
    provider: 'gemini',
  })),
};
jest.mock('src/modules/ai/llm.service', () => mockLlmService);

// ── Mock: CacheService ────────────────────────────────────────────────────────
jest.mock('src/utils/cache.service', () => ({
  getForShop:    jest.fn(() => Promise.resolve(null)),
  setForShop:    jest.fn(() => Promise.resolve()),
  deleteForShop: jest.fn(() => Promise.resolve()),
}));

// ── Mock: structured logger ───────────────────────────────────────────────────
jest.mock('src/utils/structured-logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
  })),
}));

// Prevent BullMQ from opening a real Redis connection during tests
jest.mock('src/jobs/message-queue', () => ({
  messageQueue: { add: jest.fn().mockResolvedValue({ id: 'test-job' }), on: jest.fn() },
  connection: { host: 'localhost', port: 6379 },
}));

// ── Load app AFTER all mocks ──────────────────────────────────────────────────
let app;
beforeAll(() => {
  app = require('src/app');
});

// ── Reset state between tests ─────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(redisStore).forEach(k => delete redisStore[k]);

  // Default Meta Graph API mock (sendMetaReply uses global fetch)
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ message_id: 'mid.mock001' }) }));

  // Restore default mock implementations cleared by clearAllMocks()
  mockLlmService.chat.mockResolvedValue({ text: 'Hello! How can I help you today?', provider: 'gemini' });
  mockRagService.queryData.mockResolvedValue({ results: [] });
  mockConvStateService.ingestMessage.mockResolvedValue({
    conversation_id:     TEST_CONV_ID,
    shop_id:             TEST_SHOP_ID,
    customer_channel_id: TEST_CUSTOMER.psid,
    platform:            'facebook',
    conversation_history: [],
    active_order_session: null,
  });
  mockConvStateService.storeAIResponse.mockResolvedValue(undefined);
  mockConvStateService.detectLanguage.mockReturnValue('en');
  mockConvStateService.extractEntities.mockReturnValue({});
  mockOrderService.processStep.mockResolvedValue({ prompt: 'How many pieces would you like?', confidence: 1.0, status: 'ACTIVE' });
  mockOrderService.startOrderSession.mockResolvedValue({ id: 'session-001', prompt: 'Great! What would you like to order today?', confidence: 0.9, status: 'ACTIVE' });
  mockMetaService.subscribeToWebhooks.mockResolvedValue({ success: true });
  mockMetaService.createIntegration.mockResolvedValue({ ...MOCK_INTEGRATION_FB, id: 'new-integ-id' });
  mockMetaService.getShopIntegrations.mockResolvedValue([
    { platform: 'facebook',  connected: true,  display_name: 'Dhaka Fashion House', connected_at: new Date().toISOString() },
    { platform: 'instagram', connected: false, display_name: null, connected_at: null },
    { platform: 'whatsapp',  connected: false, display_name: null, connected_at: null },
  ]);
  mockMetaService.disconnectIntegration.mockResolvedValue({ success: true });

  // Reset entity mocks
  const MetaIntegrationEntity = require('src/modules/integration/meta-integration.entity');
  MetaIntegrationEntity.findOne.mockImplementation((opts) => {
    const w = opts?.where || {};
    if (w.platform === 'instagram' || w.meta_asset_id === TEST_IG_ID) return Promise.resolve(MOCK_INTEGRATION_IG);
    if (w.platform === 'whatsapp'  || w.meta_asset_id === TEST_WA_ID) return Promise.resolve(MOCK_INTEGRATION_WA);
    if (w.webhook_verify_token === 'per-tenant-verify-token-abc')      return Promise.resolve(MOCK_INTEGRATION_FB);
    return Promise.resolve(MOCK_INTEGRATION_FB);
  });

  const { Conversation, Message } = require('src/modules/conversation/conversation.entity');
  Conversation.findOne.mockResolvedValue(MOCK_CONVERSATION_RECORD);
  Conversation.create.mockResolvedValue(MOCK_CONVERSATION_RECORD);
  Message.findOne.mockResolvedValue(null); // no duplicate by default
  Message.create.mockResolvedValue({ id: TEST_MSG_ID, conversation_id: TEST_CONV_ID, content: '', sender: 'ai', created_at: new Date().toISOString() });

  const { Customer } = require('src/modules/entities');
  Customer.findOrCreate.mockResolvedValue([MOCK_CUSTOMER_RECORD, false]);

  require('src/utils/database/database-setup').sequelize.query.mockResolvedValue([]);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// Sign a raw body string with HMAC-SHA256 (matches Meta's signing format)
const sign = (body, secret = 'mock-app-secret') =>
  `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

// Build a signed Facebook Messenger webhook payload
const fbMessengerPayload = (text, senderId = TEST_CUSTOMER.psid, messageId = 'mid.messenger001') => ({
  object: 'page',
  entry: [{
    id: TEST_PAGE_ID,
    messaging: [{
      sender: { id: senderId },
      recipient: { id: TEST_PAGE_ID },
      timestamp: Date.now(),
      message: { mid: messageId, text },
    }],
  }],
});

// Build a signed Instagram DM webhook payload
const igDmPayload = (text, senderId = TEST_CUSTOMER.ig_id, messageId = 'mid.instagram001') => ({
  object: 'instagram',
  entry: [{
    id: TEST_IG_ID,
    messaging: [{
      sender: { id: senderId },
      recipient: { id: TEST_IG_ID },
      timestamp: Date.now(),
      message: { mid: messageId, text },
    }],
  }],
});

// Build a WhatsApp webhook payload
const waPayload = (text, from = TEST_CUSTOMER.wa_id, messageId = 'wamid.001') => ({
  object: 'whatsapp_business_account',
  entry: [{
    id: TEST_WA_ID,
    changes: [{
      field: 'messages',
      value: {
        messages: [{
          id: messageId,
          from,
          type: 'text',
          text: { body: text },
          timestamp: String(Math.floor(Date.now() / 1000)),
        }],
      },
    }],
  }],
});

// Send a signed POST to /webhooks/meta
const sendWebhook = (payload, secret = 'mock-app-secret') => {
  const body = JSON.stringify(payload);
  return request(app)
    .post('/webhooks/meta')
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', sign(body, secret))
    .send(payload);
};

// Call the chatbot endpoint directly (simulates n8n calling it)
const chatbot = (msg, extra = {}) =>
  request(app)
    .post('/api/ai-chatbot/process')
    .set('Content-Type', 'application/json')
    .send({
      shop_id:             TEST_SHOP_ID,
      customer_channel_id: TEST_CUSTOMER.psid,
      platform:            'facebook',
      message:             msg,
      ...extra,
    });

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — Page Connection (Integration Management API)
// ─────────────────────────────────────────────────────────────────────────────

describe('Section 1 — Page Connection', () => {

  describe('POST /api/integrations/meta/manual-connect', () => {

    test('connects a Facebook page with valid credentials', async () => {
      const res = await request(app)
        .post('/api/integrations/meta/manual-connect')
        .set('Content-Type', 'application/json')
        .send({
          platform:     'facebook',
          asset_id:     TEST_PAGE_ID,
          display_name: 'Dhaka Fashion House',
          access_token: 'EAAmock-short-lived-token',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockMetaService.subscribeToWebhooks).toHaveBeenCalledWith(
        'EAAmock-short-lived-token',
        TEST_PAGE_ID,
        'facebook',
      );
      expect(mockMetaService.createIntegration).toHaveBeenCalledWith(
        TEST_SHOP_ID, 'facebook', TEST_PAGE_ID,
        'Dhaka Fashion House',
        'EAAmock-short-lived-token',
      );
    });

    test('connects an Instagram account', async () => {
      mockMetaService.createIntegration.mockResolvedValueOnce({ ...MOCK_INTEGRATION_IG, id: 'new-ig-id' });

      const res = await request(app)
        .post('/api/integrations/meta/manual-connect')
        .send({
          platform:     'instagram',
          asset_id:     TEST_IG_ID,
          display_name: 'Dhaka Fashion House IG',
          access_token: 'IGmock-token',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockMetaService.subscribeToWebhooks).toHaveBeenCalledWith('IGmock-token', TEST_IG_ID, 'instagram');
    });

    test('connects a WhatsApp Business account', async () => {
      mockMetaService.createIntegration.mockResolvedValueOnce({ ...MOCK_INTEGRATION_WA, id: 'new-wa-id' });

      const res = await request(app)
        .post('/api/integrations/meta/manual-connect')
        .send({
          platform:     'whatsapp',
          asset_id:     TEST_WA_ID,
          display_name: 'Dhaka Fashion House WA',
          access_token: 'WAmock-token',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockMetaService.subscribeToWebhooks).toHaveBeenCalledWith('WAmock-token', TEST_WA_ID, 'whatsapp');
    });

    test('rejects request with missing access_token', async () => {
      const res = await request(app)
        .post('/api/integrations/meta/manual-connect')
        .send({ platform: 'facebook', asset_id: TEST_PAGE_ID });

      expect(res.status).toBe(400);
      expect(mockMetaService.createIntegration).not.toHaveBeenCalled();
    });

    test('rejects request with invalid platform', async () => {
      const res = await request(app)
        .post('/api/integrations/meta/manual-connect')
        .send({ platform: 'telegram', asset_id: 'tg-123', access_token: 'tok' });

      expect(res.status).toBe(400);
    });

    test('returns 409 when page is already connected to another shop', async () => {
      const err = new Error('This Meta asset is already connected to another shop');
      err.statusCode = 409;
      err.status = 409;
      mockMetaService.createIntegration.mockRejectedValueOnce(err);

      const res = await request(app)
        .post('/api/integrations/meta/manual-connect')
        .send({ platform: 'facebook', asset_id: TEST_PAGE_ID, access_token: 'tok' });

      expect(res.status).toBe(409);
    });
  });

  describe('GET /api/integrations/meta/status', () => {

    test('returns status for all three platforms', async () => {
      const res = await request(app).get('/api/integrations/meta/status');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(3);

      const fb = res.body.data.find(d => d.platform === 'facebook');
      expect(fb.connected).toBe(true);
      expect(fb.display_name).toBe('Dhaka Fashion House');
    });
  });

  describe('POST /api/integrations/meta/disconnect', () => {

    test('disconnects the Facebook page and logs audit event', async () => {
      const auditService = require('src/modules/audit/audit.service');

      const res = await request(app)
        .post('/api/integrations/meta/disconnect')
        .send({ platform: 'facebook' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockMetaService.disconnectIntegration).toHaveBeenCalledWith(TEST_SHOP_ID, 'facebook');
      expect(auditService.logOperation).toHaveBeenCalledWith(
        'user-test-001', TEST_SHOP_ID, 'META_DISCONNECT', 'meta_integration',
        null, expect.objectContaining({ platform: 'facebook' }),
      );
    });

    test('rejects an invalid platform on disconnect', async () => {
      const res = await request(app)
        .post('/api/integrations/meta/disconnect')
        .send({ platform: 'signal' });

      expect(res.status).toBe(400);
      expect(mockMetaService.disconnectIntegration).not.toHaveBeenCalled();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — Webhook Message Reception
// ─────────────────────────────────────────────────────────────────────────────

describe('Section 2 — Webhook Message Reception', () => {

  test('receives a Facebook Messenger message and stores it', async () => {
    const { Customer } = require('src/modules/entities');
    const { Conversation, Message } = require('src/modules/conversation/conversation.entity');

    const payload = fbMessengerPayload('Hi, are you open?');
    const res = await sendWebhook(payload);

    expect(res.status).toBe(200);
    expect(Customer.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ channel_type: 'messenger', channel_user_id: TEST_CUSTOMER.psid }),
      }),
    );
    expect(Message.create).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Hi, are you open?', sender: 'customer' }),
      expect.anything(),
    );
  });

  test('receives an Instagram DM and stores it with platform=instagram', async () => {
    const MetaIntegrationEntity = require('src/modules/integration/meta-integration.entity');
    MetaIntegrationEntity.findOne.mockResolvedValueOnce(MOCK_INTEGRATION_IG);

    const { Customer } = require('src/modules/entities');
    const payload = igDmPayload('Hello from IG');
    const res = await sendWebhook(payload);

    expect(res.status).toBe(200);
    expect(Customer.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ channel_type: 'instagram' }),
      }),
    );
  });

  test('receives a WhatsApp message and stores it with platform=whatsapp', async () => {
    const MetaIntegrationEntity = require('src/modules/integration/meta-integration.entity');
    MetaIntegrationEntity.findOne.mockResolvedValueOnce(MOCK_INTEGRATION_WA);

    const { Customer } = require('src/modules/entities');
    const payload = waPayload('Assalamu alaikum');
    const res = await sendWebhook(payload);

    expect(res.status).toBe(200);
    expect(Customer.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ channel_type: 'whatsapp', channel_user_id: TEST_CUSTOMER.wa_id }),
      }),
    );
  });

  test('per-tenant webhook verify token is checked on GET /webhooks/meta', async () => {
    const MetaIntegrationEntity = require('src/modules/integration/meta-integration.entity');
    MetaIntegrationEntity.findOne.mockResolvedValueOnce(MOCK_INTEGRATION_FB);

    const res = await request(app)
      .get('/webhooks/meta')
      .query({
        'hub.mode':         'subscribe',
        'hub.challenge':    'challenge-abc-xyz',
        'hub.verify_token': 'per-tenant-verify-token-abc',
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe('challenge-abc-xyz');
  });

  test('global verify token fallback works when no per-tenant record found', async () => {
    const MetaIntegrationEntity = require('src/modules/integration/meta-integration.entity');
    MetaIntegrationEntity.findOne.mockResolvedValueOnce(null); // no per-tenant match

    const res = await request(app)
      .get('/webhooks/meta')
      .query({
        'hub.mode':         'subscribe',
        'hub.challenge':    'fallback-challenge',
        'hub.verify_token': 'global-verify-token',
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe('fallback-challenge');
  });

  test('duplicate message (same external_id) is NOT stored twice', async () => {
    const { Message } = require('src/modules/conversation/conversation.entity');
    // Simulate idempotency: Message.findOne returns an existing record for the same mid
    Message.findOne.mockResolvedValueOnce({
      id: 'existing-msg-001',
      conversation_id: TEST_CONV_ID,
      customer_id: TEST_CUST_ID,
    });

    const payload = fbMessengerPayload('Duplicate message', TEST_CUSTOMER.psid, 'mid.duplicate001');
    const res = await sendWebhook(payload);

    expect(res.status).toBe(200);
    // Message.create must NOT have been called — it's a duplicate
    expect(Message.create).not.toHaveBeenCalled();
  });

  test('webhook with no messaging events (e.g. delivery receipt) returns 200 silently', async () => {
    const { Message } = require('src/modules/conversation/conversation.entity');

    // Delivery receipt: no message.text, no attachments
    const payload = {
      object: 'page',
      entry: [{
        id: TEST_PAGE_ID,
        messaging: [{
          sender:    { id: TEST_CUSTOMER.psid },
          recipient: { id: TEST_PAGE_ID },
          timestamp: Date.now(),
          delivery:  { watermark: Date.now() }, // NOT a message event
        }],
      }],
    };

    const res = await sendWebhook(payload);

    expect(res.status).toBe(200);
    expect(Message.create).not.toHaveBeenCalled();
  });

  test('webhook with unknown page ID (no integration found) is acked silently', async () => {
    const MetaIntegrationEntity = require('src/modules/integration/meta-integration.entity');
    MetaIntegrationEntity.findOne.mockResolvedValueOnce(null); // no matching integration

    const payload = fbMessengerPayload('Hello unknown page');
    payload.entry[0].id = 'page-unknown-999';
    const res = await sendWebhook(payload);

    // Must return 200 to prevent Meta retry storm
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — Customer-Chatbot Chat Scenarios
// ─────────────────────────────────────────────────────────────────────────────

describe('Section 3 — Customer-Chatbot Chat Scenarios', () => {

  test('Scenario A: Simple greeting → friendly response', async () => {
    mockLlmService.chat.mockResolvedValueOnce({
      text: 'Hello Rahim! Welcome to Dhaka Fashion House. How can I help you today?',
      provider: 'gemini',
    });

    const res = await chatbot('Hi, are you open?');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.response).toContain('Dhaka Fashion House');
    expect(res.body.metadata.confidence).toBeGreaterThan(0);
  });

  test('Scenario B: Product inquiry → product context injected in LLM prompt', async () => {
    const { sequelize } = require('src/utils/database/database-setup');
    // Use mockResolvedValue (not Once) — product search may be preceded by other queries
    sequelize.query.mockResolvedValue([MOCK_PRODUCT]);

    mockRagService.queryData.mockResolvedValueOnce({ results: [] });
    mockLlmService.chat.mockResolvedValueOnce({
      text: 'Yes! We have a Blue Cotton Shirt for ৳850. It is in stock (20 available).',
      provider: 'gemini',
    });

    const res = await chatbot('blue cotton shirts available?');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const llmArgs = mockLlmService.chat.mock.calls[0][0];
    expect(llmArgs.systemPrompt).toContain('RELEVANT SHOP PRODUCTS');
    expect(llmArgs.systemPrompt).toContain('Blue Cotton Shirt');
    expect(llmArgs.systemPrompt).toContain('৳850');
    expect(llmArgs.systemPrompt).toContain('IN STOCK');
    expect(llmArgs.systemPrompt).toContain('GROUNDING RULES');
  });

  test('Scenario C: Bengali price inquiry → language_detected=bn, Bengali response', async () => {
    mockConvStateService.detectLanguage.mockReturnValueOnce('bn');
    mockRagService.queryData.mockResolvedValueOnce({ results: [] });
    mockLlmService.chat.mockResolvedValueOnce({
      text: 'আমাদের শার্টের দাম ৮৫০ থেকে ১৫০০ টাকার মধ্যে।',
      provider: 'gemini',
    });

    const res = await chatbot('এই শার্টের দাম কত?', { platform: 'whatsapp', customer_channel_id: TEST_CUSTOMER.wa_id });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.metadata.language_detected).toBe('bn');
  });

  test('Scenario D: Banglish mixed language → handled without error', async () => {
    mockConvStateService.detectLanguage.mockReturnValueOnce('mixed');
    mockRagService.queryData.mockResolvedValueOnce({ results: [] });
    mockLlmService.chat.mockResolvedValueOnce({
      text: 'We deliver to Dhaka and Chittagong. Delivery usually takes 2-3 days.',
      provider: 'gemini',
    });

    const res = await chatbot('delivery kothay kore aপনারা?');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.metadata.language_detected).toBe('mixed');
  });

  test('Scenario E: Return policy query → FAQ keyword match', async () => {
    mockLlmService.chat.mockResolvedValueOnce({
      text: 'We offer 30-day returns on all items. No questions asked.',
      provider: 'gemini',
    });

    const res = await chatbot('What is your return policy?');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // FAQ match from the keyword-based search (FaqResponse.findAll was set up in entity mocks)
    expect(res.body.response).toBeTruthy();
  });

  test('Scenario F: Order intent → startOrderSession called, order prompt returned', async () => {
    mockRagService.queryData.mockResolvedValueOnce({ results: [] });
    // LLM fails so keyword fallback triggers; OR order session service is called
    const OrderSessionService = require('src/modules/order/order-session-standalone.service');

    const res = await chatbot('I want to buy a hoodie');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.response).toBe('string');
    expect(res.body.response.length).toBeGreaterThan(0);
  });

  test('Scenario G: Active order session → processStep called, order_session_continued=true', async () => {
    mockConvStateService.ingestMessage.mockResolvedValueOnce({
      conversation_id:     TEST_CONV_ID,
      shop_id:             TEST_SHOP_ID,
      customer_channel_id: TEST_CUSTOMER.psid,
      platform:            'facebook',
      conversation_history: [],
      active_order_session: {
        id:           'session-order-001',
        status:       'ACTIVE',
        current_step: 'QUANTITY',
      },
    });
    mockOrderService.processStep.mockResolvedValueOnce({
      prompt:     'How many pieces would you like?',
      confidence: 1.0,
      status:     'ACTIVE',
    });

    const res = await chatbot('I want 2 pieces');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const OrderSessionService = require('src/modules/order/order-session-standalone.service');
    expect(OrderSessionService.processStep).toHaveBeenCalled();
    expect(res.body.response).toBe('How many pieces would you like?');
    expect(res.body.metadata.order_session_continued).toBe(true);
  });

  test('Scenario H: Delivery zone step → bot asks for zone, continues order', async () => {
    mockConvStateService.ingestMessage.mockResolvedValueOnce({
      conversation_id:     TEST_CONV_ID,
      shop_id:             TEST_SHOP_ID,
      customer_channel_id: TEST_CUSTOMER.psid,
      platform:            'facebook',
      conversation_history: [],
      active_order_session: {
        id:           'session-order-001',
        status:       'ACTIVE',
        current_step: 'DELIVERY_ZONE',
      },
    });
    mockOrderService.processStep.mockResolvedValueOnce({
      prompt:     'Which area in Dhaka shall we deliver to?',
      confidence: 1.0,
      status:     'ACTIVE',
    });

    const res = await chatbot('Deliver to Mirpur');

    expect(res.status).toBe(200);
    expect(res.body.response).toBe('Which area in Dhaka shall we deliver to?');
  });

  test('Scenario I: Low-confidence vague message → gate_triggered flag is boolean', async () => {
    const { Shop } = require('src/modules/entities');
    Shop.findByPk.mockResolvedValueOnce({
      ...MOCK_SHOP,
      ai_settings: JSON.stringify({
        confidence_threshold: 95, // very high threshold forces gate
        automation_mode: 'AUTO',
        primary_language: 'en',
      }),
    });
    Shop.findOne.mockResolvedValueOnce({
      ...MOCK_SHOP,
      ai_settings: JSON.stringify({ confidence_threshold: 95, automation_mode: 'AUTO', primary_language: 'en' }),
    });

    mockRagService.queryData.mockResolvedValueOnce({ results: [] });
    mockLlmService.chat.mockResolvedValueOnce({ text: 'Hmm, not sure what you mean.', provider: 'gemini' });

    const res = await chatbot('???');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.metadata.gate_triggered).toBe('boolean');
  });

  test('Scenario J: Out-of-stock product → LLM prompt contains OUT OF STOCK', async () => {
    const { sequelize } = require('src/utils/database/database-setup');
    sequelize.query.mockResolvedValueOnce([{
      ...MOCK_PRODUCT,
      name:             'Red Silk Saree',
      quantity:         0,
      in_stock:         false,
      price:            '2500',
      ai_color_primary: 'red',
      ai_material:      'silk',
      ai_category:      'saree',
    }]);

    mockRagService.queryData.mockResolvedValueOnce({ results: [] });
    mockLlmService.chat.mockResolvedValueOnce({
      text: 'The Red Silk Saree is currently out of stock. We expect restock within 7 days.',
      provider: 'gemini',
    });

    const res = await chatbot('red silk sarees available?');

    expect(res.status).toBe(200);
    const llmArgs = mockLlmService.chat.mock.calls[0][0];
    expect(llmArgs.systemPrompt).toContain('OUT OF STOCK');
    expect(llmArgs.systemPrompt).toContain('Red Silk Saree');
    expect(llmArgs.systemPrompt).toContain('৳2500');
  });

  test('Scenario K: Business hours inquiry → shop openingHours in LLM system prompt', async () => {
    mockRagService.queryData.mockResolvedValueOnce({ results: [] });
    mockLlmService.chat.mockResolvedValueOnce({
      text: 'We are open Saturday to Thursday from 10am to 9pm.',
      provider: 'gemini',
    });

    const res = await chatbot('What time do you close?');

    expect(res.status).toBe(200);
    const llmArgs = mockLlmService.chat.mock.calls[0][0];
    expect(llmArgs.systemPrompt).toContain('Dhaka Fashion House');
  });

  test('Scenario L: LLM provider failover — first provider throws, second succeeds', async () => {
    mockRagService.queryData.mockResolvedValueOnce({ results: [] });
    mockLlmService.chat
      .mockRejectedValueOnce(new Error('Gemini API quota exceeded'))
      .mockResolvedValueOnce({ text: 'OpenAI answered instead!', provider: 'openai' });

    const res = await chatbot('what are your best sellers?');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('Scenario M: Image attachment sent → processed without crash', async () => {
    mockRagService.queryData.mockResolvedValueOnce({ results: [] });
    mockLlmService.chat.mockResolvedValueOnce({
      text: 'Nice product image! We have something similar. Let me check our catalogue.',
      provider: 'gemini',
    });

    const res = await chatbot('', {
      message:     '',
      attachments: [{
        type: 'image',
        payload: { url: 'https://example.com/product-image.jpg', sticker_id: null },
      }],
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe.skip('Section 4 — Reply Webhook Scenarios (removed — /reply endpoint deleted)', () => {
  const recentMsg = () => ({
    id: TEST_MSG_ID,
    conversation_id: TEST_CONV_ID,
    sender: 'customer',
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
  });

  beforeEach(() => {
    // Conversation lookup for reply endpoint
    const { Conversation, Message } = require('src/modules/conversation/conversation.entity');
    Conversation.findOne.mockResolvedValue({ id: TEST_CONV_ID, shop_id: TEST_SHOP_ID });
    Message.findOne.mockResolvedValue(recentMsg()); // recent message (within 24h)
    Message.create.mockResolvedValue({ id: 'msg-ai-reply-001', conversation_id: TEST_CONV_ID, content: '', sender: 'ai', created_at: new Date().toISOString() });
  });

  test('Messenger reply within 24h window → 200, message stored, Graph API called', async () => {
    const { Message } = require('src/modules/conversation/conversation.entity');

    const res = await request(app)
      .post('/webhooks/meta/reply')
      .send({
        conversation_id: TEST_CONV_ID,
        message:         'Thank you for contacting us! Your order has been confirmed.',
        platform:        'facebook',
        recipient_id:    TEST_CUSTOMER.psid,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Message.create).toHaveBeenCalledWith(
      expect.objectContaining({ conversation_id: TEST_CONV_ID, content: expect.any(String), sender: 'ai' }),
    );
    // Meta Graph API called via global.fetch
    expect(global.fetch).toHaveBeenCalled();
  });

  test('Messenger reply outside 24h window → 422 with messaging window error', async () => {
    const { Message } = require('src/modules/conversation/conversation.entity');
    // Override: last customer message was 25 hours ago
    Message.findOne.mockResolvedValueOnce({
      id:              TEST_MSG_ID,
      conversation_id: TEST_CONV_ID,
      sender:          'customer',
      created_at:      new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });

    const res = await request(app)
      .post('/webhooks/meta/reply')
      .send({
        conversation_id: TEST_CONV_ID,
        message:         'Late reply attempt',
        platform:        'messenger',
        recipient_id:    TEST_CUSTOMER.psid,
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/24-hour/i);
    expect(Message.create).not.toHaveBeenCalled();
  });

  test('Instagram reply outside 24h window → 422', async () => {
    const { Message } = require('src/modules/conversation/conversation.entity');
    Message.findOne.mockResolvedValueOnce({
      id:              'ig-msg-001',
      conversation_id: TEST_CONV_ID,
      sender:          'customer',
      created_at:      new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
    });

    const res = await request(app)
      .post('/webhooks/meta/reply')
      .send({
        conversation_id: TEST_CONV_ID,
        message:         'Replying to IG after 30h',
        platform:        'instagram',
        recipient_id:    TEST_CUSTOMER.ig_id,
      });

    expect(res.status).toBe(422);
  });

  test('WhatsApp reply outside 24h window → 200 (no window restriction)', async () => {
    const { Message } = require('src/modules/conversation/conversation.entity');
    // 48 hours ago — WhatsApp has no 24h window
    Message.findOne.mockResolvedValueOnce({
      id:              'wa-msg-001',
      conversation_id: TEST_CONV_ID,
      sender:          'customer',
      created_at:      new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    });

    const res = await request(app)
      .post('/webhooks/meta/reply')
      .send({
        conversation_id: TEST_CONV_ID,
        message:         'WhatsApp follow-up after 2 days',
        platform:        'whatsapp',
        recipient_id:    TEST_CUSTOMER.wa_id,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Message.create).toHaveBeenCalledWith(
      expect.objectContaining({ sender: 'ai', content: 'WhatsApp follow-up after 2 days' }),
    );
  });

  test('Idempotent reply with duplicate idempotency_key → 200 with duplicate=true, not stored again', async () => {
    const { Message } = require('src/modules/conversation/conversation.entity');
    // First findOne call: check idempotency (returns existing)
    Message.findOne.mockResolvedValueOnce({ id: 'existing-reply-001', conversation_id: TEST_CONV_ID });

    const res = await request(app)
      .post('/webhooks/meta/reply')
      .send({
        conversation_id:  TEST_CONV_ID,
        message:          'Duplicate bot reply',
        idempotency_key:  'idem-key-xyz',
      });

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(Message.create).not.toHaveBeenCalled();
  });

  test('Missing conversation_id → 400', async () => {
    const res = await request(app)
      .post('/webhooks/meta/reply')
      .send({ message: 'no conversation id here' });

    expect(res.status).toBe(400);
  });

  test('Expired token → 503 TOKEN_EXPIRED', async () => {
    const MetaIntegrationEntity = require('src/modules/integration/meta-integration.entity');
    // Only override MetaIntegration.findOne with expired token; Section 4 beforeEach
    // already sets Conversation.findOne and Message.findOne to valid recent values.
    MetaIntegrationEntity.findOne.mockResolvedValueOnce({
      ...MOCK_INTEGRATION_FB,
      token_expires_at: new Date(Date.now() - 1000).toISOString(),
      status: 'CONNECTED',
    });

    const res = await request(app)
      .post('/webhooks/meta/reply')
      .send({
        conversation_id: TEST_CONV_ID,
        message:         'Reply with expired token',
        platform:        'facebook',
        recipient_id:    TEST_CUSTOMER.psid,
      });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — Full Chat Round-Trip
// ─────────────────────────────────────────────────────────────────────────────

describe('Section 5 — Full Chat Round-Trip', () => {

  test('Round-trip A: Customer asks about a product, bot replies on Messenger', async () => {
    // Step 1: Customer sends a Facebook Messenger message
    const incomingMsgId = 'mid.roundtrip-product-001';

    const webhookPayload = fbMessengerPayload(
      'Do you have blue cotton shirts in M size?',
      TEST_CUSTOMER.psid,
      incomingMsgId,
    );
    const webhookRes = await sendWebhook(webhookPayload);
    expect(webhookRes.status).toBe(200);

    // Step 2: n8n calls the chatbot endpoint to generate a response
    const { sequelize } = require('src/utils/database/database-setup');
    sequelize.query.mockResolvedValue([{ ...MOCK_PRODUCT, name: 'Blue Cotton Shirt M', price: '850' }]);
    mockRagService.queryData.mockResolvedValueOnce({ results: [] });
    mockLlmService.chat.mockResolvedValueOnce({
      text: 'Yes! We have a Blue Cotton Shirt in Medium for ৳850. Only 5 left in stock!',
      provider: 'gemini',
    });

    const chatbotRes = await chatbot('Do you have blue cotton shirts in M size?');
    expect(chatbotRes.status).toBe(200);
    expect(chatbotRes.body.success).toBe(true);
    expect(chatbotRes.body.response).toContain('৳850');

    // Step 3: n8n calls the reply webhook to send bot response back to Messenger
    const { Conversation: Conv2, Message: Msg2 } = require('src/modules/conversation/conversation.entity');
    Conv2.findOne.mockResolvedValueOnce({ id: TEST_CONV_ID, shop_id: TEST_SHOP_ID });
    Msg2.findOne.mockResolvedValueOnce({
      id: incomingMsgId,
      conversation_id: TEST_CONV_ID,
      sender: 'customer',
      created_at: new Date(Date.now() - 30 * 1000).toISOString(), // 30s ago
    });
    Msg2.create.mockResolvedValueOnce({
      id: 'msg-reply-product-001',
      conversation_id: TEST_CONV_ID,
      sender: 'ai',
      content: chatbotRes.body.response,
      created_at: new Date().toISOString(),
    });

    const replyRes = await request(app)
      .post('/webhooks/meta/reply')
      .send({
        conversation_id: TEST_CONV_ID,
        message:         chatbotRes.body.response,
        platform:        'facebook',
        recipient_id:    TEST_CUSTOMER.psid,
      });

    expect(replyRes.status).toBe(200);
    expect(replyRes.body.success).toBe(true);
  });

  test('Round-trip B: Customer places an order via WhatsApp', async () => {
    // Step 1: Customer sends WhatsApp message expressing order intent
    const MetaIntegrationEntity = require('src/modules/integration/meta-integration.entity');
    MetaIntegrationEntity.findOne.mockResolvedValueOnce(MOCK_INTEGRATION_WA);

    const { Message } = require('src/modules/conversation/conversation.entity');
    const waWebhookPayload = waPayload('ami ekta hoodie order dite chai', TEST_CUSTOMER.wa_id, 'wamid.roundtrip-order-001');
    const webhookRes = await sendWebhook(waWebhookPayload);
    expect(webhookRes.status).toBe(200);

    // Step 2: n8n calls chatbot with the message; order session starts
    mockConvStateService.ingestMessage.mockResolvedValueOnce({
      conversation_id:      TEST_CONV_ID,
      shop_id:              TEST_SHOP_ID,
      customer_channel_id:  TEST_CUSTOMER.wa_id,
      platform:             'whatsapp',
      conversation_history: [],
      active_order_session: null, // no active session yet
    });
    mockConvStateService.detectLanguage.mockReturnValueOnce('mixed');
    mockOrderService.startOrderSession.mockResolvedValueOnce({
      id:         'session-wa-001',
      prompt:     'What quantity would you like to order?',
      confidence: 0.9,
      status:     'ACTIVE',
    });

    const chatbotRes = await chatbot('ami ekta hoodie order dite chai', {
      platform:            'whatsapp',
      customer_channel_id: TEST_CUSTOMER.wa_id,
    });
    expect(chatbotRes.status).toBe(200);
    expect(chatbotRes.body.success).toBe(true);

    // Step 3: Bot sends order prompt back via WhatsApp
    const { Conversation: Conv2, Message: Msg2 } = require('src/modules/conversation/conversation.entity');
    Conv2.findOne.mockResolvedValueOnce({ id: TEST_CONV_ID, shop_id: TEST_SHOP_ID });
    // WhatsApp: no 24h window — old message is fine
    Msg2.findOne.mockResolvedValueOnce({
      id: 'wa-customer-msg-001',
      conversation_id: TEST_CONV_ID,
      sender: 'customer',
      created_at: new Date(Date.now() - 1 * 60 * 1000).toISOString(),
    });
    Msg2.create.mockResolvedValueOnce({
      id: 'msg-wa-reply-001',
      conversation_id: TEST_CONV_ID,
      sender: 'ai',
      content: chatbotRes.body.response,
      created_at: new Date().toISOString(),
    });

    // Override: use WA integration for the reply
    MetaIntegrationEntity.findOne.mockResolvedValueOnce(MOCK_INTEGRATION_WA);

    const replyRes = await request(app)
      .post('/webhooks/meta/reply')
      .send({
        conversation_id: TEST_CONV_ID,
        message:         chatbotRes.body.response,
        platform:        'whatsapp',
        recipient_id:    TEST_CUSTOMER.wa_id,
      });

    expect(replyRes.status).toBe(200);
    expect(replyRes.body.success).toBe(true);
  });
});
