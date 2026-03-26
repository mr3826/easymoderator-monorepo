/**
 * API Key Authentication Middleware
 *
 * Reads the `Authorization: ApiKey <rawKey>` header, validates it via the
 * api-key service, and attaches `req.shopId` and `req.apiKeyScopes` to the
 * request.
 *
 * Usage: router.use(apiKeyAuth) — applies to all routes on the router.
 * Or:    router.get('/...', apiKeyAuth, handler) — applies to a single route.
 */

const { validateApiKey } = require('./api-key.service');

const apiKeyAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('ApiKey ')) {
        return res.status(401).json({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'API key required. Use Authorization: ApiKey <key>' }
        });
    }

    const rawKey = authHeader.slice('ApiKey '.length).trim();

    try {
        const result = await validateApiKey(rawKey);
        if (!result) {
            return res.status(401).json({
                success: false,
                error: { code: 'INVALID_API_KEY', message: 'Invalid or revoked API key' }
            });
        }

        req.shopId = result.shopId;
        req.apiKeyScopes = result.scopes;
        next();
    } catch (err) {
        next(err);
    }
};

/**
 * Require a specific scope to be present in req.apiKeyScopes.
 * Must be used after apiKeyAuth.
 *
 * @param {string} scope - e.g. 'orders:read'
 */
const requireScope = (scope) => (req, res, next) => {
    if (!req.apiKeyScopes || !req.apiKeyScopes.includes(scope)) {
        return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: `This API key lacks the required scope: ${scope}` }
        });
    }
    next();
};

module.exports = { apiKeyAuth, requireScope };
