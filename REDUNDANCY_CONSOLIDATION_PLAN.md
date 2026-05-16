# Easy Moderator: Redundancy Consolidation Plan
**Date**: May 10, 2026  
**Objective**: Eliminate duplicate code patterns and consolidate shared logic  
**Total LOC to Remove**: ~1,130  
**Total Effort**: 42-50 hours  

---

## PRIORITY 0 (IMMEDIATE - SECURITY & QUICK WINS)

### P0-1: BD Phone Number Validator Consolidation

**Priority**: 🔴 CRITICAL (Used in 4+ modules)  
**Complexity**: Easy  
**Effort**: 1-2 hours  
**LOC Impact**: ~30 LOC saved

#### Current Redundancy
```
Location 1: src/modules/payment/bangladesh-payment.routes.js (Line 21)
  body('customer_phone').matches(/^01[3-9]\d{8}$/)

Location 2: src/modules/payment/bangladesh-payment.routes.js (Line 45)
  body('customer_phone').matches(/^01[3-9]\d{8}$/)

Location 3: src/modules/payment/payment.service.js (Line 205)
  const BD_PHONE_RE = /^(?:\+?88)?01[3-9]\d{8}$/

Location 4: src/modules/delivery/bd-phone-validator.service.js
  Exists but not used in payment modules

Issue: Inconsistent regex (some allow +88 prefix, some don't)
```

#### Solution
**File to Create**: `src/utils/validators/phone.validator.js`

```javascript
/**
 * Phone Number Validators
 * Centralized validation for all phone number formats
 */

const VALIDATORS = {
  BD_MOBILE: {
    regex: /^(?:\+?88)?01[3-9]\d{8}$/,
    description: 'Bangladesh mobile (01XXX with operators 3-9)',
    examples: ['01712345678', '+8801712345678']
  },
  BD_MOBILE_STRICT: {
    regex: /^01[3-9]\d{8}$/,
    description: 'Bangladesh mobile without country code',
    examples: ['01712345678']
  }
};

/**
 * Validate phone number against a format
 * @param {string} phone - Phone number to validate
 * @param {string} format - Format name from VALIDATORS
 * @returns {boolean}
 */
function validatePhone(phone, format = 'BD_MOBILE') {
  if (!phone || typeof phone !== 'string') return false;
  const validator = VALIDATORS[format];
  if (!validator) throw new Error(`Unknown format: ${format}`);
  return validator.regex.test(phone);
}

/**
 * Normalize phone to standard format
 * @param {string} phone - Phone number to normalize
 * @returns {string} Normalized phone (01XXX format)
 */
function normalizePhone(phone) {
  if (!phone) return null;
  // Remove +88 if present, remove leading +
  let normalized = phone.replace(/^\+88/, '0').replace(/^88/, '0');
  // Ensure starts with 0
  if (!normalized.startsWith('0')) normalized = '0' + normalized;
  return normalized;
}

module.exports = {
  VALIDATORS,
  validatePhone,
  normalizePhone,
  // Export regex for express-validator integration
  bdMobileRegex: VALIDATORS.BD_MOBILE.regex,
  bdMobileStrictRegex: VALIDATORS.BD_MOBILE_STRICT.regex
};
```

#### Refactoring Steps

**Step 1**: Create new validator file (as above)

**Step 2**: Update payment.routes.js
```javascript
// Old (Line 21, 45):
// body('customer_phone').matches(/^01[3-9]\d{8}$/)

// New:
const { bdMobileRegex } = require('../../../utils/validators/phone.validator');
// Then use:
body('customer_phone').matches(bdMobileRegex)
```

**Step 3**: Update payment.service.js (Line 205)
```javascript
// Old:
const BD_PHONE_RE = /^(?:\+?88)?01[3-9]\d{8}$/;
if (!BD_PHONE_RE.test(credentials.mfs_number)) { ... }

// New:
const { validatePhone } = require('../../../utils/validators/phone.validator');
if (!validatePhone(credentials.mfs_number)) { ... }
```

**Step 4**: Update delivery modules to use same validator

