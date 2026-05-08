/**
 * Cost Cap Service - Task 3
 * Validates message cost against shop's maximum auto-order value
 * Returns comprehensive cost validation result
 * 
 * @module services/cost-cap.service
 */

const logger = require('../utils/structured-logger');
const { AppError } = require('../utils/app-error');

class CostCapService {
  constructor(dbConnection) {
    this.db = dbConnection;
    this.costCache = new Map(); // Cache for 5 minutes
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Calculate token cost for a message
   * @private
   * @param {number} tokenCount - Number of tokens
   * @param {string} provider - LLM provider (gemini, openai)
   * @param {string} model - Model name
   * @returns {number} Cost in dollars
   */
  _calculateTokenCost(tokenCount, provider, model) {
    // Pricing as of 2025 (update as needed)
    const pricing = {
      gemini: {
        'gemini-2.0-flash': { input: 0.0001, output: 0.0004 },
        'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
        'gemini-1.5-pro': { input: 0.00125, output: 0.005 }
      },
      openai: {
        'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
        'gpt-4o': { input: 0.005, output: 0.015 },
        'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 }
      }
    };

    const providerPricing = pricing[provider];
    if (!providerPricing) {
      logger.warn(`Unknown provider for pricing: ${provider}`);
      // Default to safe estimate
      return tokenCount * 0.00002; // $0.00002 per token
    }

    const modelPricing = providerPricing[model] || 
      Object.values(providerPricing)[0] || 
      { input: 0.001, output: 0.003 };

    // Assume roughly 70% input, 30% output split for safety
    const estimatedInputTokens = Math.floor(tokenCount * 0.7);
    const estimatedOutputTokens = Math.floor(tokenCount * 0.3);

    const cost = 
      (estimatedInputTokens * modelPricing.input / 1000) +
      (estimatedOutputTokens * modelPricing.output / 1000);

    return cost;
  }

  /**
   * Get shop's cost limit from database
   * @private
   * @async
   * @param {string} shopId - Shop ID
   * @returns {Promise<number>} Max auto order value in dollars
   */
  async _getShopCostLimit(shopId) {
    const cacheKey = `shop_limit_${shopId}`;
    const cached = this.costCache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
      return cached.limit;
    }

    try {
      const client = await this.db.getConnection();

      const query = `
        SELECT max_auto_order_value
        FROM shops
        WHERE id = $1 AND is_active = true
      `;

      const result = await client.query(query, [shopId]);

      if (result.rows.length === 0) {
        throw new AppError('SHOP_NOT_FOUND', `Shop ${shopId} not found`, 404);
      }

      const limit = parseFloat(result.rows[0].max_auto_order_value) || 50; // Default $50

      // Cache the result
      this.costCache.set(cacheKey, {
        limit,
        timestamp: Date.now()
      });

      logger.debug('Shop cost limit retrieved', {
        shopId,
        limit,
        source: 'database'
      });

      await client.release();

      return limit;

    } catch (error) {
      if (error instanceof AppError) throw error;

      logger.error('Failed to get shop cost limit', {
        shopId,
        error: error.message
      });

      throw new AppError(
        'COST_LIMIT_LOOKUP_FAILED',
        'Unable to retrieve shop cost limit',
        500
      );
    }
  }

  /**
   * Validate message cost against shop limit
   * @async
   * @param {string} shopId - Shop ID
   * @param {number} tokenCount - Estimated or actual token count
   * @param {string} provider - LLM provider name
   * @param {string} model - Model name
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Cost validation result
   */
  async validateCost(shopId, tokenCount, provider, model, options = {}) {
    const context = {
      operation: 'validateCost',
      shopId,
      tokenCount,
      provider,
      model,
      timestamp: new Date().toISOString()
    };

    try {
      // Calculate cost
      const estimatedCost = this._calculateTokenCost(tokenCount, provider, model);

      // Get shop's cost limit
      const costLimit = await this._getShopCostLimit(shopId);

      // Determine if cost is allowed
      const allowed = estimatedCost <= costLimit;

      const reason = allowed
        ? `Cost ${estimatedCost.toFixed(4)} is within limit of ${costLimit.toFixed(2)}`
        : `Cost ${estimatedCost.toFixed(4)} exceeds limit of ${costLimit.toFixed(2)}`;

      const auditLog = {
        shopId,
        tokenCount,
        estimatedCost,
        costLimit,
        allowed,
        provider,
        model,
        timestamp: new Date().toISOString(),
        ipAddress: options.ipAddress,
        userId: options.userId
      };

      if (allowed) {
        logger.info('Cost validation passed', {
          ...context,
          cost: estimatedCost,
          limit: costLimit
        });
      } else {
        logger.warn('Cost validation failed - limit exceeded', {
          ...context,
          cost: estimatedCost,
          limit: costLimit
        });
      }

      // Store audit log if enabled
      if (options.auditLog !== false) {
        await this._logAudit(auditLog);
      }

      return {
        allowed,
        reason,
        cost: parseFloat(estimatedCost.toFixed(4)),
        limit: parseFloat(costLimit.toFixed(2)),
        tokenCount,
        provider,
        model,
        timestamp: new Date().toISOString(),
        logId: auditLog.timestamp // Use timestamp as log ID
      };

    } catch (error) {
      if (error instanceof AppError) throw error;

      logger.error('Cost validation error', {
        ...context,
        error: error.message
      });

      throw new AppError(
        'COST_VALIDATION_ERROR',
        'Unable to validate message cost',
        500
      );
    }
  }

