/**
 * Delivery Provider Interface
 * 
 * Abstract base class that all courier providers (Pathao, Steadfast, RedX) must extend.
 * Defines contract for provider normalization, status mapping, and validation.
 * 
 * This eliminates ~200 lines of duplicated normalization logic across provider
 * implementations and makes adding new providers much simpler.
 * 
 * @module delivery/providers/delivery-provider.interface
 * @abstract
 * 
 * @example
 * class PathaoProvider extends DeliveryProviderInterface {
 *   getLabel() { return 'Pathao'; }
 *   
 *   normalizePayload(orderData, metadata) {
 *     return { store_id: metadata.store_id, merchant_order_id: orderData.id, ... };
 *   }
 *   
 *   normalizeResponse(response) {
 *     return { consignment_id: response.consignment_id, ... };
 *   }
 *   
 *   getStatusMap() {
 *     return { 'Pending': 'pending', 'Picked_Up': 'picked_up', ... };
 *   }
 *   
 *   getCredentialFields() {
 *     return ['client_id', 'client_secret', 'username', 'password'];
 *   }
 * }
 */

const { createLogger } = require('../../../utils/structured-logger');
const { AppError } = require('../../../utils/AppError');

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const redactProviderSecrets = (message, secrets = []) => {
  let safeMessage = String(message || 'Provider request failed');
  const values = secrets
    .filter((secret) => secret !== undefined && secret !== null && String(secret) !== '')
    .map((secret) => String(secret).replace(/^Bearer\s+/i, '').trim())
    .filter(Boolean);

  for (const secret of values) {
    safeMessage = safeMessage.replace(new RegExp(escapeRegExp(secret), 'g'), '[REDACTED]');
  }

  return safeMessage
    .replace(/\b(API-ACCESS-TOKEN|Authorization)\s*[:=]\s*(?:Bearer\s+)?[^\s,;}]+/gi, '$1: [REDACTED]')
    .replace(/\bBearer\s+[^\s,;}]+/gi, 'Bearer [REDACTED]');
};

class DeliveryProviderInterface {
  /**
   * Initialize delivery provider
   * 
   * @param {string} providerName - Provider name
   * @param {Object} credentials - Courier API credentials
   */
  constructor(providerName, credentials = {}) {
    this.providerName = providerName;
    this.credentials = credentials;
    this.logger = createLogger(`Provider-${providerName}`);
  }

  /**
   * Normalize an upstream provider failure without retaining its response body.
   * Provider responses and request errors may contain credentials in messages or
   * serialized headers, so only a selected message and HTTP status are copied.
   *
   * @param {Object|Error} error - Upstream error
   * @param {string} operation - Human-readable operation name
   * @param {Array<string>} [secrets=[]] - Additional values to redact
   * @returns {Error} Sanitized provider error
   */
  normalizeError(error, operation, secrets = []) {
    const responseData = error?.response?.data;
    const responseMessage = typeof responseData === 'string'
      ? responseData
      : responseData?.message
        || responseData?.error?.message
        || (typeof responseData?.error === 'string' ? responseData.error : null);
    const message = responseMessage || error?.message || 'Provider request failed';
    const credentialSecrets = Object.entries(
      this.credentials && typeof this.credentials === 'object' ? this.credentials : {}
    )
      .filter(([key]) => /(api|token|secret|password|authorization|key)/i.test(key))
      .map(([, value]) => value);
    const safeMessage = redactProviderSecrets(message, [...credentialSecrets, ...secrets]);
    const label = (() => {
      try {
        return this.getLabel();
      } catch (_) {
        return this.providerName;
      }
    })();
    const normalized = new Error(`${label} ${operation} failed: ${safeMessage}`);
    normalized.name = 'DeliveryProviderError';

    const status = Number(error?.response?.status || error?.status || error?.statusCode);
    normalized.status = Number.isInteger(status) && status > 0 ? status : 502;
    normalized.statusCode = normalized.status;
    normalized.code = error?.code || 'DELIVERY_PROVIDER_ERROR';
    return normalized;
  }

  /**
   * Get human-readable provider label
   * 
   * @returns {string} Display name (e.g., 'Pathao', 'Steadfast', 'RedX')
   * @abstract
   */
  getLabel() {
    throw new Error(`${this.constructor.name} must implement getLabel()`);
  }

  /**
   * Convert internal order data to provider API format
   * 
   * Transforms order/consignment data from internal format to the specific
   * API format expected by this courier provider.
   * 
   * @param {Object} orderData - Internal order structure
   * @param {Object} [metadata={}] - Additional provider-specific metadata
   * @returns {Object} Normalized request body for provider API
   * @abstract
   * 
   * @example
   * const payload = provider.normalizePayload({
   *   id: 'ORD-123',
   *   receiver_name: 'John',
   *   receiver_phone: '01712345678'
   * }, { store_id: 'STORE-1' });
   */
  normalizePayload(orderData, metadata = {}) {
    throw new Error(`${this.constructor.name} must implement normalizePayload()`);
  }

