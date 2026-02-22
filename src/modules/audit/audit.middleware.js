const AuditService = require('../audit/audit.service');

/**
 * Middleware to automatically log operations
 * Should be used after successful operations
 */
const auditLogMiddleware = (action, resourceType) => {
    return async (req, res, next) => {
        // Store original response.json method
        const originalJson = res.json;

        res.json = function(data) {
            // Store response data for audit logging
            res.locals.responseData = data;

            // Call original method
            originalJson.call(this, data);
        };

        // Wait for response to finish
        res.on('finish', async () => {
            try {
                if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
                    const { userId, shopId } = req.user;

                    // Extract resource ID from various sources
                    let resourceId = null;

                    // Try to get from response data
                    if (res.locals.responseData?.data?.id) {
                        resourceId = res.locals.responseData.data.id;
                    }
                    // Try to get from URL params
                    else if (req.params.id) {
                        resourceId = req.params.id;
                    }
                    // Try to get from request body
                    else if (req.body?.id) {
                        resourceId = req.body.id;
                    }
                    else if (req.body?.customerId) {
                        resourceId = req.body.customerId;
                    }

                    if (resourceId) {
                        let oldValues = null;
                        let newValues = null;
                        let metadata = null;

                        // For updates, try to capture old/new values
                        if (action === 'UPDATE' && res.locals.oldValues && res.locals.newValues) {
                            oldValues = res.locals.oldValues;
                            newValues = res.locals.newValues;
                        }

                        // Add request metadata
                        metadata = {
                            method: req.method,
                            url: req.originalUrl,
                            userAgent: req.get('User-Agent'),
                            endpoint: req.route?.path || req.path
                        };

                        await AuditService.logOperation({
                            userId,
                            shopId,
                            action,
                            resourceType,
                            resourceId,
                            oldValues,
                            newValues,
                            metadata,
                            ipAddress: req.ip || req.connection.remoteAddress,
                            userAgent: req.get('User-Agent'),
                            idempotencyKey: req.idempotencyKey
                        });
                    }
                }
            } catch (error) {
                console.error('Audit logging failed:', error);
                // Don't fail the request due to audit logging failure
            }
        });

        next();
    };
};

/**
 * Helper to set old/new values for audit logging (use in controllers)
 */
const setAuditValues = (oldValues, newValues) => {
    return (req, res, next) => {
        res.locals.oldValues = oldValues;
        res.locals.newValues = newValues;
        next();
    };
};

module.exports = {
    auditLogMiddleware,
    setAuditValues
};
