'use strict';

const express = require('express');
const request = require('supertest');

const FOUNDER_ID = '11111111-1111-4111-8111-111111111111';
const EXECUTIVE_ID = '22222222-2222-4222-8222-222222222222';
const MARKETER_ID = '33333333-3333-4333-8333-333333333333';
const FOREIGN_PROSPECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROSPECT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TARGET_PROSPECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SHOP_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const roleHolder = {
  user: null,
  growthRole: null,
};

const mockConfig = {
  growthOsEnabled: true,
  env: 'test',
};

const mockCacheRedis = {
  status: 'ready',
  _isMemoryFallback: false,
};

const mockCacheService = {
  getStrict: jest.fn(async () => null),
  setStrict: jest.fn(async () => true),
};

const mockGrowthRepository = {
  findActiveRoleForUser: jest.fn(async () => (
    roleHolder.growthRole ? { role: roleHolder.growthRole } : null
  )),
  findSafeUserProfile: jest.fn(async (id) => ({
    id,
    full_name: 'Growth Test User',
  })),
};

const mockProspectRows = {};
const mockProspectRepository = {
  listProspects: jest.fn(),
  findProspectById: jest.fn(),
  listProspectEvents: jest.fn(),
};

const mockRoleService = {
  grantRole: jest.fn(),
  revokeRole: jest.fn(),
};

jest.mock('../../../config/config', () => mockConfig);
jest.mock('../../../config/redis', () => ({
  cacheRedis: mockCacheRedis,
  rateLimitRedis: null,
}));
jest.mock('../../../middleware/auth.middleware', () => ({
  authenticate: (req, _res, next) => {
    if (!roleHolder.user) {
      const error = new Error('No token provided. Please authenticate.');
      error.status = 401;
      return next(error);
    }
    req.user = { ...roleHolder.user };
    return next();
  },
}));
jest.mock('../../../utils/cache.service', () => mockCacheService);
jest.mock('../growth-os.repository', () => mockGrowthRepository);
jest.mock('../growth-os.prospect.repository', () => mockProspectRepository);
jest.mock('../growth-os.roles.service', () => mockRoleService);

const prospectService = require('../growth-os.prospect.service');
const growthOsRoutes = require('../growth-os.routes');

function makeProspect(overrides = {}) {
  return {
    id: PROSPECT_ID,
    business_name: 'North Star Retail',
    contact_name: 'Owner Name',
    contact_phone: '01700000000',
    contact_email: 'owner@example.test',
    page_url: 'https://facebook.com/north-star',
    niche: 'retail',
    notes: 'Private working note',
    normalized_business_name: 'north star retail',
    normalized_phone: '+8801700000000',
    normalized_email: 'owner@example.test',
    normalized_page: 'facebook.com/north-star',
    source: 'manual_entry',
    source_detail: 'security-fixture',
    source_reference: null,
    source_recorded_at: new Date('2026-08-20T00:00:00.000Z'),
    status: 'qualified',
    status_changed_at: new Date('2026-08-20T00:00:00.000Z'),
    disqualified_reason: null,
    owner_user_id: EXECUTIVE_ID,
    assigned_at: new Date('2026-08-20T00:00:00.000Z'),
    assigned_by: FOUNDER_ID,
    linked_shop_id: null,
    linked_user_id: null,
    linked_at: null,
    merged_into_id: null,
    merged_at: null,
    created_by: FOUNDER_ID,
    metadata: {},
    created_at: new Date('2026-08-20T00:00:00.000Z'),
    updated_at: new Date('2026-08-20T00:00:00.000Z'),
    ...overrides,
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/internal/growth-os', growthOsRoutes);
  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({
      success: false,
      message: error.message,
      code: error.code,
    });
  });
  return app;
}

function setIdentity({ id, role, mfaVerified = true }) {
  roleHolder.user = {
    userId: id,
    email: `${id}@example.test`,
    shopId: SHOP_ID,
    mfaVerified,
  };
  roleHolder.growthRole = role;
}

function mockMutationServices() {
  jest.spyOn(prospectService, 'create').mockResolvedValue({
    data: prospectService.toApiProspect(makeProspect(), { redacted: false }),
    created: true,
  });
  for (const method of ['update', 'assign', 'transition', 'link', 'merge']) {
    jest.spyOn(prospectService, method).mockResolvedValue(
      prospectService.toApiProspect(makeProspect(), { redacted: false }),
    );
  }
}