  /**
   * Convert provider API response to internal format
   * 
   * Transforms response from provider API back to internal format for
   * consistent handling across all providers.
   * 
   * @param {Object} response - Provider API response
   * @returns {Object} Normalized internal consignment structure
   * @abstract
   * 
   * @example
   * const normalized = provider.normalizeResponse({
   *   consignment_id: 'PTH-ABC123',
   *   status: 'Pending'
   * });
   * // Returns { consignment_id: 'PTH-ABC123', status: 'pending', ... }
   */
  normalizeResponse(response) {
    throw new Error(`${this.constructor.name} must implement normalizeResponse()`);
  }

  /**
   * Get status mapping from provider format to internal format
   * 
   * Returns an object mapping provider-specific status strings to
   * internal status values (e.g., 'Pending' -> 'pending').
   * 
   * @returns {Object<string, string>} Status mapping dictionary
   * @abstract
   * 
   * @example
   * // Pathao format
   * {
   *   'Pending': 'pending',
   *   'Picked_Up': 'picked_up',
   *   'In_Transit': 'in_transit',
   *   'Delivered': 'delivered'
   * }
   */
  getStatusMap() {
    throw new Error(`${this.constructor.name} must implement getStatusMap()`);
  }

  /**
   * Map provider status to internal status
   * 
   * Converts a provider's status string to internal format using the
   * status map. Unknown non-empty values are preserved for reconciliation.
   * 
   * @param {string} providerStatus - Status string from provider API
   * @returns {string} Internal status (lowercase)
   * 
   * @example
   * const internalStatus = provider.mapStatus('In_Transit'); // 'in_transit'
   */
  mapStatus(providerStatus) {
    const statusMap = this.getStatusMap();
    if (providerStatus === undefined || providerStatus === null || providerStatus === '') return 'unknown';
    const raw = String(providerStatus);
    return statusMap[raw] || statusMap[raw.toLowerCase()] || raw;
  }

  /**
   * Get required credential fields
   * 
   * Returns list of credential field names required for this provider.
   * Used for configuration validation.
   * 
   * @returns {Array<string>} Required field names
   * @abstract
   * 
   * @example
   * // bKash requires
   * ['app_key', 'app_secret', 'username', 'password']
   */
  getCredentialFields() {
    throw new Error(`${this.constructor.name} must implement getCredentialFields()`);
  }

  /**
   * Validate provider credentials
   * 
   * Checks if provided credentials contain all required fields.
   * Can be overridden for more complex validation (e.g., API connectivity).
   * 
   * @param {Object} credentials - Credentials object to validate
   * @returns {boolean} True if credentials are complete
   * 
   * @example
   * const isValid = provider.validateCredentials({
   *   app_key: 'xxx',
   *   app_secret: 'yyy',
   *   username: 'zzz'
   * });
   */
  validateCredentials(credentials) {
    const required = this.getCredentialFields();
    return required.every(field => {
      const hasField = credentials && credentials[field];
      if (!hasField) {
        this.logger.warn('Missing required credential', {
          provider: this.providerName,
          field
        });
      }
      return hasField;
    });
  }

  /**
   * Get provider capabilities
   * 
   * Returns information about what this provider supports.
   * Can be overridden to customize per provider.
   * 
   * @returns {Object} Capabilities flags
   */
  getCapabilities() {
    return {
      supports_cod: true,
      supports_partial_delivery: false,
      supports_return: false,
      supports_tracking_url: true,
      max_package_weight_kg: 20,
      max_description_length: 255
    };
  }

  /**
   * Validate order data before sending to provider
   * 
   * Checks if order data meets provider requirements.
   * Override in subclass for provider-specific validation.
   * 
   * @param {Object} orderData - Order data to validate
   * @throws {AppError} If validation fails
   */
  validateOrderData(orderData = {}) {
    const customerName = orderData.customer_name || orderData.receiver_name;
    const customerPhone = orderData.customer_phone || orderData.receiver_phone;
    const deliveryAddress = orderData.delivery_address || orderData.receiver_address;

    if (!customerName) {
      throw new AppError('customer_name is required', 400);
    }
    if (!customerPhone) {
      throw new AppError('customer_phone is required', 400);
    }
    if (!deliveryAddress) {
      throw new AppError('delivery_address is required', 400);
    }
    const weight = orderData.item_weight ?? orderData.weight_kg;
    if (weight && weight > this.getCapabilities().max_package_weight_kg) {
      throw new AppError(
        `Weight exceeds provider limit of ${this.getCapabilities().max_package_weight_kg}kg`,
        400
      );
    }
  }

  /**
   * Get provider-specific configuration
   * 
   * Returns configuration that should be stored/used for this provider.
   * Override in subclass for provider-specific settings.
   * 
   * @returns {Object} Provider configuration
   */
  getConfig() {
    return {
      provider: this.providerName,
      label: this.getLabel(),
      capabilities: this.getCapabilities(),
      credentialFields: this.getCredentialFields()
    };
  }

  /**
   * Log operation with provider context
   * 
   * Helper method for consistent logging across providers.
   * 
   * @param {string} level - Log level (info, error, warn, debug)
   * @param {string} message - Log message
   * @param {Object} meta - Additional metadata
   */
  log(level, message, meta = {}) {
    const logData = {
      provider: this.providerName,
      ...meta
    };
    this.logger[level](message, logData);
  }
}

module.exports = DeliveryProviderInterface;
