'use strict';

/**
 * Disposable controls used only by the native mobile E2E suite.
 *
 * This module deliberately has no production fallback. A control is accepted
 * only for NODE_ENV=test/e2e, an explicitly enabled fixture flag, a local
 * PostgreSQL database whose name is a disposable test/e2e name, and the
 * runner's private control header. The seeded shop is resolved by its own
 * deterministic marker; callers cannot provide an arbitrary shop or entity id.
 */

const { AppError } = require('../../utils/AppError');

const CONTROL_HEADER = 'X-Mobile-E2E-Control';
const CONTROL_ACTIONS = Object.freeze([
    'capabilities',
    'reset',
    'empty-home',
    'set-api-error',
    'clear-api-error',
    'expire-sessions',
    'prepare-2fa',
    'current-2fa-code',
]);
const DISPOSABLE_DATABASE_NAME = /(?:^|[^a-z])(?:test|e2e)(?:[^a-z]|$)/i;

const apiFailureCounts = new Map();
let activeTotpSecret = null;

function isDisposableDatabase(rawUrl) {
    if (typeof rawUrl !== 'string' || rawUrl.length === 0) return false;

    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch (_error) {
        return false;
    }

    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) return false;
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) return false;

    let databaseName;
    try {
        databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    } catch (_error) {
        return false;
    }

    return Boolean(
        databaseName
        && !/production/i.test(databaseName)
        && DISPOSABLE_DATABASE_NAME.test(databaseName),
    );
}

function isMobileE2eFixturesEnabled(environment = process.env) {
    return ['test', 'e2e'].includes(environment.NODE_ENV)
        && environment.MOBILE_E2E_FIXTURES_ENABLED === 'true'
        && isDisposableDatabase(environment.DATABASE_URL);
}

function notFound(req) {
    return new AppError(`Can't find ${req.originalUrl} on this server!`, 404);
}

function hasControlToken(req, environment = process.env) {
    const expected = environment.MOBILE_E2E_FIXTURES_TOKEN;
    const supplied = req?.get
        ? req.get(CONTROL_HEADER)
        : req?.headers?.['x-mobile-e2e-control'];
    return typeof expected === 'string'
        && expected.length > 0
        && supplied === expected;
}

function assertFixtureControlRequest(req) {
    if (!isMobileE2eFixturesEnabled() || !hasControlToken(req)) {
        throw notFound(req);
    }
}

function getSeedModule() {
    return require('../../../scripts/seed-mobile-dev');
}

function getEntities() {
    return require('../entities');
}

function fixtureIds() {
    const seed = getSeedModule();
    return {
        seedKey: seed.SEED_KEY,
        ownerId: seed.stableId('user:owner'),
        shopId: seed.stableId('shop'),
    };
}

async function requireSeedFixture() {
    const { Shop, User } = getEntities();
    const { seedKey, ownerId, shopId } = fixtureIds();
    const shop = await Shop.findByPk(shopId);
    const owner = await User.findByPk(ownerId);

    if (!shop || shop.settings?.mobile_dev_seed !== seedKey || !owner) {
        throw new AppError(
            'The disposable mobile seed fixture is not available.',
            409,
            'MOBILE_E2E_FIXTURE_UNAVAILABLE',
        );
    }

    return { owner, shop, ownerId, shopId };
}

function clearApiFailures() {
    apiFailureCounts.clear();
}

/** Called by the real mobile controllers immediately before their collectors run. */
function consumeApiError(endpoint) {
    if (!isMobileE2eFixturesEnabled()) return false;

    const remaining = apiFailureCounts.get(endpoint) || 0;
    if (remaining < 1) return false;

    apiFailureCounts.set(endpoint, remaining - 1);
    return true;
}

function assertPositiveFailureCount(value) {
    const failures = Number(value);
    if (!Number.isInteger(failures) || failures < 1 || failures > 10) {
        throw new AppError(
            'failures must be an integer from 1 through 10.',
            400,
            'MOBILE_E2E_FIXTURE_BAD_ARGUMENT',
        );
    }
    return failures;
}

function setApiError(endpoint, rawFailures) {
    if (!['attention', 'today', 'both'].includes(endpoint)) {
        throw new AppError(
            'endpoint must be attention, today, or both.',
            400,
            'MOBILE_E2E_FIXTURE_BAD_ARGUMENT',
        );
    }

    const failures = assertPositiveFailureCount(rawFailures);
    if (endpoint === 'both') {
        apiFailureCounts.set('attention', failures);
        apiFailureCounts.set('today', failures);
    } else {
        apiFailureCounts.set(endpoint, failures);
    }

    return { endpoint, failures };
}

