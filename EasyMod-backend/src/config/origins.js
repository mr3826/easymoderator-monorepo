'use strict';

const PRODUCTION_DEFAULTS = Object.freeze({
    marketing: 'https://easymod.tech',
    app: 'https://app.easymod.tech',
    growth: 'https://growth.easymod.tech',
    api: 'https://api.easymod.tech',
    publicAssets: 'https://api.easymod.tech',
});

const DEVELOPMENT_DEFAULTS = Object.freeze({
    marketing: 'http://localhost:5173',
    app: 'http://localhost:5173',
    growth: 'http://localhost:5174',
    api: 'http://localhost:3000',
    publicAssets: 'http://localhost:3000',
});

function normalizeOrigin(value) {
    const parsed = new URL(String(value || '').trim());
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error(`Invalid origin: ${value}`);
    }
    parsed.pathname = '/';
    return parsed.origin;
}

function firstConfigured(env, names) {
    const value = names.map((name) => env[name]).find(Boolean);
    return value ? normalizeOrigin(value) : undefined;
}

function getOrigins(env = process.env) {
    const defaults = env.NODE_ENV === 'production' ? PRODUCTION_DEFAULTS : DEVELOPMENT_DEFAULTS;
    const app = firstConfigured(env, ['APP_URL', 'FRONTEND_URL']) || defaults.app;
    const api = firstConfigured(env, ['API_URL', 'BASE_URL']) || defaults.api;

    return Object.freeze({
        marketing: firstConfigured(env, ['MARKETING_URL']) || defaults.marketing,
        app,
        growth: firstConfigured(env, ['GROWTH_FRONTEND_URL', 'GROWTH_URL']) || defaults.growth,
        api,
        publicAssets: firstConfigured(env, ['PUBLIC_ASSET_URL', 'PUBLIC_BASE_URL']) || api,
    });
}

function joinOrigin(origin, path = '') {
    const normalizedPath = String(path || '');
    return `${normalizeOrigin(origin)}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
}

function resolvePublicAssetOrigin(req, env = process.env) {
    const configured = firstConfigured(env, [
        'PUBLIC_ASSET_URL',
        'PUBLIC_BASE_URL',
        'API_URL',
        'BASE_URL',
    ]);
    if (configured) return configured;
    if (req) return normalizeOrigin(`${req.protocol}://${req.get('host')}`);
    return getOrigins(env).publicAssets;
}

module.exports = {
    DEVELOPMENT_DEFAULTS,
    PRODUCTION_DEFAULTS,
    getOrigins,
    joinOrigin,
    normalizeOrigin,
    resolvePublicAssetOrigin,
};