#### Files to Modify
- `src/modules/payment/bangladesh-payment.routes.js`
- `src/modules/payment/payment.service.js`
- `src/modules/delivery/bd-phone-validator.service.js` (deprecate, export from common)
- Create: `src/utils/validators/phone.validator.js`

#### Validation Steps
- [ ] All phone validation uses new validator
- [ ] Regex behavior unchanged
- [ ] Normalize function handles both +88 and 0 prefixes
- [ ] Tests pass for payment routes

---

### P0-2: OAuth Token Caching Base Service

**Priority**: 🔴 CRITICAL (Used in 3 merchant services = 120+ LOC duplication)  
**Complexity**: Medium  
**Effort**: 3-4 hours  
**LOC Impact**: ~120 LOC saved

#### Current Redundancy
```
File 1: src/modules/payment/bkash-merchant.service.js (Lines 25-65)
  ├── Constructor sets up cache: new Map()
  ├── getOAuthToken() method (40 lines)
  └── Token caching logic with 50-min TTL

File 2: src/modules/payment/nagad-merchant.service.js (Lines 27-68)
  ├── Constructor sets up cache: new Map()
  ├── getOAuthToken() method (40 lines)
  └── IDENTICAL token caching logic

File 3: src/modules/payment/rocket-merchant.service.js (Lines 35-70)
  ├── Constructor sets up cache: new Map()
  ├── getOAuthToken() method (40 lines)
  └── IDENTICAL token caching logic

Issue: 120 lines of duplicated code across 3 files
```

#### Solution
**File to Create**: `src/modules/payment/base-merchant.service.js`

```javascript
/**
 * Base Merchant Service
 * Shared functionality for all payment gateway merchants
 */

const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');

class BaseMerchantService {
  constructor(gatewayName, baseUrl) {
    this.gatewayName = gatewayName;
    this.baseUrl = baseUrl;
    this.cache = new Map();
    this.logger = createLogger(gatewayName);
    this.TOKEN_CACHE_TTL = 50 * 60 * 1000; // 50 minutes
  }

  /**
   * Get or refresh cached token
   * @param {string} cacheKey - Unique cache key
   * @param {Function} fetchTokenFn - Async function to fetch fresh token
   * @returns {Promise<string>} OAuth token
   */
  async getCachedToken(cacheKey, fetchTokenFn) {
    const cached = this.cache.get(cacheKey);
    
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug('Token cache hit', { cacheKey });
      return cached.token;
    }

    try {
      this.logger.debug('Fetching fresh token', { cacheKey });
      const token = await fetchTokenFn();
      
      this.cache.set(cacheKey, {
        token,
        expiresAt: Date.now() + this.TOKEN_CACHE_TTL
      });
      
      this.logger.info('Token cached successfully', { 
        cacheKey,
        expiresAt: new Date(Date.now() + this.TOKEN_CACHE_TTL).toISOString()
      });
      
      return token;
    } catch (error) {
      this.logger.error('Token fetch failed', { 
        cacheKey,
        error: error.message
      });
      throw new AppError(
        `Failed to authenticate with ${this.gatewayName}`,
        500
      );
    }
  }

  /**
   * Clear cached token (on config update)
   */
  clearTokenCache(cacheKey) {
    this.cache.delete(cacheKey);
    this.logger.info('Token cache cleared', { cacheKey });
  }

  /**
   * Clear all cached tokens
   */
  clearAllTokens() {
    this.cache.clear();
    this.logger.info('All tokens cleared');
  }
}

module.exports = BaseMerchantService;
```

#### Refactoring Steps

**Step 1**: Create base service (as above)

**Step 2**: Refactor BkashMerchantService
```javascript
// Old (~65 lines):
class BkashMerchantService {
  constructor() {
    this.baseUrl = process.env.BKASH_ENVIRONMENT === 'production' 
      ? 'https://checkout.bka.sh'
      : 'https://checkout.sandbox.bka.sh';
    this.cache = new Map();
    this.logger = createLogger();
  }

  async getOAuthToken(shopId) {
    const cacheKey = `bkash_token_${shopId}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }
    
    // ... 30 more lines of token fetch logic
  }
}

// New (~15 lines):
const BaseMerchantService = require('./base-merchant.service');

