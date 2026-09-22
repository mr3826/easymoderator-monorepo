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
      shopId: null,
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

    const merchantAudit = await request(app)
      .get('/api/internal/growth-os/admin/audit')
      .set('Authorization', `Bearer ${merchantToken}`);
    expect(merchantAudit.status).toBe(403);
  });

  test('rejects expired sessions without querying Growth authorization', async () => {
    const expiredToken = jwt.sign({
      userId: target.id,
      email: target.email,
      shopId: null,
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
      // Canonical two-role model: legacy strings are no longer grantable.
      role: 'SUPER_ADMIN',
      reason: 'Integration access-boundary proof',
      ipAddress: '127.0.0.1',
      userAgent: 'growth-os-integration',
    });
    auditResourceIds.push(granted.id);

    const refreshedTarget = await User.findByPk(target.id, { attributes: ['token_version'] });
    targetToken = generateAccessToken({
      userId: target.id,
      email: target.email,
      shopId: null,
      tokenVersion: refreshedTarget.token_version,
      mfaVerified: true,
    });

    const afterGrant = await request(app)
      .get('/api/internal/growth-os/session')
      .set('Authorization', `Bearer ${targetToken}`);
    expect(afterGrant.status).toBe(200);
    expect(afterGrant.body.data).toMatchObject({
      internalUserId: target.id,
      role: 'SUPER_ADMIN',
    });
    expect(afterGrant.body.data.permissions).toContain('growth_os.admin.users.manage');

    const internalAuthContext = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${targetToken}`);
    expect(internalAuthContext.status).toBe(200);
    expect(internalAuthContext.body.data).toMatchObject({
      currentShop: null,
      allShops: [],
      user: { id: target.id },
    });

    const legacyGrant = await request(app)
      .post('/api/internal/growth-os/roles')
      .set('Authorization', `Bearer ${targetToken}`)
      .send({ userId: merchant.id, role: 'FOUNDER', reason: 'must be rejected' });
    expect(legacyGrant.status).toBe(400);
    expect(legacyGrant.body.code).toBe('GROWTH_OS_INVALID_ROLE');

    const grantAudit = await AuditLog.findOne({
      where: { resource_id: granted.id, action: 'growth_os:role_granted' },
    });
    expect(grantAudit).not.toBeNull();
    expect(grantAudit.shop_id).toBeNull();
    expect(grantAudit.metadata).toMatchObject({ reason: 'Integration access-boundary proof' });

    // Cache the allow, then revoke. The transaction deletes the role cache and
    // the post-commit session invalidation rotates token_version. A stale
    // session therefore receives 401; a newly issued token would receive the
    // role-level 403.
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
    expect(afterRevoke.status).toBe(401);

    const revokeAudit = await AuditLog.findOne({
      where: { resource_id: granted.id, action: 'growth_os:role_revoked' },
    });
    expect(revokeAudit).not.toBeNull();
  });

  test('does not allow removal of the last active Super Admin (legacy FOUNDER inclusive)', async () => {
    await GrowthOsUserRole.create({
      user_id: merchant.id,
      role: 'SUPER_ADMIN',
      is_active: true,
      granted_by: actor.id,
      metadata: { source: 'self-lockout-fixture' },
    });
    await GrowthOsUserRole.create({
      user_id: target.id,
      role: 'SUPER_ADMIN',
      is_active: true,
      granted_by: actor.id,
      metadata: { source: 'self-lockout-fixture' },
    });
    await expect(roleService.revokeRole({
      actorUserId: actor.id,
      targetUserId: actor.id,
      reason: 'Last-super-admin guard proof',
    })).rejects.toMatchObject({
      status: 403,
      code: 'GROWTH_OS_SELF_LOCKOUT_FORBIDDEN',
    });
    await expect(roleService.revokeRole({
      actorUserId: actor.id,
      targetUserId: actor.id,
      reason: 'Last-super-admin guard proof',
    })).rejects.toMatchObject({
      status: 403,
      code: 'GROWTH_OS_SELF_LOCKOUT_FORBIDDEN',
    });
    await expect(roleService.setActiveStatus({
      actorUserId: actor.id,
      targetUserId: actor.id,
      active: false,
      reason: 'Suspension guard proof',
    })).rejects.toMatchObject({
      status: 403,
      code: 'GROWTH_OS_SELF_LOCKOUT_FORBIDDEN',
    });
    await expect(roleService.changeRole({
      actorUserId: actor.id,
      targetUserId: actor.id,
      role: 'GROWTH_USER',
      reason: 'Demotion guard proof',
    })).rejects.toMatchObject({
      status: 403,
      code: 'GROWTH_OS_SELF_LOCKOUT_FORBIDDEN',
    });

    // A non-self actor may remove one of three Super Admins, but cannot remove
    // their own remaining account.
    await expect(roleService.revokeRole({
      actorUserId: target.id,
      targetUserId: merchant.id,
      reason: 'Reduce to two-super-admin fixture',
    })).resolves.toBeTruthy();
    await expect(roleService.revokeRole({
      actorUserId: target.id,
      targetUserId: target.id,
      reason: 'Last-super-admin guard proof',
    })).rejects.toMatchObject({
      status: 403,
      code: 'GROWTH_OS_SELF_LOCKOUT_FORBIDDEN',
    });
    await roleService.revokeRole({
      actorUserId: actor.id,
      targetUserId: target.id,
      reason: 'Clean up role-count fixture',
    });
  });

  test('prevents a Super Admin from locking out their own account', async () => {
    const granted = await roleService.grantRole({
      actorUserId: actor.id,
      targetUserId: target.id,
      role: 'SUPER_ADMIN',
      reason: 'Self-lockout guard proof',
    });
    auditResourceIds.push(granted.id);

    try {
      await expect(roleService.revokeRole({
        actorUserId: target.id,
        targetUserId: target.id,
        reason: 'Self-revoke guard proof',
      })).rejects.toMatchObject({
        status: 403,
        code: 'GROWTH_OS_SELF_LOCKOUT_FORBIDDEN',
      });
      await expect(roleService.setActiveStatus({
        actorUserId: target.id,
        targetUserId: target.id,
        active: false,
        reason: 'Self-suspend guard proof',
      })).rejects.toMatchObject({
        status: 403,
        code: 'GROWTH_OS_SELF_LOCKOUT_FORBIDDEN',
      });
      await expect(roleService.changeRole({
        actorUserId: target.id,
        targetUserId: target.id,
        role: 'GROWTH_USER',
        reason: 'Self-demotion guard proof',
      })).rejects.toMatchObject({
        status: 403,
        code: 'GROWTH_OS_SELF_LOCKOUT_FORBIDDEN',
      });
    } finally {
      await roleService.revokeRole({
        actorUserId: actor.id,
        targetUserId: target.id,
        reason: 'Clean up self-lockout fixture',
      });
    }
  });
});
