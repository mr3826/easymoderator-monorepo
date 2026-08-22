'use strict';

const request = require('supertest');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const jwt = require('jsonwebtoken');
const config = require('../../../config/config');
const { generateAccessToken } = require('../../../utils/jwt.util');
const { User, GrowthOsUserRole, AuditLog } = require('../../entities');
const { sequelize } = require('../../../utils/database/database-setup');
const roleService = require('../growth-os.roles.service');

// This file is intentionally named for the real integration suite. The
// wrapper/CI migrates a disposable PostgreSQL database and starts Redis before
// Jest, so these requests exercise the actual auth middleware, role table, and
// Redis-backed role cache rather than mocked stores.
const app = require('../../../app');

describe('Growth OS access boundary on PostgreSQL and Redis', () => {
  let actor;
  let target;
  let merchant;
  let targetToken;
  let merchantToken;
  const auditResourceIds = [];

  beforeAll(async () => {
    const suffix = uuidv4();
    actor = await User.create({
      email: `growth-actor-${suffix}@example.test`,
      password: 'integration-only',
      full_name: 'Growth Actor',
      token_version: 0,
      settings: {},
    });
    target = await User.create({
      email: `growth-target-${suffix}@example.test`,
      password: 'integration-only',
      full_name: 'Growth Target',
      token_version: 0,
      settings: {},
    });
    merchant = await User.create({
      email: `growth-merchant-${suffix}@example.test`,
      password: 'integration-only',
      full_name: 'Merchant',
      token_version: 0,
      settings: {},
    });

    await GrowthOsUserRole.create({
      user_id: actor.id,
      role: 'FOUNDER',
      is_active: true,
      granted_by: actor.id,
      metadata: { source: 'integration_fixture' },
    });

    targetToken = generateAccessToken({
      userId: target.id,
      email: target.email,
      shopId: uuidv4(),
      tokenVersion: 0,
      mfaVerified: true,
    });
    merchantToken = generateAccessToken({
      userId: merchant.id,
      email: merchant.email,
      shopId: uuidv4(),
      tokenVersion: 0,
      mfaVerified: false,
    });
  });

  afterAll(async () => {
    if (auditResourceIds.length > 0) {
      await AuditLog.destroy({ where: { resource_id: { [Op.in]: auditResourceIds } } });
    }
    await GrowthOsUserRole.destroy({ where: { user_id: { [Op.in]: [actor.id, target.id, merchant.id] } } });
    await User.destroy({ where: { id: { [Op.in]: [actor.id, target.id, merchant.id] } } });
    // Do not close shared Sequelize/Redis clients here; the integration
    // worker may run other real-stack suites in the same process.
  });

  test('rejects unauthenticated and ordinary merchant direct API calls', async () => {
    const unauthenticated = await request(app)
      .get('/api/internal/growth-os/session');
    expect(unauthenticated.status).toBe(401);

    const merchant = await request(app)
      .get('/api/internal/growth-os/session')
      .set('Authorization', `Bearer ${merchantToken}`)
      .set('X-Frontend-Guard-Claim', 'allowed');
    expect(merchant.status).toBe(403);
    expect(merchant.body.code).toBe('GROWTH_OS_FORBIDDEN');

    const merchantGrowthReport = await request(app)
      .get('/api/analytics/growth')
      .set('Authorization', `Bearer ${merchantToken}`);
    expect(merchantGrowthReport.status).toBe(403);
  });

  test('rejects expired sessions without querying Growth authorization', async () => {
    const expiredToken = jwt.sign({
      userId: target.id,
      email: target.email,
      shopId: uuidv4(),
      tokenVersion: 0,
      mfaVerified: true,
    }, config.jwtAccessSecret, { algorithm: 'HS256', expiresIn: '-1s' });

    const response = await request(app)
      .get('/api/internal/growth-os/session')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(response.status).toBe(401);
  });

  test('grants and revokes a role with real Postgres audit and Redis cache invalidation', async () => {
    // Cache an explicit denial first. Grant must invalidate that denial.
    const beforeGrant = await request(app)
      .get('/api/internal/growth-os/session')
      .set('Authorization', `Bearer ${targetToken}`);
    expect(beforeGrant.status).toBe(403);

    const granted = await roleService.grantRole({
      actorUserId: actor.id,
      targetUserId: target.id,
      role: 'FOUNDER',
      reason: 'Integration access-boundary proof',
      ipAddress: '127.0.0.1',
      userAgent: 'growth-os-integration',
    });
    auditResourceIds.push(granted.id);

    const afterGrant = await request(app)
      .get('/api/internal/growth-os/session')
      .set('Authorization', `Bearer ${targetToken}`);
    expect(afterGrant.status).toBe(200);
    expect(afterGrant.body.data).toMatchObject({
      internalUserId: target.id,
      role: 'FOUNDER',
    });

    const grantAudit = await AuditLog.findOne({
      where: { resource_id: granted.id, action: 'growth_os:role_granted' },
    });
    expect(grantAudit).not.toBeNull();
    expect(grantAudit.shop_id).toBeNull();
    expect(grantAudit.metadata).toMatchObject({ reason: 'Integration access-boundary proof' });

    // Cache the allow, then revoke. The transaction deletes the cache before
    // commit; a failed deletion would roll the role mutation back.
    const revoked = await roleService.revokeRole({
      actorUserId: actor.id,
      targetUserId: target.id,
      reason: 'Integration revocation proof',
      ipAddress: '127.0.0.1',
      userAgent: 'growth-os-integration',
    });
    expect(revoked.id).toBe(granted.id);

    const afterRevoke = await request(app)
      .get('/api/internal/growth-os/session')
      .set('Authorization', `Bearer ${targetToken}`);
    expect(afterRevoke.status).toBe(403);

    const revokeAudit = await AuditLog.findOne({
      where: { resource_id: granted.id, action: 'growth_os:role_revoked' },
    });
    expect(revokeAudit).not.toBeNull();
  });

  test('does not allow removal of the last active Founder', async () => {
    await expect(roleService.revokeRole({
      actorUserId: actor.id,
      targetUserId: actor.id,
      reason: 'Last-founder guard proof',
    })).rejects.toMatchObject({
      status: 409,
      code: 'GROWTH_OS_LAST_FOUNDER',
    });
  });
});