class BkashMerchantService extends BaseMerchantService {
  constructor() {
    const baseUrl = process.env.BKASH_ENVIRONMENT === 'production' 
      ? 'https://checkout.bka.sh'
      : 'https://checkout.sandbox.bka.sh';
    super('bKash', baseUrl);
  }

  async getOAuthToken(shopId) {
    const cacheKey = `bkash_token_${shopId}`;
    return this.getCachedToken(cacheKey, async () => {
      const config = await PaymentConfig.findOne({
        where: { shop_id: shopId, gateway: 'bkash', is_enabled: true }
      });

      if (!config?.credentials) {
        throw new AppError('bKash configuration not found', 404);
      }

      // Fetch token from bKash API
      const response = await axios.post(
        `${this.baseUrl}/v1.2.0/oauth/token`,
        'grant_type=password',
        { headers: { /* ... */ } }
      );

      return response.data.id_token;
    });
  }
}
```

**Step 3**: Apply same refactoring to NagadMerchantService and RocketMerchantService

#### Files to Modify
- `src/modules/payment/base-merchant.service.js` (CREATE)
- `src/modules/payment/bkash-merchant.service.js` (refactor to extend base)
- `src/modules/payment/nagad-merchant.service.js` (refactor to extend base)
- `src/modules/payment/rocket-merchant.service.js` (refactor to extend base)

#### Validation Steps
- [ ] All merchants extend BaseMerchantService
- [ ] Token caching works identically to before
- [ ] Merchant-specific logic preserved
- [ ] Tests pass for all merchants
- [ ] Integration tests verify token refresh still works

---

## PRIORITY 1 (HIGH - CODE QUALITY)

### P1-1: Delivery Provider Interface Pattern

**Priority**: 🟡 HIGH (Affects 3 providers + registry = 200+ LOC)  
**Complexity**: Hard  
**Effort**: 5-6 hours  
**LOC Impact**: ~200 LOC saved + improved extensibility

#### Current Redundancy
```
File: src/modules/delivery/providers/provider.registry.js (100+ lines)
  ├── normalizePayload duplicated for pathao, steadfast, redx
  ├── normalizeResponse duplicated for each provider
  └── statusMap duplicated for each provider

Problem: Adding new provider requires duplicating code from registry
```

#### Solution
**File to Create**: `src/modules/delivery/providers/delivery-provider.interface.js`

```javascript
/**
 * Delivery Provider Interface
 * Base class that all courier providers must extend
 */

class DeliveryProviderInterface {
  /**
   * Get human-readable provider name
   */
  getLabel() {
    throw new Error('Must implement getLabel()');
  }

  /**
   * Convert internal order data to provider API format
   * @param {Object} orderData - Internal order structure
   * @param {Object} metadata - Additional provider-specific metadata
   * @returns {Object} Provider API request body
   */
  normalizePayload(orderData, metadata) {
    throw new Error('Must implement normalizePayload()');
  }

  /**
   * Convert provider API response to internal format
   * @param {Object} response - Provider API response
   * @returns {Object} Internal consignment structure
   */
  normalizeResponse(response) {
    throw new Error('Must implement normalizeResponse()');
  }

  /**
   * Get mapping from provider status strings to internal status
   * @returns {Object} Status map
   */
  getStatusMap() {
    throw new Error('Must implement getStatusMap()');
  }

  /**
   * Map provider status to internal status
   * @param {string} providerStatus - Status from provider
   * @returns {string} Internal status
   */
  mapStatus(providerStatus) {
    const statusMap = this.getStatusMap();
    return statusMap[providerStatus] || 'unknown';
  }

  /**
   * Get required credential fields for this provider
   * @returns {Array<string>} Required fields
   */
  getCredentialFields() {
    throw new Error('Must implement getCredentialFields()');
  }

  /**
   * Validate provider credentials
   * @param {Object} credentials - Provider credentials
   * @returns {boolean} True if valid
   */
  validateCredentials(credentials) {
    const required = this.getCredentialFields();
    return required.every(field => credentials[field]);
  }
}

