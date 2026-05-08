/**
 * Conversation Lock Service - Task 5
 * Redis-based mutual exclusion for conversation processing
 * Prevents concurrent message processing for same conversation
 * <50ms lock acquisition target, 30s+ TTL with refresh capability
 * 
 * @module services/conversation-lock.service
 */

const logger = require('../utils/structured-logger');
const { AppError } = require('../utils/app-error');
const crypto = require('crypto');

class ConversationLockService {
  constructor(redisClient, options = {}) {
    this.redis = redisClient;
    this.defaultTTL = options.ttl || 30; // seconds
    this.minTTL = options.minTTL || 30;
    this.maxTTL = options.maxTTL || 300;
    this.acquireTimeout = options.acquireTimeout || 5000; // ms
    this.refreshThreshold = options.refreshThreshold || 0.3; // Refresh at 30% of TTL remaining
    
    this.locks = new Map(); // Track local lock instances
  }

  /**
   * Acquire lock for a conversation
   * Returns lock token for later release/refresh
   * @async
   * @param {string} conversationId - Conversation ID to lock
   * @param {Object} options - Acquisition options
   * @returns {Promise<Object>} Lock token and metadata
   */
  async acquireLock(conversationId, options = {}) {
    const startTime = Date.now();
    const lockKey = this._getLockKey(conversationId);
    const lockToken = crypto.randomBytes(16).toString('hex');
    const ttl = Math.min(
      Math.max(options.ttl || this.defaultTTL, this.minTTL),
      this.maxTTL
    );

    const context = {
      operation: 'acquireLock',
      conversationId,
      ttl,
      lockToken: lockToken.substring(0, 8)
    };

    try {
      // Try to acquire lock with SET NX (only if not exists)
      const acquired = await this.redis.set(
        lockKey,
        lockToken,
        'EX',
        ttl,
        'NX'
      );

      const elapsed = Date.now() - startTime;

      if (acquired === 'OK' || acquired === 1) {
        // Lock acquired successfully
        logger.debug('Lock acquired', {
          ...context,
          elapsed
        });

        const lockMetadata = {
          conversationId,
          lockToken,
          lockKey,
          ttl,
          acquiredAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
          elapsed
        };

        // Track lock locally
        this.locks.set(lockToken, {
          ...lockMetadata,
          refreshInterval: null,
          shouldAutoRefresh: options.autoRefresh !== false
        });

        // Setup auto-refresh if enabled
        if (options.autoRefresh !== false) {
          this._setupAutoRefresh(lockToken, conversationId, ttl);
        }

        return lockMetadata;
      }

      // Lock not acquired - someone else has it
      // Optionally wait and retry
      if (options.waitForRelease) {
        return this._waitForLockWithRetry(
          conversationId,
          lockToken,
          ttl,
          options
        );
      }

      throw new AppError(
        'LOCK_ALREADY_ACQUIRED',
        `Conversation ${conversationId} is being processed by another request`,
        409
      );

    } catch (error) {
      if (error instanceof AppError) throw error;

      logger.error('Failed to acquire lock', {
        ...context,
        error: error.message
      });

      throw new AppError(
        'LOCK_ACQUISITION_FAILED',
        'Unable to acquire conversation lock',
        500
      );
    }
  }

  /**
   * Release lock
   * @async
   * @param {string} lockToken - Lock token from acquireLock
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Object>} Release result
   */
  async releaseLock(lockToken, conversationId) {
    const lockKey = this._getLockKey(conversationId);

    const context = {
      operation: 'releaseLock',
      conversationId,
      lockToken: lockToken.substring(0, 8)
    };

    try {
      // Clear auto-refresh
      const lockMeta = this.locks.get(lockToken);
      if (lockMeta?.refreshInterval) {
        clearInterval(lockMeta.refreshInterval);
      }

      // Use Lua script to atomically verify and delete
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;

      const result = await this.redis.eval(script, 1, lockKey, lockToken);

      // Clean up local tracking
      this.locks.delete(lockToken);

      if (result === 1) {
        logger.debug('Lock released', context);

        return {
          success: true,
          conversationId,
          timestamp: new Date().toISOString()
        };
      } else {
        logger.warn('Lock token mismatch on release', {
          ...context,
          error: 'Token does not match current holder'
        });

        return {
          success: false,
          reason: 'Token mismatch',
          conversationId,
          timestamp: new Date().toISOString()
        };
      }

    } catch (error) {
      logger.error('Failed to release lock', {
        ...context,
        error: error.message
      });

      throw new AppError(
        'LOCK_RELEASE_FAILED',
        'Unable to release conversation lock',
        500
      );
    }
  }

