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
     * Atomically claim an idempotency key and return its current state.
     *
     * Two-phase flow to eliminate the TOCTOU race:
     *   Phase 1 (here): findOrCreate a placeholder record (response_data = null).
     *                   The DB composite unique constraint on (idempotency_key, shop_id)
     *                   guarantees only one caller "wins" even under concurrency.
     *   Phase 2 (storeIdempotencyResult): update the placeholder with actual response.
     *
     * Returns:
     *   null                   → key is newly claimed, proceed with the operation
     *   { inFlight: true }     → another request with this key is currently executing
     *   { statusCode, data }   → operation already completed, return cached response
     *
     * @throws {Error} if key is reused with different request body
     */
    static async checkIdempotency(idempotencyKey, userId, shopId, endpoint, method, requestData) {
        if (!idempotencyKey) return null;

        const requestHash = this.createRequestHash(requestData);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        let record, created;
        try {
            [record, created] = await IdempotencyKey.findOrCreate({
                where: { idempotency_key: idempotencyKey, shop_id: shopId },
                defaults: {
                    user_id: userId,
                    endpoint,
                    method,
                    request_hash: requestHash,
                    response_data: null,
                    status_code: null,
                    expires_at: expiresAt
                }
            });
        } catch (error) {
            if (error.name === 'SequelizeUniqueConstraintError') {
                // Concurrent request won the race — retry findOne to read the winner's record
                record = await IdempotencyKey.findOne({
                    where: { idempotency_key: idempotencyKey, shop_id: shopId }
                });
                created = false;
            } else {
                throw error;
            }
        }

        if (created) {
            // We claimed this key slot — proceed with the operation
            return null;
        }

        // Key already exists — validate the request body matches
        if (record.request_hash !== requestHash) {
            throw new Error('Idempotency key used with different request data');
        }

        // No response yet — another in-flight request holds this key
        if (record.response_data === null && record.status_code === null) {
            return { inFlight: true };
        }

        // Completed request — return cached response
        return { statusCode: record.status_code, data: record.response_data };
    }

    /**
     * Persist the response for a previously claimed idempotency key.
     * Updates the placeholder record created by checkIdempotency().
     */
    static async storeIdempotencyResult(idempotencyKey, shopId, statusCode, responseData) {
        if (!idempotencyKey) return;

        try {
            await IdempotencyKey.update(
                { response_data: responseData, status_code: statusCode },
                { where: { idempotency_key: idempotencyKey, shop_id: shopId } }
            );
        } catch (error) {
            console.error('Failed to store idempotency result:', error);
        }
    }

    /**
     * Create a deterministic hash of request data.
     * Deep-sorts all object keys so {b:1, a:2} and {a:2, b:1} produce the same hash.
     */
    static createRequestHash(data) {
        if (data === null || data === undefined) {
            return crypto.createHash('sha256').update('').digest('hex');
        }
        if (typeof data !== 'object') {
            return crypto.createHash('sha256').update(String(data)).digest('hex');
        }
        const deepSort = (val) => {
            if (val && typeof val === 'object' && !Array.isArray(val)) {
                return Object.fromEntries(
                    Object.entries(val)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([k, v]) => [k, deepSort(v)])
                );
            }
            return val;
        };
        return crypto.createHash('sha256').update(JSON.stringify(deepSort(data))).digest('hex');
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
