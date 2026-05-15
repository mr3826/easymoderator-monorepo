const AuditService = require('../audit/audit.service');

/**
 * Middleware to handle idempotency keys
 * Should be used for POST, PUT, PATCH, DELETE operations
 */
const idempotencyMiddleware = async (req, res, next) => {
    const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];

    if (!idempotencyKey) {
        // No idempotency key provided, continue normally
        return next();
    }

    // Validate idempotency key format (should be UUID or similar)
    if (!isValidIdempotencyKey(idempotencyKey)) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Invalid idempotency key format'
            }
        });
    }

    try {
        const { userId, shopId } = req.user || {};
        if (!userId || !shopId) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'AUTH_ERROR',
                    message: 'Authentication required for idempotent operations'
                }
            });
        }

        // Atomically claim the key (or retrieve the existing state).
        // Uses findOrCreate + DB unique constraint to eliminate TOCTOU race.
        const state = await AuditService.checkIdempotency(
            idempotencyKey,
            userId,
            shopId,
            req.originalUrl,
            req.method,
            req.body
        );

        if (state !== null) {
            if (state.inFlight) {
                // Another request with this key is currently executing
                return res.status(409).json({
                    success: false,
                    error: {
                        code: 'CONFLICT',
                        message: 'A request with this idempotency key is already in progress. Retry after it completes.'
                    }
                });
            }
            // Completed request — replay cached response
            return res.status(state.statusCode).json(state.data);
        }

        // Key was just claimed by us — intercept res.json to store response BEFORE
        // flushing to client, eliminating the race window between "response sent" and
        // "idempotency record updated".
        const originalJson = res.json.bind(res);
        res.json = async function(body) {
            await AuditService.storeIdempotencyResult(
                idempotencyKey,
                shopId,
                this.statusCode,
                body
            ).catch(err => console.error('Failed to store idempotency result:', err));
            return originalJson(body);
        };

        next();
    } catch (error) {
        if (error.message === 'Idempotency key used with different request data') {
            return res.status(422).json({
                success: false,
                error: {
                    code: 'IDEMPOTENCY_CONFLICT',
                    message: 'This idempotency key was previously used with different request data.'
                }
            });
        }
        console.error('Idempotency middleware error:', error);
        return res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Idempotency check failed'
            }
        });
    }
};

/**
 * Validate idempotency key format
 */
function isValidIdempotencyKey(key) {
    // Accept UUID v4 format or any string of reasonable length
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(key) || (typeof key === 'string' && key.length >= 10 && key.length <= 128);
}

/**
 * @deprecated Storage is now handled inline inside idempotencyMiddleware via res.json
 * interception. This export is kept for backward compatibility but is a no-op.
 * Remove from route definitions in a future cleanup pass.
 */
const storeIdempotencyResult = (_statusCode = 200) => {
    return (_req, _res, next) => next();
};

module.exports = {
    idempotencyMiddleware,
    storeIdempotencyResult
};