  /**
   * Refresh lock TTL
   * @async
   * @param {string} lockToken - Lock token
   * @param {string} conversationId - Conversation ID
   * @param {number} extendBy - Extend TTL by N seconds (default: original TTL)
   * @returns {Promise<Object>} Refresh result
   */
  async refreshLock(lockToken, conversationId, extendBy = null) {
    const lockKey = this._getLockKey(conversationId);
    const lockMeta = this.locks.get(lockToken);

    if (!lockMeta) {
      throw new AppError(
        'LOCK_NOT_FOUND',
        'Lock token not found in local cache',
        404
      );
    }

    const ttlToAdd = Math.min(
      Math.max(extendBy || lockMeta.ttl, this.minTTL),
      this.maxTTL
    );

    const context = {
      operation: 'refreshLock',
      conversationId,
      ttlToAdd,
      lockToken: lockToken.substring(0, 8)
    };

    try {
      // Use Lua script to atomically verify and extend
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("expire", KEYS[1], ARGV[2])
        else
          return 0
        end
      `;

      const result = await this.redis.eval(
        script,
        1,
        lockKey,
        lockToken,
        ttlToAdd
      );

      if (result === 1) {
        const newExpiry = new Date(Date.now() + ttlToAdd * 1000).toISOString();
        
        // Update local metadata
        lockMeta.ttl = ttlToAdd;
        lockMeta.expiresAt = newExpiry;
        lockMeta.lastRefresh = new Date().toISOString();

        logger.debug('Lock refreshed', {
          ...context,
          newExpiry
        });

        return {
          success: true,
          conversationId,
          newTTL: ttlToAdd,
          newExpiresAt: newExpiry,
          timestamp: new Date().toISOString()
        };
      } else {
        throw new AppError(
          'LOCK_REFRESH_FAILED',
          'Lock token mismatch or lock expired',
          409
        );
      }

    } catch (error) {
      if (error instanceof AppError) throw error;

      logger.error('Failed to refresh lock', {
        ...context,
        error: error.message
      });

      throw new AppError(
        'LOCK_REFRESH_ERROR',
        'Unable to refresh conversation lock',
        500
      );
    }
  }

  /**
   * Check if lock is held and by whom
   * @async
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Object>} Lock status
   */
  async getLockStatus(conversationId) {
    const lockKey = this._getLockKey(conversationId);

    try {
      const token = await this.redis.get(lockKey);
      const ttl = await this.redis.ttl(lockKey);

      if (token) {
        return {
          locked: true,
          conversationId,
          tokenHolder: token.substring(0, 8),
          ttl,
          expiresAt: new Date(Date.now() + (ttl * 1000)).toISOString()
        };
      } else {
        return {
          locked: false,
          conversationId,
          timestamp: new Date().toISOString()
        };
      }

    } catch (error) {
      logger.error('Failed to get lock status', {
        conversationId,
        error: error.message
      });

      throw new AppError(
        'LOCK_STATUS_FAILED',
        'Unable to check lock status',
        500
      );
    }
  }

  /**
   * Force unlock (admin only)
   * @async
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Object>} Force unlock result
   */
  async forceUnlock(conversationId) {
    const lockKey = this._getLockKey(conversationId);

    try {
      // Clear any local tracking for this conversation
      for (const [token, meta] of this.locks.entries()) {
        if (meta.conversationId === conversationId) {
          if (meta.refreshInterval) {
            clearInterval(meta.refreshInterval);
          }
          this.locks.delete(token);
        }
      }

      const deleted = await this.redis.del(lockKey);

      logger.warn('Lock force unlocked', {
        operation: 'forceUnlock',
        conversationId,
        deleted: deleted === 1
      });

      return {
        success: deleted === 1,
        conversationId,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Failed to force unlock', {
        conversationId,
        error: error.message
      });

      throw new AppError(
        'FORCE_UNLOCK_FAILED',
        'Unable to force unlock conversation',
        500
      );
    }
  }

  /**
   * Setup auto-refresh for long-running operations
   * @private
   */
  _setupAutoRefresh(lockToken, conversationId, ttl) {
    const lockMeta = this.locks.get(lockToken);
    if (!lockMeta) return;

    const refreshInterval = Math.floor(ttl * 1000 * this.refreshThreshold);

    const intervalId = setInterval(async () => {
      try {
        await this.refreshLock(lockToken, conversationId);
        logger.debug('Auto-refresh executed', { conversationId });
      } catch (error) {
        logger.warn('Auto-refresh failed', {
          conversationId,
          error: error.message
        });

        // Stop trying to refresh if it fails
        clearInterval(intervalId);
      }
    }, refreshInterval);

    lockMeta.refreshInterval = intervalId;
  }

  /**
   * Wait for lock to be released with retry
   * @private
   * @async
   */
  async _waitForLockWithRetry(conversationId, lockToken, ttl, options) {
    const maxWaitTime = options.maxWaitTime || 10000; // 10 seconds
    const pollInterval = options.pollInterval || 100; // 100ms
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const status = await this.getLockStatus(conversationId);

      if (!status.locked) {
        // Lock was released, try to acquire
        const acquired = await this.redis.set(
          this._getLockKey(conversationId),
          lockToken,
          'EX',
          ttl,
          'NX'
        );

        if (acquired === 'OK' || acquired === 1) {
          return {
            conversationId,
            lockToken,
            ttl,
            acquiredAt: new Date().toISOString(),
            waitedMs: Date.now() - startTime
          };
        }
      }

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new AppError(
      'LOCK_WAIT_TIMEOUT',
      `Could not acquire lock within ${maxWaitTime}ms`,
      408
    );
  }

  /**
   * Get lock key for Redis
   * @private
   */
  _getLockKey(conversationId) {
    return `conversation:lock:${conversationId}`;
  }

  /**
   * Cleanup: Release all local locks
   * @async
   */
  async cleanup() {
    const promises = [];

    for (const [token, meta] of this.locks.entries()) {
      if (meta.refreshInterval) {
        clearInterval(meta.refreshInterval);
      }

      promises.push(
        this.releaseLock(token, meta.conversationId).catch(err => {
          logger.warn('Cleanup: Failed to release lock', {
            conversationId: meta.conversationId,
            error: err.message
          });
        })
      );
    }

    await Promise.all(promises);
    this.locks.clear();

    logger.info('Conversation lock service cleaned up');
  }

  /**
   * Get statistics
   * @returns {Object} Current lock statistics
   */
  getStats() {
    return {
      locksHeld: this.locks.size,
      configuration: {
        defaultTTL: this.defaultTTL,
        minTTL: this.minTTL,
        maxTTL: this.maxTTL,
        acquireTimeout: this.acquireTimeout,
        refreshThreshold: this.refreshThreshold
      },
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = ConversationLockService;
