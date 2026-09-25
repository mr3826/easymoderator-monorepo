'use strict';

process.env.MOBILE_API_ENABLED = 'true';

const request = require('supertest');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const { hashPassword } = require('../../../../utils/password.util');
const { User, Tenant, Shop, UserShop, Session, AuditLog } = require('../../../entities');
const totpService = require('../../totp.service');
const app = require('../../../../app');

const PASSWORD = 'test-only-native-2fa-fixture-password-do-not-use';
const fixtures = [];

async function makeUserWithShop(label) {
    const suffix = uuidv4();
    const tenant = await Tenant.create({ name: `Native 2FA ${label} ${suffix}` });
    const shop = await Shop.create({
        unique_code: `N2-${suffix}`.slice(0, 20),
        tenant_id: tenant.id,
        shop_name: `Native 2FA Shop ${label}`,
        name: `Native 2FA Shop ${label}`,
    });
    const user = await User.create({
        email: `native-2fa-${label}-${suffix}@example.test`,
        password: await hashPassword(PASSWORD),
        full_name: `Native 2FA ${label}`,
        settings: {},
    });
    await UserShop.create({ user_id: user.id, shop_id: shop.id, role: 'owner', is_active: true });
    await user.update({ last_logged_shop_id: shop.id });
    const fixture = { user, shop, tenant };
    fixtures.push(fixture);
    return fixture;
}

function currentCode(secret, offset = 0) {
    return totpService.hotp(secret, Math.floor(Date.now() / 1000 / 30) + offset);
}

function invalidCode(secret) {
    const validCodes = new Set([-1, 0, 1].map((offset) => currentCode(secret, offset)));
    for (const candidate of ['000000', '999999', '123456', '654321', '111111']) {
        if (!validCodes.has(candidate)) return candidate;
    }
    return '000001';
}

async function issueChallenge(label) {
    const fixture = await makeUserWithShop(label);
    const secretResult = await totpService.generateTotpSecret(fixture.user.id);
    await totpService.enableTotp(fixture.user.id, currentCode(secretResult.secret));
    const signin = await request(app)
        .post('/api/auth/native/signin')
        .send({ email: fixture.user.email, password: PASSWORD });

    if (signin.status !== 200 || !signin.body?.data?.requires2fa) {
        throw new Error(`Native 2FA fixture signin failed with status ${signin.status}`);
    }

    return { fixture, secret: secretResult.secret, tempToken: signin.body.data.tempToken };
}

async function cleanupFixtures() {
    const userIds = fixtures.map(({ user }) => user.id);
    const shopIds = fixtures.map(({ shop }) => shop.id);
    const tenantIds = fixtures.map(({ tenant }) => tenant.id);
    if (userIds.length === 0) return;

    await Session.destroy({ where: { user_id: { [Op.in]: userIds } } });
    await AuditLog.destroy({ where: { user_id: { [Op.in]: userIds } } });
    await UserShop.destroy({ where: { user_id: { [Op.in]: userIds } } });
    await User.destroy({ where: { id: { [Op.in]: userIds } } });
    await Shop.destroy({ where: { id: { [Op.in]: shopIds } } });
    await Tenant.destroy({ where: { id: { [Op.in]: tenantIds } } });
    fixtures.length = 0;
}

module.exports = {
    PASSWORD,
    app,
    totpService,
    currentCode,
    invalidCode,
    issueChallenge,
    cleanupFixtures,
};
