'use strict';

const crypto = require('crypto');
const { cacheRedis } = require('../../config/redis');
const DeliveryIntegration = require('./delivery-integration.entity');
const PathaoProvider = require('./providers/pathao.provider');
const { AppError } = require('../../utils/AppError');

const TOKEN_REFRESH_SKEW_MS = 60 * 1000;
const TOKEN_LOCK_TTL_SECONDS = 30;
const TOKEN_WAIT_ATTEMPTS = 20;
const TOKEN_WAIT_MS = 50;
const inFlight = new Map();

const isPlainObject = (value) => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
);

const tokenLockKey = (shopId) => `delivery:pathao:token-lock:${shopId}`;

const redisAvailable = () => (
    cacheRedis
    && typeof cacheRedis.set === 'function'
    && (cacheRedis._isMemoryFallback === true || cacheRedis.status === 'ready' || cacheRedis.status === undefined)
);

const tokenStoreError = () => new AppError(
    'Pathao token storage is temporarily unavailable. Please retry.',
    503,
    'DELIVERY_TOKEN_STORE_UNAVAILABLE',
);

const providerAuthError = () => new AppError(
    'Pathao authentication failed. Reconnect the courier account and retry.',
    502,
    'DELIVERY_PROVIDER_AUTH_FAILED',
);

const getCredentials = (integration) => {
    const credentials = integration?.credentials;
    if (!isPlainObject(credentials)) {
        throw new AppError('Pathao credentials are unavailable', 503, 'DELIVERY_CREDENTIALS_UNAVAILABLE');
    }
    return credentials;
};

const tokenIsUsable = (credentials, now = Date.now()) => {
    if (!credentials || typeof credentials.access_token !== 'string' || !credentials.access_token) return false;
    if (!credentials.expires_at) return true;
    const expiresAt = new Date(credentials.expires_at).getTime();
    return Number.isFinite(expiresAt) && expiresAt > now + TOKEN_REFRESH_SKEW_MS;
};

const tokenChanged = (credentials, previousAccessToken) => (
    typeof credentials?.access_token === 'string'
    && credentials.access_token
    && credentials.access_token !== previousAccessToken
);

const tokenPayload = (result, previousCredentials) => {
    if (!isPlainObject(result) || typeof result.access_token !== 'string' || !result.access_token) {
        throw providerAuthError();
    }

    const next = {
        ...previousCredentials,
        access_token: result.access_token,
    };
    if (result.refresh_token) next.refresh_token = result.refresh_token;
    else if (previousCredentials.refresh_token) next.refresh_token = previousCredentials.refresh_token;

    if (result.expires_at) {
        const expiresAt = result.expires_at instanceof Date
            ? result.expires_at
            : new Date(result.expires_at);
        if (Number.isFinite(expiresAt.getTime())) {
            next.expires_at = expiresAt.toISOString();
            next.access_token_expires_at = next.expires_at;
        }
    } else if (Number.isFinite(Number(result.expires_in))) {
        next.expires_at = new Date(Date.now() + Number(result.expires_in) * 1000).toISOString();
        next.access_token_expires_at = next.expires_at;
    }
    return next;
};

/** Persist through DeliveryIntegration's encrypted credentials setter. */
const persistCredentials = async (integration, credentials) => {
    if (!integration) throw new AppError('Pathao integration is unavailable', 503, 'DELIVERY_INTEGRATION_UNAVAILABLE');
    integration.credentials = credentials;
    if (typeof integration.save === 'function') await integration.save();
    return credentials;
};

const persistProviderTokensIfChanged = async (integration, provider) => {
    if (!provider || typeof provider.accessToken !== 'string' || !provider.accessToken) return;
    const current = getCredentials(integration);
    const nextAccessToken = provider.accessToken;
    const nextRefreshToken = provider.refreshToken || current.refresh_token;
    const nextExpiry = provider.accessTokenExpiresAt || current.expires_at;
    const normalizedExpiry = nextExpiry instanceof Date ? nextExpiry.toISOString() : nextExpiry;
    if (nextAccessToken === current.access_token
        && nextRefreshToken === current.refresh_token
        && normalizedExpiry === current.expires_at) return;

    const next = {
        ...current,
        access_token: nextAccessToken,
        ...(nextRefreshToken ? { refresh_token: nextRefreshToken } : {}),
        ...(normalizedExpiry ? {
            expires_at: normalizedExpiry,
            access_token_expires_at: normalizedExpiry,
        } : {}),
    };
    await persistCredentials(integration, next);
};

