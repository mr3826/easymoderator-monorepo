// src/modules/conversation/conversation-lock.service.js
// TASK 5: Conversation Locking Service (NEW)
// Purpose: Prevent race conditions when processing concurrent messages in same conversation
// Owner: Lead Dev
// Effort: 1.5 days
// Deadline: End of Day 4

const { Injectable, Logger } = require('@nestjs/common');
const Redis = require('ioredis');

@Injectable()
class ConversationLockService {
  private logger = new Logger('ConversationLockService');
  private redis;

  constructor(redisService) {
    this.redis = redisService.getClient();
  }

  /**
   * LOCK: Acquire exclusive lock on conversation
   * 
   * Purpose: Ensure only one LLM call processes per conversation at a time
   * This prevents:
   *   1. Race condition: Message A and B both get LLM responses simultaneously
   *   2. State corruption: Message order gets scrambled
   *   3. Double charges: Same message gets 2 LLM calls
   * 
   * @param conversationId - Unique conversation ID
   * @param lockTimeoutMs - Max time to hold lock (default: 5000ms)
   * @returns { lockId, acquiredAt, expiresAt }
   * 
   * Example:
   *   const lock = await conversationLockService.acquireLock('conv_123', 5000);
   *   // ... do work ...
   *   await conversationLockService.releaseLock('conv_123', lock.lockId);
   */
  async acquireLock(conversationId, lockTimeoutMs = 5000) {
    const lockId = this.generateLockId();
    const lockKey = `lock:conversation:${conversationId}`;
    const acquiredAt = Date.now();
    const expiresAt = acquiredAt + lockTimeoutMs;

    this.logger.debug(`[LOCK] Acquiring lock for conversation ${conversationId} (timeout: ${lockTimeoutMs}ms)`);

    try {
      // Try to set lock with NX (only if not exists) and PX (expiration in ms)
      // Redis SET is atomic, so this is safe
      const result = await this.redis.set(
        lockKey,
        lockId,
        'PX', lockTimeoutMs,  // Expire in lockTimeoutMs milliseconds
        'NX'                   // Only set if key doesn't exist
      );

      if (result === 'OK') {
        this.logger.debug(`[LOCK] ✅ Acquired lock ${lockId} for conversation ${conversationId}`);
        
        // Record lock acquisition in telemetry
        await this.recordLockEvent('ACQUIRED', conversationId, lockId, lockTimeoutMs);

        return {
          lockId,
          conversationId,
          acquiredAt,
          expiresAt,
          success: true
        };
      } else {
        // Lock already held by another process
        this.logger.warn(`[LOCK] ⚠️ Lock already held for conversation ${conversationId}`);
        
        // Check how long until lock expires
        const ttl = await this.redis.pttl(lockKey); // TTL in milliseconds
        
        return {
          lockId,
          conversationId,
          acquiredAt,
          expiresAt,
          success: false,
          error: 'LOCK_ALREADY_HELD',
          lockExpiresInMs: ttl
        };
      }

    } catch (error) {
      this.logger.error(`[LOCK] ❌ Failed to acquire lock: ${error.message}`);
      throw new Error(`Failed to acquire conversation lock: ${error.message}`);
    }
  }

  /**
   * RELEASE: Voluntarily release lock (before timeout)
   * 
   * @param conversationId - Conversation ID
   * @param lockId - Lock ID to verify (security: prevents releasing wrong lock)
   * @returns { success, lockHeldFor }
   */
  async releaseLock(conversationId, lockId) {
    const lockKey = `lock:conversation:${conversationId}`;
    const acquiredAt = Date.now();

    this.logger.debug(`[LOCK] Releasing lock ${lockId} for conversation ${conversationId}`);

    try {
      // Verify lock is still ours before deleting
      const storedLockId = await this.redis.get(lockKey);

      if (storedLockId !== lockId) {
        this.logger.warn(
          `[LOCK] ⚠️ Lock ownership mismatch for ${conversationId}. ` +
          `Expected ${lockId}, got ${storedLockId}`
        );
        return {
          success: false,
          error: 'LOCK_MISMATCH',
          message: 'Lock is owned by another process'
        };
      }

      // Delete lock
      const deleted = await this.redis.del(lockKey);

      if (deleted === 1) {
        this.logger.debug(`[LOCK] ✅ Released lock ${lockId} for conversation ${conversationId}`);
        
        await this.recordLockEvent('RELEASED', conversationId, lockId, Math.random() * 5000);

        return {
          success: true
        };
      } else {
        this.logger.warn(`[LOCK] ⚠️ Lock already expired for ${conversationId}`);
        return {
          success: false,
          error: 'LOCK_EXPIRED',
          message: 'Lock already released by timeout'
        };
      }

    } catch (error) {
      this.logger.error(`[LOCK] ❌ Failed to release lock: ${error.message}`);
      throw new Error(`Failed to release conversation lock: ${error.message}`);
    }
  }

