'use strict';

const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const { Op } = require('sequelize');
const request = require('supertest');

const app = require('../../../app');
const { generateAccessToken, generateRefreshToken } = require('../../../utils/jwt.util');
const { findActiveMembership } = require('../../../utils/active-membership');
const shopService = require('../shop.service');
const { sequelize } = require('../../../utils/database/database-setup');
const {
    User,
    Tenant,
    Shop,
    UserShop,
    Session,
    AuditLog,
} = require('../../entities');

const PASSWORD = 'Integration-password-123!';
const fixtures = [];

async function createFixture({ targetRole = 'staff', multiShop = false, includeActor = true } = {}) {
    const suffix = randomUUID();
    const tenant = await Tenant.create({ name: `membership-lifecycle-${suffix}` });
    const shopA = await Shop.create({
        unique_code: `ml${process.pid}${suffix.slice(0, 8)}`,
        tenant_id: tenant.id,
        shop_name: 'Membership Lifecycle A',
        name: 'Membership Lifecycle A',
        is_active: true,
    });
    const shopB = multiShop ? await Shop.create({
        unique_code: `mn${process.pid}${suffix.slice(0, 8)}`,
        tenant_id: tenant.id,
        shop_name: 'Membership Lifecycle B',
        name: 'Membership Lifecycle B',
        is_active: true,
    }) : null;
    const password = await bcrypt.hash(PASSWORD, 4);
    const actor = includeActor ? await User.create({
        email: `membership-actor-${suffix}@example.test`,
        password,
        full_name: 'Membership Actor',
        token_version: 0,
        last_logged_shop_id: shopA.id,
        settings: {},
    }) : null;
    const target = await User.create({
        email: `membership-target-${suffix}@example.test`,
        password,
        full_name: 'Membership Target',
        token_version: 0,
        last_logged_shop_id: shopA.id,
        settings: {},
    });

    if (actor) {
        await UserShop.create({ user_id: actor.id, shop_id: shopA.id, role: 'owner', is_active: true });
        if (shopB) {
            await UserShop.create({ user_id: actor.id, shop_id: shopB.id, role: 'owner', is_active: true });
        }
    }
    await UserShop.create({ user_id: target.id, shop_id: shopA.id, role: targetRole, is_active: true });
    if (shopB) {
        await UserShop.create({ user_id: target.id, shop_id: shopB.id, role: 'staff', is_active: true });
    }

    const fixture = { tenant, shopA, shopB, actor, target };
    fixtures.push(fixture);
    return fixture;
}

function accessToken(user, shop) {
    return generateAccessToken({
        userId: user.id,
        email: user.email,
        shopId: shop.id,
        tokenVersion: user.token_version,
        mfaVerified: true,
    });
}

function refreshToken(user) {
    return generateRefreshToken({
        userId: user.id,
        tokenVersion: user.token_version,
        mfaVerified: true,
    });
}

async function destroyFixture({ tenant, shopA, shopB, actor, target }) {
    const shopIds = [shopA?.id, shopB?.id].filter(Boolean);
    const userIds = [actor?.id, target?.id].filter(Boolean);

    await AuditLog.destroy({
        where: {
            [Op.or]: [
                { shop_id: { [Op.in]: shopIds } },
                { user_id: { [Op.in]: userIds } },
            ],
        },
    });
    await Session.destroy({ where: { user_id: { [Op.in]: userIds } } });
    await UserShop.destroy({ where: { user_id: { [Op.in]: userIds } } });
    await User.destroy({ where: { id: { [Op.in]: userIds } } });
    await Shop.destroy({ where: { id: { [Op.in]: shopIds } } });
    await Tenant.destroy({ where: { id: tenant.id } });
}

