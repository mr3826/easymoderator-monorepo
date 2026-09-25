'use strict';

/**
 * Disposable controls used only by the native mobile E2E suite.
 *
 * This module deliberately has no production fallback. A control is accepted
 * only for NODE_ENV=test, an explicitly enabled fixture flag, a local
 * PostgreSQL database whose name is a disposable test/e2e name, and the
 * runner's per-run control token (>= 32 chars, compared in constant time).
 * The route itself is only registered when these hold at startup
 * (mobile.routes.js) and every request re-checks them. The seeded shops are
 * resolved by their own deterministic ids and marker; callers cannot provide
 * an arbitrary shop, user or entity id.
 */

const crypto = require('crypto');
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
    'expire-2fa-challenge',
]);
const MIN_CONTROL_TOKEN_LENGTH = 32;
const TOTP_TEMP_PREFIX = 'totp_temp:';
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
    return environment.NODE_ENV === 'test'
        && environment.MOBILE_E2E_FIXTURES_ENABLED === 'true'
        && typeof environment.MOBILE_E2E_FIXTURES_TOKEN === 'string'
        && environment.MOBILE_E2E_FIXTURES_TOKEN.length >= MIN_CONTROL_TOKEN_LENGTH
        && isDisposableDatabase(environment.DATABASE_URL);
}

function notFound(req) {
    return new AppError(`Can't find ${req.originalUrl} on this server!`, 404);
}

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();

function hasControlToken(req, environment = process.env) {
    const expected = environment.MOBILE_E2E_FIXTURES_TOKEN;
    const supplied = req?.get
        ? req.get(CONTROL_HEADER)
        : req?.headers?.['x-mobile-e2e-control'];
    if (typeof expected !== 'string' || expected.length < MIN_CONTROL_TOKEN_LENGTH) return false;
    if (typeof supplied !== 'string' || supplied.length === 0) return false;
    // Fixed-length digests keep the comparison constant-time regardless of input length.
    return crypto.timingSafeEqual(digest(supplied), digest(expected));
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

function resetTwoFactorAttempts() {
    // Every disposable run starts with a full native 2FA attempt budget, so a
    // retried flow does not inherit 429s from an earlier attempt.
    const nativeRoutes = require('../auth/native/native.routes');
    if (typeof nativeRoutes.__resetTwoFactorAttemptsForE2E === 'function') {
        nativeRoutes.__resetTwoFactorAttemptsForE2E();
    }
}

async function resetFixture() {
    const seed = getSeedModule();
    const { Session, User } = getEntities();
    const { ownerId, shopId } = fixtureIds();

    clearApiFailures();
    activeTotpSecret = null;
    resetTwoFactorAttempts();
    // The seed owner's per-account 2FA failure count (native-auth.service.js).
    await require('../auth/native/native-auth.service').clearTwoFactorFailures(ownerId);

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

    // A six-digit code guaranteed to be outside the accepted ±1 step window.
    const accepted = new Set([-1, 0, 1].map((offset) => totpService.hotp(
        activeTotpSecret,
        Math.floor(Date.now() / 1000 / 30) + offset,
    )));
    const invalidCode = ['000000', '999999', '123456', '654321', '111111']
        .find((candidate) => !accepted.has(candidate));

    // The caller keeps these values in Maestro output memory only. They are
    // never printed, persisted, or included in an error message.
    return { code, invalidCode };
}

// totp.service stores a challenge as {"userId","tokenVersion"} JSON (older
// challenges as the raw user id).
const challengeUserId = (value) => {
    try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object') return parsed.userId;
    } catch (_error) {
        // Raw user id.
    }
    return value;
};

/**
 * Deletes the seed owner's pending 2FA challenges so the next verification
 * behaves exactly like a challenge whose five-minute TTL elapsed. Only keys
 * whose challenge names the seed owner are touched.
 */
async function expireTwoFactorChallenge() {
    const { ownerId } = await requireSeedFixture();
    const { getRedisClient } = require('../../utils/redis-client');
    const redis = getRedisClient();
    if (!redis) {
        throw new AppError('Redis is required for the 2FA expiry fixture.', 409, 'MOBILE_E2E_FIXTURE_UNAVAILABLE');
    }

    let expiredChallengeCount = 0;
    let cursor = '0';
    do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${TOTP_TEMP_PREFIX}*`, 'COUNT', 200);
        cursor = nextCursor;
        for (const key of keys) {
            if (challengeUserId(await redis.get(key)) === ownerId) {
                expiredChallengeCount += await redis.del(key);
            }
        }
    } while (cursor !== '0');

    return { expiredChallengeCount };
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
            twoFactorExpiry: true,
            secondShop: true,
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
    case 'expire-2fa-challenge':
        return expireTwoFactorChallenge();
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
