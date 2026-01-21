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

        // Check if this operation was already performed
        const cachedResult = await AuditService.checkIdempotency(
            idempotencyKey,
            userId,
            shopId,
            req.originalUrl,
            req.method,
            req.body
        );

        if (cachedResult) {
            // Return cached response
            return res.status(cachedResult.statusCode).json(cachedResult.data);
        }

        // Store idempotency info for later use in response
        req.idempotencyKey = idempotencyKey;
        req.idempotencyData = {
            userId,
            shopId,
            endpoint: req.originalUrl,
            method: req.method,
            requestData: req.body
        };

        next();
    } catch (error) {
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
 * Middleware to store successful idempotency results
 * Should be used after successful operations
 */
const storeIdempotencyResult = (statusCode = 200) => {
    return (req, res, next) => {
        if (req.idempotencyKey && req.idempotencyData) {
            // Store the result asynchronously (don't wait for it)
            AuditService.storeIdempotencyResult(
                req.idempotencyKey,
                req.idempotencyData.userId,
                req.idempotencyData.shopId,
                req.idempotencyData.endpoint,
                req.idempotencyData.method,
                req.idempotencyData.requestData,
                statusCode,
                res.locals.responseData || null
            ).catch(error => {
                console.error('Failed to store idempotency result:', error);
            });
        }
        next();
    };
};

module.exports = {
    idempotencyMiddleware,
    storeIdempotencyResult
};