// The provider adapter also has a local 401 retry for direct callers. Delivery
// owns the coordinated path, so disable that local retry on instances created
// here; otherwise concurrent workers could refresh outside the Redis flight.
const disableLocalRefresh = (provider) => {
    if (!provider || typeof provider.request !== 'function') return provider;
    const request = provider.request.bind(provider);
    provider.request = (method, path, payload, config) => request(method, path, payload, config, false);
    return provider;
};

const makeProvider = (integration, ProviderClass = PathaoProvider, credentials = null) => {
    const effectiveCredentials = credentials || getCredentials(integration);
    return new ProviderClass(effectiveCredentials, integration?.is_sandbox === true);
};

const callTokenEndpoint = async (integration, provider, credentials, forceRefresh) => {
    if (!provider || typeof provider.issueToken !== 'function') return credentials;

    try {
        let result;
        if (forceRefresh && credentials.refresh_token && typeof provider.refreshAccessToken === 'function') {
            result = await provider.refreshAccessToken();
        } else {
            result = await provider.issueToken();
        }
        return persistCredentials(integration, tokenPayload(result, credentials));
    } catch (error) {
        // If a rotated refresh token is no longer accepted, password grant is a
        // safe recovery path when the original credentials are still present.
        if (forceRefresh
            && credentials.username
            && credentials.password
            && typeof provider.issueToken === 'function') {
            try {
                const result = await provider.issueToken();
                return persistCredentials(integration, tokenPayload(result, credentials));
            } catch (_) {
                throw providerAuthError();
            }
        }
        if (error instanceof AppError) throw error;
        throw providerAuthError();
    }
};

const reloadCredentials = async (shopId, integration, previousAccessToken) => {
    if (typeof DeliveryIntegration.findOne !== 'function') return null;
    const where = integration?.id
        ? { id: integration.id, shop_id: shopId, provider: 'pathao' }
        : { shop_id: shopId, provider: 'pathao', is_connected: true };
    try {
        const latest = await DeliveryIntegration.findOne({ where });
        const credentials = latest ? latest.credentials : null;
        if (tokenChanged(credentials, previousAccessToken) || tokenIsUsable(credentials)) {
            return { integration: latest, credentials };
        }
    } catch (_) {
        // The lock owner will surface the provider/storage failure. A waiter
        // must not turn a transient read failure into a false token success.
    }
    return null;
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const acquireLock = async (shopId, lockValue) => {
    if (!redisAvailable()) throw tokenStoreError();
    try {
        const result = await cacheRedis.set(
            tokenLockKey(shopId),
            lockValue,
            'EX',
            TOKEN_LOCK_TTL_SECONDS,
            'NX',
        );
        return result === 'OK' || result === true || result === 1;
    } catch (_) {
        throw tokenStoreError();
    }
};

const releaseLock = async (shopId, lockValue) => {
    try {
        if (!redisAvailable()) return;
        const key = tokenLockKey(shopId);
        if (typeof cacheRedis.eval === 'function') {
            const luaScript = `
                if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("del", KEYS[1])
                else
                    return 0
                end`;
            await cacheRedis.eval(luaScript, 1, key, lockValue);
        } else if (cacheRedis._isMemoryFallback
            && typeof cacheRedis.get === 'function'
            && typeof cacheRedis.del === 'function'
            && await cacheRedis.get(key) === lockValue) {
            await cacheRedis.del(key);
        }
    } catch (_) {
        // The short TTL remains the recovery boundary if release fails.
    }
};

const waitForOtherRefresh = async (shopId, integration, previousAccessToken) => {
    for (let attempt = 0; attempt < TOKEN_WAIT_ATTEMPTS; attempt += 1) {
        await sleep(TOKEN_WAIT_MS);
        const latest = await reloadCredentials(shopId, integration, previousAccessToken);
        if (latest) return latest;
    }
    return null;
};

const refreshUnderDistributedLock = async (shopId, integration, provider, forceRefresh, previousAccessToken) => {
    if (!redisAvailable()) throw tokenStoreError();

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const lockValue = crypto.randomUUID();
        if (await acquireLock(shopId, lockValue)) {
            try {
                const credentials = getCredentials(integration);
                return await callTokenEndpoint(integration, provider, credentials, forceRefresh);
            } finally {
                await releaseLock(shopId, lockValue);
            }
        }

        const latest = await waitForOtherRefresh(shopId, integration, previousAccessToken);
        if (latest) return latest.credentials;
    }

    throw new AppError(
        'Pathao token refresh is already in progress. Please retry.',
        503,
        'DELIVERY_TOKEN_REFRESH_IN_PROGRESS',
    );
};