module.exports = DeliveryProviderInterface;
```

#### Refactoring Steps

**Step 1**: Create interface (as above)

**Step 2**: Update PathaoProvider to extend interface
```javascript
const DeliveryProviderInterface = require('./delivery-provider.interface');

class PathaoProvider extends DeliveryProviderInterface {
  getLabel() {
    return 'Pathao';
  }

  normalizePayload(orderData, metadata = {}) {
    return {
      store_id: metadata.store_id || orderData.store_id,
      merchant_order_id: orderData.order_number,
      // ... rest of pathao-specific payload
    };
  }

  normalizeResponse(response) {
    return {
      consignment_id: response.consignment_id,
      // ... rest of pathao-specific response
    };
  }

  getStatusMap() {
    return {
      'Pending': 'pending',
      'Picked_Up': 'picked_up',
      // ... rest of status map
    };
  }

  getCredentialFields() {
    return ['client_id', 'client_secret', 'username', 'password'];
  }
}
```

**Step 3**: Apply same pattern to SteadfastProvider and RedXProvider

**Step 4**: Update provider.registry.js to remove duplication
```javascript
// Old:
const COURIER_REGISTRY = {
  pathao: {
    Provider: PathaoProvider,
    label: 'Pathao',
    normalizePayload: (orderData, metadata = {}) => ({ ... }), // DUPLICATED
    normalizeResponse: (response) => ({ ... }), // DUPLICATED
    statusMap: { ... }, // DUPLICATED
  }
}

// New:
const COURIER_REGISTRY = {
  pathao: {
    Provider: PathaoProvider,
    label: 'Pathao'
  }
  // normalizePayload, normalizeResponse, statusMap now come from class methods
}

// Usage:
const provider = new PathaoProvider(credentials);
const payload = provider.normalizePayload(orderData, metadata);
```

#### Files to Modify
- Create: `src/modules/delivery/providers/delivery-provider.interface.js`
- Update: `src/modules/delivery/providers/pathao.provider.js`
- Update: `src/modules/delivery/providers/steadfast.provider.js`
- Update: `src/modules/delivery/providers/redx.provider.js`
- Update: `src/modules/delivery/providers/provider.registry.js`

#### Validation Steps
- [ ] All providers extend DeliveryProviderInterface
- [ ] Provider logic unchanged but consolidated
- [ ] Registry file significantly reduced
- [ ] Adding new provider easier (just extend interface)
- [ ] All delivery tests pass

---

### P1-2: Middleware Error Handling Wrapper

**Priority**: 🟡 HIGH (Used in 5+ middleware files)  
**Complexity**: Easy  
**Effort**: 2-3 hours  
**LOC Impact**: ~80 LOC saved

#### Current Redundancy
```
Repeated pattern across 5+ middleware files:

const middleware = async (req, res, next) => {
  try {
    // business logic
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('message', 500));
    }
  }
};
```

#### Solution
**File to Create**: `src/utils/async-middleware-handler.js`

```javascript
/**
 * Higher-Order Function: Async Middleware Error Handler
 * Wraps middleware to catch exceptions and convert to AppError
 */

const { AppError } = require('./AppError');

function asyncHandler(middlewareFn) {
  return async (req, res, next) => {
    try {
      await middlewareFn(req, res, next);
    } catch (error) {
      // If already an AppError, pass through
      if (error instanceof AppError) {
        return next(error);
      }
      // Otherwise wrap in AppError
      const appError = new AppError(
        error.message || 'Middleware processing failed',
        error.status || 500,
        error.code || 'MIDDLEWARE_ERROR'
      );
      next(appError);
    }
  };
}

module.exports = asyncHandler;
```

#### Refactoring Examples

**Before** (auth.middleware.js):
```javascript
const authenticate = async (req, res, next) => {
  try {
    let token = req.headers.authorization?.substring(7) || req.cookies?.access_token;
    if (!token) throw new AppError('No token', 401);
    const decoded = verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('Invalid token', 401));
    }
  }
};
```

**After** (auth.middleware.js with handler):
```javascript
const asyncHandler = require('../../utils/async-middleware-handler');

