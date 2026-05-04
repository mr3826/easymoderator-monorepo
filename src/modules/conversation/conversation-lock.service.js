'use strict';

const crypto = require('crypto');
const { cacheRedis } = require('../../config/redis');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('ConversationLockService');

class ConversationLockService {
    /**
     * Acquire exclusive lock on conversation.
     * Prevents race conditions when multiple messages arrive simultaneously.
     *
     * @param {string} conversationId
     * @param {number} lockTimeoutMs - Max lock duration (default 5000ms)
     * @returns {{ success, lockId, conversationId, acquiredAt, expiresAt, error? }}
     */
    async acquireLock(conversationId, lockTimeoutMs = 5000) {
        const lockId = this._generateLockId();
        const lockKey = `lock:conversation:${conversationId}`;
        const acquiredAt = Date.now();

        try {
            const result = await cacheRedis.set(lockKey, lockId, 'PX', lockTimeoutMs, 'NX');

            if (result === 'OK') {
                logger.debug(`[LOCK] Acquired ${lockId} for conv ${conversationId}`);
                return { success: true, lockId, conversationId, acquiredAt, expiresAt: acquiredAt + lockTimeoutMs };
            }

            const ttl = await cacheRedis.pttl(lockKey);
            logger.warn(`[LOCK] Already held for conv ${conversationId}, TTL=${ttl}ms`);
            return { success: false, lockId, conversationId, acquiredAt, expiresAt: acquiredAt, error: 'LOCK_ALREADY_HELD', lockExpiresInMs: ttl };
        } catch (error) {
            logger.error(`[LOCK] Failed to acquire lock: ${error.message}`);
            throw new Error(`Failed to acquire conversation lock: ${error.message}`);
        }
    }

    /**
     * Release lock — verifies ownership before deleting.
     * Uses Lua script for atomic check-and-delete to prevent releasing another process's lock.
     */
    async releaseLock(conversationId, lockId) {
        const lockKey = `lock:conversation:${conversationId}`;

        try {
            // Atomic check-and-delete: only del if value matches lockId
            const luaScript = `
                if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("del", KEYS[1])
                else
                    return 0
                end`;
            const deleted = await cacheRedis.eval(luaScript, 1, lockKey, lockId);

            if (deleted === 1) {
                logger.debug(`[LOCK] Released ${lockId} for conv ${conversationId}`);
                return { success: true };
            }

            logger.warn(`[LOCK] Mismatch or expired for conv ${conversationId}`);
            return { success: false, error: 'LOCK_MISMATCH_OR_EXPIRED' };
        } catch (error) {
            logger.error(`[LOCK] Failed to release lock: ${error.message}`);
            throw new Error(`Failed to release conversation lock: ${error.message}`);
        }
    }

    async isConversationLocked(conversationId) {
        const lockKey = `lock:conversation:${conversationId}`;
        try {
            const exists = await cacheRedis.exists(lockKey);
            const ttl = await cacheRedis.pttl(lockKey);
            return { isLocked: exists === 1, lockExpiresInMs: ttl > 0 ? ttl : null };
        } catch (error) {
            logger.error(`[LOCK] Failed to check lock status: ${error.message}`);
            return { isLocked: false, error: error.message };
        }
    }

    async waitForLockRelease(conversationId, maxWaitMs = 10000) {
        const lockKey = `lock:conversation:${conversationId}`;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitMs) {
            const exists = await cacheRedis.exists(lockKey);
            if (exists === 0) return { acquired: true, waitedMs: Date.now() - startTime };
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        return { acquired: false, waitedMs: maxWaitMs, error: 'TIMEOUT' };
    }

    _generateLockId() {
        return `lock_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
    }
}

module.exports = new ConversationLockService();