const ensureToken = async (
    shopId,
    integration,
    {
        provider = null,
        ProviderClass = PathaoProvider,
        forceRefresh = false,
        previousAccessToken = null,
    } = {},
) => {
    if (!shopId || !integration) throw new AppError('Pathao integration is unavailable', 503, 'DELIVERY_INTEGRATION_UNAVAILABLE');
    const credentials = getCredentials(integration);
    if (!forceRefresh && tokenIsUsable(credentials)) return credentials;

    const key = `${shopId}:${integration.id || 'pathao'}`;
    const existing = inFlight.get(key);
    if (existing) return existing;

    const operation = (async () => {
        const currentCredentials = getCredentials(integration);
        if (!forceRefresh && tokenIsUsable(currentCredentials)) return currentCredentials;

        const tokenProvider = provider || makeProvider(integration, ProviderClass, currentCredentials);
        if (typeof tokenProvider.issueToken !== 'function'
            && typeof tokenProvider.refreshAccessToken !== 'function') {
            // Lightweight provider doubles and legacy integrations without a
            // token endpoint retain the existing provider-construction path.
            return currentCredentials;
        }
        return refreshUnderDistributedLock(
            shopId,
            integration,
            tokenProvider,
            forceRefresh,
            previousAccessToken || currentCredentials.access_token || null,
        );
    })();

    inFlight.set(key, operation);
    try {
        return await operation;
    } finally {
        if (inFlight.get(key) === operation) inFlight.delete(key);
    }
};

const isUnauthorizedError = (error) => {
    const status = error?.response?.status ?? error?.status ?? error?.statusCode;
    if (Number(status) === 401) return true;
    const message = String(error?.message || '').toLowerCase();
    return /\b401\b|unauthori[sz]ed|invalid token|token expired|access token/.test(message);
};

const execute = async (shopId, integration, provider, method, args, ProviderClass = PathaoProvider) => {
    try {
        const result = await provider[method](...args);
        await persistProviderTokensIfChanged(integration, provider);
        return result;
    } catch (error) {
        if (!isUnauthorizedError(error)) throw error;

        const currentCredentials = getCredentials(integration);
        const refreshedCredentials = await ensureToken(shopId, integration, {
            provider,
            ProviderClass,
            forceRefresh: true,
            previousAccessToken: currentCredentials.access_token || null,
        });
        const retryProvider = disableLocalRefresh(makeProvider(integration, ProviderClass, refreshedCredentials));
        if (typeof retryProvider[method] !== 'function') throw error;
        const result = await retryProvider[method](...args);
        await persistProviderTokensIfChanged(integration, retryProvider);
        return result;
    }
};

const makeResilientProvider = (shopId, integration, provider, ProviderClass = PathaoProvider) => new Proxy(
    provider,
    {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (typeof value !== 'function') return value;
            if (property === 'issueToken' || property === 'refreshAccessToken') {
                return value.bind(target);
            }
            return (...args) => execute(shopId, integration, target, property, args, ProviderClass);
        },
    },
);

const createProvider = async (shopId, integration, ProviderClass = PathaoProvider) => {
    const credentials = getCredentials(integration);
    const initialProvider = makeProvider(integration, ProviderClass, credentials);
    const effectiveCredentials = await ensureToken(shopId, integration, {
        provider: initialProvider,
        ProviderClass,
    });
    const provider = effectiveCredentials === credentials
        ? initialProvider
        : makeProvider(integration, ProviderClass, effectiveCredentials);
    return makeResilientProvider(shopId, integration, disableLocalRefresh(provider), ProviderClass);
};

const getConnectedIntegration = async (shopId, integration = null) => {
    if (integration) return integration;
    const found = await DeliveryIntegration.findOne({
        where: { shop_id: shopId, provider: 'pathao', is_connected: true },
    });
    if (!found) throw new AppError('Pathao is not connected', 400, 'DELIVERY_PROVIDER_NOT_CONNECTED');
    return found;
};

const withProvider = async (shopId, operation, { integration = null, ProviderClass = PathaoProvider } = {}) => {
    const connected = await getConnectedIntegration(shopId, integration);
    const provider = await createProvider(shopId, connected, ProviderClass);
    return operation(provider, connected);
};

const resetForTests = () => inFlight.clear();

module.exports = {
    ensureToken,
    createProvider,
    withProvider,
    execute,
    isUnauthorizedError,
    tokenIsUsable,
    persistCredentials,
    persistProviderTokensIfChanged,
    resetForTests,
    _private: {
        acquireLock,
        releaseLock,
        reloadCredentials,
        refreshUnderDistributedLock,
        tokenLockKey,
        TOKEN_LOCK_TTL_SECONDS,
        TOKEN_WAIT_ATTEMPTS,
        TOKEN_WAIT_MS,
    },
};
