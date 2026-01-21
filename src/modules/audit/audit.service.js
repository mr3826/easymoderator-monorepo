const AuditLog = require('./audit-log.entity');
const IdempotencyKey = require('./idempotency-key.entity');
const crypto = require('crypto');

/**
 * Audit service for logging operations and handling idempotency
 */
class AuditService {
    /**
     * Log an operation
     */
    static async logOperation({
        userId,
        shopId,
        action,
        resourceType,
        resourceId,
        oldValues = null,
        newValues = null,
        metadata = null,
        ipAddress = null,
        userAgent = null,
        idempotencyKey = null
    }) {
        try {
            await AuditLog.create({
                user_id: userId,
                shop_id: shopId,
                action,
                resource_type: resourceType,
                resource_id: resourceId,
                old_values: oldValues,
                new_values: newValues,
                metadata,
                ip_address: ipAddress,
                user_agent: userAgent,
                idempotency_key: idempotencyKey
            });
        } catch (error) {
            // Log audit failure but don't fail the operation
            console.error('Failed to create audit log:', error);
        }
    }

    /**
     * Check if an idempotency key exists and return cached response
     */
    static async checkIdempotency(idempotencyKey, userId, shopId, endpoint, method, requestData) {
        if (!idempotencyKey) return null;

        try {
            // Create request hash for comparison
            const requestHash = this.createRequestHash(requestData);

            const existingKey = await IdempotencyKey.findOne({
                where: {
                    idempotency_key: idempotencyKey,
                    user_id: userId,
                    shop_id: shopId,
                    endpoint,
                    method
                }
            });

            if (existingKey) {
                // Check if request hash matches (for safety)
                if (existingKey.request_hash === requestHash) {
                    return {
                        statusCode: existingKey.status_code,
                        data: existingKey.response_data
                    };
                } else {
                    // Hash mismatch - this is a different request with same key
                    throw new Error('Idempotency key used with different request data');
                }
            }

            return null; // Key doesn't exist, proceed with operation
        } catch (error) {
            console.error('Idempotency check failed:', error);
            throw error;
        }
    }

    /**
     * Store idempotency key result
     */
    static async storeIdempotencyResult(idempotencyKey, userId, shopId, endpoint, method, requestData, statusCode, responseData) {
        if (!idempotencyKey) return;

        try {
            const requestHash = this.createRequestHash(requestData);

            await IdempotencyKey.create({
                idempotency_key: idempotencyKey,
                user_id: userId,
                shop_id: shopId,
                endpoint,
                method,
                request_hash: requestHash,
                response_data: responseData,
                status_code: statusCode
            });
        } catch (error) {
            // If it's a unique constraint error, the key was already stored
            if (error.name !== 'SequelizeUniqueConstraintError') {
                console.error('Failed to store idempotency key:', error);
            }
        }
    }

    /**
     * Create a hash of request data for idempotency checking
     */
    static createRequestHash(data) {
        const sortedData = JSON.stringify(data, Object.keys(data).sort());
        return crypto.createHash('sha256').update(sortedData).digest('hex');
    }

    /**
     * Clean up expired idempotency keys (should be called periodically)
     */
    static async cleanupExpiredIdempotencyKeys() {
        try {
            const deletedCount = await IdempotencyKey.cleanupExpired();
            console.log(`Cleaned up ${deletedCount} expired idempotency keys`);
            return deletedCount;
        } catch (error) {
            console.error('Failed to cleanup expired idempotency keys:', error);
            return 0;
        }
    }

    /**
     * Get audit logs for a resource
     */
    static async getAuditLogs(resourceType, resourceId, options = {}) {
        const { limit = 50, offset = 0 } = options;

        return await AuditLog.findAll({
            where: {
                resource_type: resourceType,
                resource_id: resourceId
            },
            order: [['created_at', 'DESC']],
            limit,
            offset,
            include: [
                {
                    model: require('src/modules/user/user.entity'),
                    as: 'user',
                    attributes: ['id', 'full_name', 'email']
                }
            ]
        });
    }

    /**
     * Get audit logs for a shop
     */
    static async getShopAuditLogs(shopId, options = {}) {
        const { limit = 100, offset = 0, userId, action, resourceType, startDate, endDate } = options;

        const whereClause = { shop_id: shopId };

        if (userId) whereClause.user_id = userId;
        if (action) whereClause.action = action;
        if (resourceType) whereClause.resource_type = resourceType;
        if (startDate || endDate) {
            whereClause.created_at = {};
            if (startDate) whereClause.created_at[require('sequelize').Op.gte] = startDate;
            if (endDate) whereClause.created_at[require('sequelize').Op.lte] = endDate;
        }

        return await AuditLog.findAll({
            where: whereClause,
            order: [['created_at', 'DESC']],
            limit,
            offset,
            include: [
                {
                    model: require('src/modules/user/user.entity'),
                    as: 'user',
                    attributes: ['id', 'full_name', 'email']
                }
            ]
        });
    }
}

module.exports = AuditService;