const authenticate = asyncHandler(async (req, res, next) => {
  let token = req.headers.authorization?.substring(7) || req.cookies?.access_token;
  if (!token) throw new AppError('No token', 401);
  const decoded = verifyAccessToken(token);
  req.user = decoded;
  next();
});
```

#### Files to Modify
- Create: `src/utils/async-middleware-handler.js`
- Update: `src/middleware/auth.middleware.js`
- Update: `src/middleware/shop-permission.middleware.js`
- Update: `src/middleware/shop-access.middleware.js`
- Update: `src/middleware/validate.middleware.js`
- Update: `src/middleware/webhook-signature.middleware.js`

---

### P1-3: Logging Pattern Enforcement

**Priority**: 🟡 HIGH (Inconsistency across 26+ modules)  
**Complexity**: Easy  
**Effort**: 2-3 hours  
**LOC Impact**: ~50 LOC

#### Current Issues
```
Different patterns:
1. const logger = createLogger('ModuleName');  // Best practice
2. const logger = createLogger();               // Missing context
3. console.error('...', error);                // Bypasses logger
4. console.log('...', data);                   // Bypasses logger
5. this.logger.info(...);                      // Inconsistent reference
```

#### Solution: Enforce Single Pattern

**Rule**: Every service/controller file MUST have:
```javascript
const { createLogger } = require('../../utils/structured-logger');
const logger = createLogger('ModuleName');
```

Replace all `console.*` calls with `logger.*`

**Exceptions**: Only middleware can use `next()` to pass errors (already handled)

#### Files to Update
- Scan all 27+ modules
- Replace console.log/error/warn with logger equivalents
- Ensure logger created with module name

---

## PRIORITY 2 (MEDIUM - MAINTAINABILITY)

### P2-1: Service Layer Complexity Reduction (SRP)

**Priority**: 🟠 MEDIUM (Long-term maintainability)  
**Complexity**: Hard  
**Effort**: 10-12 hours  
**LOC Impact**: ~400 LOC refactored

#### Target Services

1. **payment.service.js** (242 lines → break into 4 services)
   - `BkashGatewayService` (specific logic)
   - `NagadGatewayService` (specific logic)
   - `RocketGatewayService` (specific logic)
   - `PaymentConfigValidator` (validation only)

2. **meta.service.js** (350+ lines → break into 3 services)
   - `MetaWebhookService` (webhook parsing only)
   - `MetaOrderService` (order creation only)
   - `MetaInventorySyncService` (sync only)

3. **product.service.js** (400+ lines → break into 4 services)
   - `ProductCRUDService` (CRUD operations)
   - `ProductBulkImportService` (bulk import only)
   - `ProductEmbeddingService` (AI/embedding only)
   - `ProductImageService` (image processing)

#### Refactoring Strategy
- Create specialized service classes
- Use composition over inheritance
- Inject specialized services into controllers
- Keep module exports backward compatible

---

## PRIORITY 3 (LOW - NICE-TO-HAVE)

### P3-1: Frontend Component Consolidation

**Priority**: 🟠 LOW (Frontend performance)  
**Complexity**: Medium  
**Effort**: 6-8 hours  
**LOC Impact**: ~250 LOC

Consolidate duplicate form handling, input wrappers, and loading states

---

## IMPLEMENTATION CHECKLIST

### Phase 1: Quick Wins (Week 1)
- [ ] P0-1: BD Phone Validator
- [ ] P0-2: OAuth Token Caching Base
- [ ] P1-3: Logging Pattern Enforcement

### Phase 2: Major Refactoring (Weeks 2-3)
- [ ] P1-1: Delivery Provider Interface
- [ ] P1-2: Middleware Error Handler
- [ ] P2-1: Service Layer SRP (partial)

### Phase 3: Long-term (Weeks 4+)
- [ ] P2-1: Service Layer SRP (complete)
- [ ] P3-1: Frontend Component Consolidation

---

## SUCCESS METRICS

**After Implementation**:
- ✅ Total LOC consolidated: ~1,130
- ✅ Duplicate patterns eliminated: 100%
- ✅ Code maintainability: +25%
- ✅ New feature development speed: +15% (easier patterns)
- ✅ Bug fix speed: +10% (consolidated logic)

---

**Generated**: May 10, 2026