  /**
   * CHECK LOCK: See if conversation is currently locked
   * 
   * @param conversationId - Conversation ID
   * @returns { isLocked, lockExpiresInMs }
   */
  async isConversationLocked(conversationId) {
    const lockKey = `lock:conversation:${conversationId}`;

    try {
      const exists = await this.redis.exists(lockKey);
      const ttl = await this.redis.pttl(lockKey); // -2 if not exists, -1 if no expiry

      return {
        isLocked: exists === 1,
        lockExpiresInMs: ttl > 0 ? ttl : null
      };

    } catch (error) {
      this.logger.error(`[LOCK] ❌ Failed to check lock status: ${error.message}`);
      return {
        isLocked: false,
        error: error.message
      };
    }
  }

  /**
   * WAIT FOR LOCK: Busy-wait until lock is released
   * 
   * @param conversationId - Conversation ID
   * @param maxWaitMs - Max time to wait (default: 10000ms)
   * @returns { acquired, waitedMs }
   */
  async waitForLockRelease(conversationId, maxWaitMs = 10000) {
    const lockKey = `lock:conversation:${conversationId}`;
    const startTime = Date.now();

    this.logger.debug(`[LOCK] Waiting for lock release (max: ${maxWaitMs}ms)`);

    while (Date.now() - startTime < maxWaitMs) {
      const exists = await this.redis.exists(lockKey);

      if (exists === 0) {
        const waitedMs = Date.now() - startTime;
        this.logger.debug(`[LOCK] ✅ Lock released after ${waitedMs}ms`);
        return {
          acquired: true,
          waitedMs
        };
      }

      // Wait 100ms before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.logger.warn(`[LOCK] ⚠️ Timeout waiting for lock (${maxWaitMs}ms)`);
    return {
      acquired: false,
      waitedMs: maxWaitMs,
      error: 'TIMEOUT'
    };
  }

  /**
   * Generate unique lock ID
   */
  private generateLockId() {
    return `lock_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Record lock events for telemetry/debugging
   */
  private async recordLockEvent(eventType, conversationId, lockId, durationMs) {
    try {
      // TODO: Send to telemetry/monitoring service
      this.logger.debug(`[TELEMETRY] LOCK_${eventType} conversation=${conversationId}`);
    } catch (error) {
      this.logger.warn(`Failed to record lock event: ${error.message}`);
    }
  }
}

module.exports = ConversationLockService;

/**
 * USAGE: Integrating into message processor
 * 
 * async processMessage(conversationId, message) {
 *   // Try to acquire lock (will timeout after 5 seconds)
 *   const lock = await this.conversationLockService.acquireLock(conversationId, 5000);
 *   
 *   if (!lock.success) {
 *     // Conversation is locked by another message
 *     // Option 1: Return error
 *     throw new Error('Conversation is being processed, try again shortly');
 *     
 *     // Option 2: Queue and retry (in separate task)
 *   }
 *   
 *   try {
 *     // Process message (LLM call, guardrails, response)
 *     const response = await this.llmService.call(message);
 *     await this.guardrailService.validate(response);
 *     await this.messageRepository.save(response);
 *     return response;
 *   } finally {
 *     // ALWAYS release lock
 *     await this.conversationLockService.releaseLock(conversationId, lock.lockId);
 *   }
 * }
 */