async function resetFixture() {
    const seed = getSeedModule();
    const { Session, User } = getEntities();
    const { ownerId, shopId } = fixtureIds();

    clearApiFailures();
    activeTotpSecret = null;

    // The seed owns this deterministic user and shop. Delete only sessions for
    // that user so every flow starts from a clean actual session model.
    await Session.destroy({ where: { user_id: ownerId } });
    const seeded = await seed.seed();
    const owner = await User.findByPk(ownerId);
    if (owner) {
        await owner.update({ settings: {}, refresh_token: null });
    }

    return {
        shopId,
        ownerEmail: seeded.owner.email,
    };
}

async function emptyHome() {
    const { Conversation, Order, Product } = getEntities();
    const { shopId } = await requireSeedFixture();

    // Keep the rows in place but move every seeded signal out of the active
    // Home projection. /today remains a valid zero-value response.
    await Order.update(
        { order_status: 'cancelled' },
        { where: { shop_id: shopId } },
    );
    await Conversation.update(
        { status: 'closed', hitl: false },
        { where: { shop_id: shopId } },
    );
    await Product.update(
        { is_active: false, track_quantity: false },
        { where: { shop_id: shopId } },
    );

    return { shopId, mode: 'empty-home' };
}

async function expireSessions() {
    const { Session } = getEntities();
    const { ownerId } = await requireSeedFixture();
    const [expiredSessionCount] = await Session.update(
        { expires_at: new Date(Date.now() - 1000) },
        { where: { user_id: ownerId, is_active: true } },
    );

    return { expiredSessionCount };
}

async function prepareTwoFactor() {
    await resetFixture();

    const { ownerId } = fixtureIds();
    const totpService = require('../auth/totp.service');
    const generated = await totpService.generateTotpSecret(ownerId);
    const setupCode = totpService.hotp(
        generated.secret,
        Math.floor(Date.now() / 1000 / 30),
    );
    await totpService.enableTotp(ownerId, setupCode);
    activeTotpSecret = generated.secret;

    const { owner } = await requireSeedFixture();
    return { ownerEmail: owner.email, twoFactorEnabled: true };
}

async function currentTwoFactorCode() {
    if (!activeTotpSecret) {
        throw new AppError(
            'The disposable 2FA fixture is not prepared.',
            409,
            'MOBILE_E2E_FIXTURE_UNAVAILABLE',
        );
    }

    const totpService = require('../auth/totp.service');
    const code = totpService.hotp(
        activeTotpSecret,
        Math.floor(Date.now() / 1000 / 30),
    );

    // The caller keeps this value in Maestro output memory only. It is never
    // printed, persisted, or included in an error message.
    return { code };
}

async function applyControl({ action, endpoint, failures }) {
    if (!CONTROL_ACTIONS.includes(action)) {
        throw new AppError(
            'Unknown mobile E2E fixture action.',
            400,
            'MOBILE_E2E_FIXTURE_BAD_ACTION',
        );
    }

    switch (action) {
    case 'capabilities':
        return {
            emptyHome: true,
            homeApiError: true,
            sessionExpiry: true,
            twoFactor: true,
        };
    case 'reset':
        return resetFixture();
    case 'empty-home':
        return emptyHome();
    case 'set-api-error':
        return setApiError(endpoint, failures);
    case 'clear-api-error':
        clearApiFailures();
        return { cleared: true };
    case 'expire-sessions':
        return expireSessions();
    case 'prepare-2fa':
        return prepareTwoFactor();
    case 'current-2fa-code':
        return currentTwoFactorCode();
    default:
        // CONTROL_ACTIONS above makes this unreachable, but keep the switch
        // exhaustive if a future action is added without an implementation.
        throw new AppError(
            'Unknown mobile E2E fixture action.',
            400,
            'MOBILE_E2E_FIXTURE_BAD_ACTION',
        );
    }
}

function __resetStateForTests() {
    clearApiFailures();
    activeTotpSecret = null;
}

module.exports = {
    CONTROL_ACTIONS,
    CONTROL_HEADER,
    isDisposableDatabase,
    isMobileE2eFixturesEnabled,
    hasControlToken,
    assertFixtureControlRequest,
    consumeApiError,
    applyControl,
    __resetStateForTests,
};