  /**
   * Validate batch costs for multiple messages
   * @async
   * @param {string} shopId - Shop ID
   * @param {Array<Object>} messages - Array of { tokenCount, provider, model }
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Batch validation result
   */
  async validateBatchCosts(shopId, messages, options = {}) {
    const context = {
      operation: 'validateBatchCosts',
      shopId,
      messageCount: messages.length,
      timestamp: new Date().toISOString()
    };

    try {
      const costLimit = await this._getShopCostLimit(shopId);
      let totalCost = 0;
      const validations = [];

      for (const msg of messages) {
        const cost = this._calculateTokenCost(
          msg.tokenCount,
          msg.provider,
          msg.model
        );

        totalCost += cost;

        validations.push({
          tokenCount: msg.tokenCount,
          provider: msg.provider,
          model: msg.model,
          cost: parseFloat(cost.toFixed(4)),
          allowed: totalCost <= costLimit
        });
      }

      const allowed = totalCost <= costLimit;

      logger.info('Batch cost validation completed', {
        ...context,
        totalCost,
        costLimit,
        allowed
      });

      return {
        allowed,
        totalCost: parseFloat(totalCost.toFixed(4)),
        limit: parseFloat(costLimit.toFixed(2)),
        messageCount: messages.length,
        validations,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      if (error instanceof AppError) throw error;

      logger.error('Batch cost validation error', {
        ...context,
        error: error.message
      });

      throw new AppError(
        'BATCH_COST_VALIDATION_ERROR',
        'Unable to validate batch costs',
        500
      );
    }
  }

  /**
   * Audit log for cost validations
   * @private
   * @async
   */
  async _logAudit(auditLog) {
    try {
      const client = await this.db.getConnection();

      const query = `
        INSERT INTO cost_validation_logs (
          shop_id,
          token_count,
          estimated_cost,
          cost_limit,
          allowed,
          provider,
          model,
          user_id,
          ip_address,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        RETURNING id
      `;

      const values = [
        auditLog.shopId,
        auditLog.tokenCount,
        auditLog.estimatedCost,
        auditLog.costLimit,
        auditLog.allowed,
        auditLog.provider,
        auditLog.model,
        auditLog.userId || null,
        auditLog.ipAddress || null
      ];

      const result = await client.query(query, values);

      await client.release();

      logger.debug('Audit log created', { logId: result.rows[0].id });

    } catch (error) {
      logger.warn('Failed to create audit log', { error: error.message });
      // Don't throw - logging failure shouldn't block validation
    }
  }

  /**
   * Get cost validation history for a shop
   * @async
   * @param {string} shopId - Shop ID
   * @param {Object} options - Query options (limit, offset, dateRange)
   * @returns {Promise<Array>} Validation logs
   */
  async getValidationHistory(shopId, options = {}) {
    const limit = options.limit || 100;
    const offset = options.offset || 0;

    try {
      const client = await this.db.getConnection();

      let query = `
        SELECT 
          id, shop_id, token_count, estimated_cost, cost_limit,
          allowed, provider, model, user_id, ip_address, created_at
        FROM cost_validation_logs
        WHERE shop_id = $1
      `;

      const params = [shopId];

      if (options.dateFrom) {
        query += ` AND created_at >= $${params.length + 1}`;
        params.push(options.dateFrom);
      }

      if (options.dateTo) {
        query += ` AND created_at <= $${params.length + 1}`;
        params.push(options.dateTo);
      }

      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const result = await client.query(query, params);

      await client.release();

      return result.rows;

    } catch (error) {
      logger.error('Failed to retrieve validation history', {
        shopId,
        error: error.message
      });

      throw new AppError(
        'HISTORY_RETRIEVAL_FAILED',
        'Unable to retrieve validation history',
        500
      );
    }
  }

  /**
   * Clear cache (for testing or maintenance)
   */
  clearCache() {
    this.costCache.clear();
    logger.info('Cost cap service cache cleared');
  }
}

module.exports = CostCapService;