describe('Growth OS prospect route security', () => {
  let app;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockConfig.growthOsEnabled = true;
    mockConfig.env = 'test';
    mockCacheRedis.status = 'ready';
    mockCacheRedis._isMemoryFallback = false;
    roleHolder.user = null;
    roleHolder.growthRole = null;

    for (const key of Object.keys(mockProspectRows)) delete mockProspectRows[key];
    mockProspectRows[PROSPECT_ID] = makeProspect();
    mockProspectRows[FOREIGN_PROSPECT_ID] = makeProspect({
      id: FOREIGN_PROSPECT_ID,
      business_name: 'Foreign Prospect',
      normalized_business_name: 'foreign prospect',
      owner_user_id: null,
    });
    mockProspectRows[TARGET_PROSPECT_ID] = makeProspect({
      id: TARGET_PROSPECT_ID,
      business_name: 'Target Prospect',
      normalized_business_name: 'target prospect',
      owner_user_id: null,
    });
    mockProspectRepository.listProspects.mockImplementation(async ({ scope }) => {
      const ownerId = scope?.where?.owner_user_id;
      const rows = Object.values(mockProspectRows).filter((row) => (
        !ownerId || row.owner_user_id === ownerId
      ));
      return { rows, count: rows.length };
    });
    mockProspectRepository.findProspectById.mockImplementation(async (id, { scope } = {}) => {
      const row = mockProspectRows[id];
      const ownerId = scope?.where?.owner_user_id;
      if (!row || (ownerId && row.owner_user_id !== ownerId)) return null;
      return row;
    });
    mockProspectRepository.listProspectEvents.mockResolvedValue([]);
    mockMutationServices();
    app = buildApp();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns 401 for an unauthenticated prospect request', async () => {
    const response = await request(app).get('/api/internal/growth-os/prospects');

    expect(response.status).toBe(401);
    expect(mockProspectRepository.listProspects).not.toHaveBeenCalled();
  });

  it('denies an ordinary merchant without an explicit Growth role', async () => {
    setIdentity({ id: 'merchant-1', role: null, mfaVerified: false });

    const response = await request(app)
      .get('/api/internal/growth-os/prospects')
      .set('X-Frontend-Guard-Claim', 'allowed');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('GROWTH_OS_FORBIDDEN');
    expect(mockProspectRepository.listProspects).not.toHaveBeenCalled();
  });

  it('applies the prospect permission matrix to every Growth role', async () => {
    const roles = [
      'FOUNDER',
      'GROWTH_MANAGER',
      'BUSINESS_EXECUTIVE',
      'MARKETER',
      'CUSTOMER_SUCCESS',
      'READ_ONLY_ANALYST',
    ];
    const readRoles = new Set(['FOUNDER', 'GROWTH_MANAGER', 'BUSINESS_EXECUTIVE', 'MARKETER']);
    const updateRoles = new Set(['FOUNDER', 'GROWTH_MANAGER', 'BUSINESS_EXECUTIVE']);
    const manageRoles = new Set(['FOUNDER', 'GROWTH_MANAGER']);

    for (const role of roles) {
      setIdentity({ id: `${role.toLowerCase()}-1`, role });
      const listResponse = await request(app).get('/api/internal/growth-os/prospects');
      const updateResponse = await request(app)
        .patch(`/api/internal/growth-os/prospects/${PROSPECT_ID}`)
        .send({ businessName: 'Updated name' });
      const statusResponse = await request(app)
        .post(`/api/internal/growth-os/prospects/${PROSPECT_ID}/status`)
        .send({ status: 'contacted' });
      const manageResponse = await request(app)
        .post('/api/internal/growth-os/prospects')
        .send({
          businessName: 'Created name',
          contactPhone: '01700000001',
          source: 'manual_entry',
        });
      const assignResponse = await request(app)
        .post(`/api/internal/growth-os/prospects/${PROSPECT_ID}/assign`)
        .send({ ownerUserId: null, reason: 'Role matrix probe' });
      const linkResponse = await request(app)
        .post(`/api/internal/growth-os/prospects/${PROSPECT_ID}/link`)
        .send({ shopId: SHOP_ID, reason: 'Role matrix probe' });
      const mergeResponse = await request(app)
        .post(`/api/internal/growth-os/prospects/${PROSPECT_ID}/merge`)
        .send({ targetProspectId: TARGET_PROSPECT_ID, reason: 'Role matrix probe' });

      expect(listResponse.status).toBe(readRoles.has(role) ? 200 : 403);
      expect(updateResponse.status).toBe(updateRoles.has(role) ? 200 : 403);
      expect(statusResponse.status).toBe(updateRoles.has(role) ? 200 : 403);
      expect(manageResponse.status).toBe(manageRoles.has(role) ? 201 : 403);
      expect(assignResponse.status).toBe(manageRoles.has(role) ? 200 : 403);
      expect(linkResponse.status).toBe(manageRoles.has(role) ? 200 : 403);
      expect(mergeResponse.status).toBe(manageRoles.has(role) ? 200 : 403);
    }
  });

  it('redacts marketer contact fields while retaining the safe prospect shape', async () => {
    setIdentity({ id: MARKETER_ID, role: 'MARKETER' });

    const response = await request(app).get('/api/internal/growth-os/prospects');
    const item = response.body.data.items.find((prospect) => prospect.id === PROSPECT_ID);

    expect(response.status).toBe(200);
    expect(item).toMatchObject({
      businessName: 'North Star Retail',
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      pageUrl: null,
      redacted: true,
    });
    expect(JSON.stringify(response.body)).not.toContain('owner@example.test');
    expect(JSON.stringify(response.body)).not.toContain('01700000000');
    expect(JSON.stringify(response.body)).not.toContain('facebook.com/north-star');
  });

  it('denies an executive IDOR lookup outside the assigned scope', async () => {
    setIdentity({ id: EXECUTIVE_ID, role: 'BUSINESS_EXECUTIVE' });

    const response = await request(app)
      .get(`/api/internal/growth-os/prospects/${FOREIGN_PROSPECT_ID}`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('GROWTH_OS_PROSPECT_NOT_FOUND');
    expect(mockProspectRepository.findProspectById).toHaveBeenCalledWith(
      FOREIGN_PROSPECT_ID,
      expect.objectContaining({
        scope: expect.objectContaining({
          kind: 'assigned',
          where: { owner_user_id: EXECUTIVE_ID },
        }),
      }),
    );
  });

  it('ignores a forged frontend guard claim when the backend role is absent', async () => {
    setIdentity({ id: 'merchant-2', role: null, mfaVerified: false });

    const response = await request(app)
      .get('/api/internal/growth-os/prospects')
      .set('X-Frontend-Guard-Claim', 'growth-authorized');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('GROWTH_OS_FORBIDDEN');
  });

  it('short-circuits disabled Growth before cache or database access', async () => {
    setIdentity({ id: FOUNDER_ID, role: 'FOUNDER' });
    mockConfig.growthOsEnabled = false;

    const response = await request(app).get('/api/internal/growth-os/prospects');

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('GROWTH_OS_DISABLED');
    expect(mockCacheService.getStrict).not.toHaveBeenCalled();
    expect(mockGrowthRepository.findActiveRoleForUser).not.toHaveBeenCalled();
    expect(mockProspectRepository.listProspects).not.toHaveBeenCalled();
  });

  it('maps a prospect database failure to a sanitized 503', async () => {
    setIdentity({ id: FOUNDER_ID, role: 'FOUNDER' });
    mockProspectRepository.listProspects.mockRejectedValueOnce(
      new Error('postgresql://growth:secret@database.internal/growth'),
    );

    const response = await request(app).get('/api/internal/growth-os/prospects');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      code: 'GROWTH_OS_PROSPECT_UNAVAILABLE',
      message: 'Growth OS prospect service is temporarily unavailable.',
    });
    expect(JSON.stringify(response.body)).not.toContain('database.internal');
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('does not expose superseded prospect route methods', async () => {
    setIdentity({ id: FOUNDER_ID, role: 'FOUNDER' });

    const oldRoutes = [
      ['post', `/api/internal/growth-os/prospects/${PROSPECT_ID}/status-transition`],
      ['post', `/api/internal/growth-os/prospects/${PROSPECT_ID}/convert-to-lead`],
      ['post', `/api/internal/growth-os/prospects/${PROSPECT_ID}/link-shop`],
    ];

    for (const [method, path] of oldRoutes) {
      const response = await request(app)[method](path).send({ reason: 'old route probe' });
      expect(response.status).toBe(404);
    }
    expect(prospectService.transition).not.toHaveBeenCalledWith(expect.anything());
    expect(prospectService.link).not.toHaveBeenCalledWith(expect.anything());
  });
});