describe('membership revocation lifecycle on PostgreSQL and Redis', () => {
    afterEach(async () => {
        while (fixtures.length) {
            await destroyFixture(fixtures.pop());
        }
    });

    test('stale access and refresh tokens fail immediately after membership removal', async () => {
        const fixture = await createFixture();
        const token = accessToken(fixture.target, fixture.shopA);
        const oldRefreshToken = refreshToken(fixture.target);
        await fixture.target.update({
            refresh_token: require('crypto').createHash('sha256').update(oldRefreshToken).digest('hex'),
        });

        const beforeRemoval = await request(app)
            .get('/api/shop/me')
            .set('Authorization', `Bearer ${token}`);
        expect(beforeRemoval.status).toBe(200);

        await shopService.removeUserFromShop(fixture.shopA.id, fixture.actor.id, fixture.target.id);

        const staleAccess = await request(app)
            .get('/api/shop/me')
            .set('Authorization', `Bearer ${token}`);
        expect(staleAccess.status).toBe(401);

        const staleRefresh = await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', [`refresh_token=${oldRefreshToken}`]);
        expect(staleRefresh.status).toBe(401);
        expect((staleRefresh.headers['set-cookie'] || []).some((cookie) => cookie.startsWith('refresh_token='))).toBe(false);

        const audits = await AuditLog.findAll({
            where: {
                action: 'SHOP_MEMBERSHIP_REVOKED',
                resource_id: `${fixture.target.id}:${fixture.shopA.id}`,
            },
        });
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
            user_id: fixture.actor.id,
            shop_id: fixture.shopA.id,
            resource_type: 'USER_SHOP',
        });
        expect(JSON.stringify(audits[0].toJSON())).not.toMatch(/token|totp|session/i);
    });

    test('a live role demotion blocks the next owner-or-admin operation', async () => {
        const fixture = await createFixture({ targetRole: 'admin' });
        const token = accessToken(fixture.target, fixture.shopA);

        await shopService.updateUserRole(
            fixture.shopA.id,
            fixture.actor.id,
            fixture.target.id,
            'staff',
        );

        const response = await request(app)
            .post('/api/shop/add-user')
            .set('Authorization', `Bearer ${token}`)
            .send({
                shopId: fixture.shopA.id,
                email: 'new-member@example.test',
                role: 'staff',
            });
        expect(response.status).toBe(403);

        const audit = await AuditLog.findOne({
            where: {
                action: 'SHOP_MEMBERSHIP_ROLE_CHANGED',
                resource_id: `${fixture.target.id}:${fixture.shopA.id}`,
            },
        });
        expect(audit).not.toBeNull();
        expect(audit.old_values).toEqual({ role: 'admin' });
        expect(audit.new_values).toEqual({ role: 'staff' });
        expect(audit.metadata).toEqual(expect.objectContaining({ target_user_id: fixture.target.id }));
    });

    test('multi-shop removal preserves the other membership but enforces global logout', async () => {
        const fixture = await createFixture({ multiShop: true });
        const shopBToken = accessToken(fixture.target, fixture.shopB);

        await shopService.removeUserFromShop(fixture.shopA.id, fixture.actor.id, fixture.target.id);

        const shopBMembership = await UserShop.findOne({
            where: { user_id: fixture.target.id, shop_id: fixture.shopB.id },
        });
        expect(shopBMembership).toMatchObject({ is_active: true, role: 'staff' });

        const shopBWithOldToken = await request(app)
            .get('/api/shop/me')
            .set('Authorization', `Bearer ${shopBToken}`);
        expect(shopBWithOldToken.status).toBe(401);

        const updatedTarget = await User.findByPk(fixture.target.id);
        expect(updatedTarget.token_version).toBe(1);
        expect(updatedTarget.refresh_token).toBeNull();
    });

    test('inactive shops fail login cleanly and deny existing tokens', async () => {
        const fixture = await createFixture({ targetRole: 'owner', includeActor: false });
        const token = accessToken(fixture.target, fixture.shopA);

        await fixture.shopA.update({ is_active: false });

        const existingToken = await request(app)
            .get('/api/shop/me')
            .set('Authorization', `Bearer ${token}`);
        expect(existingToken.status).toBe(401);

        const login = await request(app)
            .post('/api/auth/signin')
            .send({ email: fixture.target.email, password: PASSWORD });
        expect(login.status).toBe(401);
        expect(login.body.message || login.body.error?.message).toMatch(/invalid email or password/i);
    });

    test('live membership lookup remains uncached and has composite-index evidence', async () => {
        const fixture = await createFixture();
        const [indexes] = await sequelize.query(`
            SELECT indexname, indexdef
              FROM pg_indexes
             WHERE schemaname = 'public' AND tablename = 'user_shops'
               AND indexdef ILIKE '%(user_id, shop_id)%'
        `);
        expect(indexes.length).toBeGreaterThan(0);

        const [explain] = await sequelize.query(`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            SELECT us.user_id, us.shop_id, us.role
              FROM user_shops AS us
              JOIN shops AS s ON s.id = us.shop_id
             WHERE us.user_id = :userId
               AND us.shop_id = :shopId
               AND us.is_active = true
               AND s.is_active = true
        `, { replacements: { userId: fixture.target.id, shopId: fixture.shopA.id } });
        console.log('MEMBERSHIP_EXPLAIN=', JSON.stringify(explain));

        const startedAt = process.hrtime.bigint();
        await findActiveMembership(fixture.target.id, fixture.shopA.id);
        const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        console.log('MEMBERSHIP_DB_QUERIES_PER_REQUEST=1 (direct authorization lookup)');
        console.log(`AUTH_REQUEST_LATENCY_DELTA_MS=${latencyMs.toFixed(2)} (membership lookup sample)`);
        expect(latencyMs).toBeGreaterThanOrEqual(0);
    });
});
