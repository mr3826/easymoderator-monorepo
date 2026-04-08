const auditService = require('./audit.service');
const { AppError } = require('../../utils/AppError');

/**
 * Get audit logs for the shop with filters
 */
const getAuditLogs = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const options = {
            limit: parseInt(req.query.limit) || 100,
            offset: parseInt(req.query.offset) || 0,
            userId: req.query.userId,
            action: req.query.action,
            resourceType: req.query.resourceType,
            startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
            endDate: req.query.endDate ? new Date(req.query.endDate) : undefined
        };

        const logs = await auditService.getShopAuditLogs(shopId, options);

        res.status(200).json({
            success: true,
            data: logs
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get audit logs for a specific resource
 */
const getResourceAuditLogs = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { type, id } = req.params;
        const options = {
            limit: parseInt(req.query.limit) || 50,
            offset: parseInt(req.query.offset) || 0
        };

        // Validate resource type
        const validTypes = ['USER', 'SHOP', 'CHANNEL', 'CUSTOMER', 'PRODUCT', 'ORDER', 'CATEGORY', 'CONVERSATION', 'MESSAGE', 'PAYMENT'];
        if (!validTypes.includes(type.toUpperCase())) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Invalid resource type'
                }
            });
        }

        const logs = await auditService.getAuditLogs(type.toUpperCase(), id, options);

        res.status(200).json({
            success: true,
            data: logs
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Clean up expired idempotency keys (admin operation)
 */
const cleanupIdempotencyKeys = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        if (req.user?.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: 'Admin role required.'
                }
            });
        }

        const deletedCount = await auditService.cleanupExpiredIdempotencyKeys();

        res.status(200).json({
            success: true,
            data: {
                message: `Cleaned up ${deletedCount} expired idempotency keys`
            }
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getAuditLogs,
    getResourceAuditLogs,
    cleanupIdempotencyKeys
};
