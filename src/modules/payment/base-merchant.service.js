/**
 * Base Merchant Service
 * 
 * Abstract base class that all payment gateway merchants must extend.
 * Provides shared functionality including OAuth token caching with TTL management.
 * 
 * This eliminates ~120 lines of duplicated OAuth token caching logic across
 * BkashMerchantService, NagadMerchantService, and RocketMerchantService.
 * 
 * @module payment/base-merchant.service
 * @abstract
 * 
 * @example
 * class BkashMerchantService extends BaseMerchantService {
 *   constructor() {
 *     super('bKash', 'https://checkout.bka.sh');
 *   }
 *   
 *   async getOAuthToken(shopId) {
 *     const cacheKey = `bkash_token_${shopId}`;
 *     return this.getCachedToken(cacheKey, async () => {
 *       // Fetch from bKash API
 *       const response = await axios.post(...);
 *       return response.data.id_token;
 *     });
 *   }
 * }
 */

const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');

class BaseMerchantService {
  /**
   * Initialize base merchant service
   * 
   * @param {string} gatewayName - Human-readable gateway name (e.g., 'bKash', 'Nagad')
   * @param {string} baseUrl - Base URL for API requests
   */
  constructor(gatewayName, baseUrl) {
    this.gatewayName = gatewayName;
    this.baseUrl = baseUrl;
    this.cache = new Map();
    this.logger = createLogger(`Merchant-${gatewayName}`);
    this.TOKEN_CACHE_TTL = 50 * 60 * 1000; // 50 minutes
  }

  /**
   * Get or refresh cached OAuth token
   * 
   * Implements token caching with automatic expiration after TOKEN_CACHE_TTL.
   * If cached token exists and hasn't expired, returns it immediately.
   * Otherwise, calls the fetch function to get a fresh token.
   * 
   * @param {string} cacheKey - Unique cache key (typically `${gateway}_token_${shopId}`)
   * @param {Function} fetchTokenFn - Async function that fetches fresh token from gateway API
   * @returns {Promise<string>} OAuth token for gateway authentication
   * 
   * @throws {AppError} If token fetch fails or gateway is unreachable
   * 
   * @example
   * const token = await this.getCachedToken(`bkash_token_${shopId}`, async () => {
   *   const response = await axios.post(`${this.baseUrl}/v1.2.0/oauth/token`, data);
   *   return response.data.id_token;
   * });
   */
  async getCachedToken(cacheKey, fetchTokenFn) {
    // Check cache for valid token
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug('Token cache hit', {
        cacheKey,
        expiresIn: Math.round((cached.expiresAt - Date.now()) / 1000) + 's'
      });
      return cached.token;
    }

    if (cached) {
      this.logger.debug('Token cache expired, fetching fresh', { cacheKey });
    }

    try {
      this.logger.debug('Fetching fresh OAuth token', { cacheKey });
      const token = await fetchTokenFn();

      if (!token) {
        throw new Error('Token fetch returned empty result');
      }

      // Store in cache with expiration time
      const expiresAt = Date.now() + this.TOKEN_CACHE_TTL;
      this.cache.set(cacheKey, { token, expiresAt });

      this.logger.info('OAuth token cached successfully', {
        cacheKey,
        expiresAt: new Date(expiresAt).toISOString(),
        ttlMinutes: Math.round(this.TOKEN_CACHE_TTL / 60000)
      });

      return token;
    } catch (error) {
      this.logger.error('OAuth token fetch failed', {
        cacheKey,
        gateway: this.gatewayName,
        error: error.message,
        errorCode: error.code
      });

      throw new AppError(
        `Failed to authenticate with ${this.gatewayName}: ${error.message}`,
        500,
        'OAUTH_TOKEN_FETCH_FAILED'
      );
    }
  }

  /**
   * Clear cached token for a specific key
   * 
   * Use when credentials are updated or gateway connection is re-established.
   * 
   * @param {string} cacheKey - Cache key to clear
   */
  clearTokenCache(cacheKey) {
    const existed = this.cache.has(cacheKey);
    this.cache.delete(cacheKey);

    if (existed) {
      this.logger.info('Token cache cleared', { cacheKey, gateway: this.gatewayName });
    }
  }

  /**
   * Clear all cached tokens
   * 
   * Use for complete cache reset or service shutdown.
   */
  clearAllTokens() {
    const cacheSize = this.cache.size;
    this.cache.clear();
    this.logger.info('All cached tokens cleared', {
      gateway: this.gatewayName,
      tokensCleared: cacheSize
    });
  }

  /**
   * Get cache statistics
   * 
   * Returns information about current cache state.
   * 
   * @returns {Object} Cache statistics
   * @returns {number} .size - Number of cached tokens
   * @returns {Array<string>} .keys - Cache keys
   * @returns {Array<Date>} .expirations - Expiration times
   */
  getCacheStats() {
    const entries = Array.from(this.cache.entries());
    return {
      size: this.cache.size,
      keys: entries.map(([key]) => key),
      expirations: entries.map(([, { expiresAt }]) => ({
        expiresAt: new Date(expiresAt),
        ttlSeconds: Math.round((expiresAt - Date.now()) / 1000)
      }))
    };
  }
}

module.exports = BaseMerchantService;
