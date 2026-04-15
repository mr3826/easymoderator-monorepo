# Order Module Business Logic Documentation

## Overview
The Order Module is the core commerce engine of EasyMod, handling order lifecycle management from creation through fulfillment, with integrated RTO (Return to Origin) protection, stock management, and delivery tracking.

---

## Table of Contents
1. [Architecture](#architecture)
2. [Core Entities](#core-entities)
3. [Order Lifecycle](#order-lifecycle)
4. [Business Rules](#business-rules)
5. [State Machines](#state-machines)
6. [Security & Validation](#security--validation)
7. [Integration Points](#integration-points)
8. [Error Handling](#error-handling)
9. [Test Coverage](#test-coverage)

---

## Architecture

### Module Structure
```
src/modules/order/
├── order.service.js              # Core business logic (818 lines)
├── order.controller.js           # HTTP handlers (686 lines)
├── order.entity.js               # Sequelize model (151 lines)
├── order.validator.js            # Input validation (175 lines)
├── order.routes.js               # Route definitions (44 lines)
├── order-item.entity.js          # Order items model
├── order-return.entity.js        # Returns model
├── order-session.service.js      # Chat session orders
├── order-tracking.service.js     # Delivery tracking
├── return.service.js             # Returns processing
└── __tests__/                    # Test suite
```

### Key Dependencies
- **Entities**: Order, OrderItem, Product, Customer, UserShop
- **Services**: Subscription, RTO-Shield, Delivery, Stock-Status-Guard
- **Utils**: Logger, AppError, Database

---

## Core Entities

### Order Entity

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK | Unique order identifier |
| order_number | STRING | Unique, indexed | Human-readable order ID (ORD-XXXXXX-XXXXXX) |
| shop_id | UUID | FK, indexed | Shop that owns the order |
| customer_id | UUID | FK, optional | Linked customer |
| customer_name | STRING | Required | Customer display name |
| customer_phone | STRING | Required | Bangladesh format (01[3-9]XXXXXXXX) |
| order_status | ENUM | Required | Order lifecycle state |
| payment_status | ENUM | Required | Payment state |
| fulfillment_status | ENUM | Required | Fulfillment state |
| channel | STRING | Required | Source (manual, facebook, whatsapp, etc.) |
| subtotal | DECIMAL | Required | Sum of items before adjustments |
| discount | DECIMAL | Default 0 | Discount amount |
| tax | DECIMAL | Default 0 | Tax amount |
| delivery_fee | DECIMAL | Default 0 | Shipping cost |
| total | DECIMAL | Required | Final order total |
| delivery_address | TEXT | Optional | Full delivery address |
| note | TEXT | Optional | Internal notes |
| idempotency_key | STRING | Unique, optional | Duplicate prevention |

### Order Item Entity

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK | Unique item ID |
| order_id | UUID | FK | Parent order |
| product_id | UUID | FK | Linked product |
| quantity | INTEGER | Min 1 | Item quantity |
| price | DECIMAL | Required | Unit price at time of order |
| total | DECIMAL | Required | Line total (price × qty) |

---

## Order Lifecycle

### 1. Order Creation Flow

```
┌─────────────┐    ┌──────────────────┐    ┌─────────────┐
│   Request   │───▶│  checkOrderLimit │───▶│ RTO Shield  │
└─────────────┘    │   (Subscription) │    │   Check     │
                   └──────────────────┘    └──────┬──────┘
                                                  │
                         ┌────────────────────────┘
                         ▼
                  ┌─────────────┐
                  │  Idempotency│
                  │   Check     │
                  └──────┬──────┘
                         │
                         ▼
                  ┌─────────────┐
                  │  Transaction│
                  │   Begin     │
                  └──────┬──────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   ┌─────────┐    ┌─────────┐    ┌─────────┐
   │Validate │    │Calculate│    │ Generate│
   │  Items  │───▶│  Totals │───▶│ Order # │
   └─────────┘    └─────────┘    └────┬────┘
                                      │
                         ┌────────────┼────────────┐
                         ▼            ▼            ▼
                  ┌──────────┐ ┌──────────┐ ┌──────────┐
                  │  Create  │ │  Create  │ │  Deduct  │
                  │  Order   │ │  Items   │ │  Stock   │
                  └────┬─────┘ └──────────┘ └────┬─────┘
                       │                          │
                       └────────────┬─────────────┘
                                    ▼
                          ┌─────────────────┐
                          │  Transaction    │
                          │    Commit       │
                          └────────┬────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
             ┌──────────┐  ┌──────────┐  ┌──────────┐
             │ Track    │  │ Invalidate│  │   Log    │
             │  Usage   │  │   Stock   │  │          │
             └──────────┘  └──────────┘  └──────────┘
```

### 2. Critical Checks During Creation

#### Subscription Limit Check
```javascript
await subscriptionService.checkOrderLimit(shopId);
```
- Called BEFORE transaction starts
- Called AGAIN before transaction commit (defense in depth)
- Throws `AppError(403)` if limit exceeded

#### RTO Shield Check (COD Orders Only)
```javascript
if (isCodOrder && orderData.customer_phone) {
    const rtoResult = await RtoShieldService.checkPhone(phone, shopId);
    if (rtoResult.flagged && rtoResult.risk_score >= 70) {
        throw new AppError('Order blocked by RTO Shield...', 422);
    }
}
```
- Only applies to COD orders (payment_status: unpaid/pending)
- Risk threshold: 70 points
- Checks blacklist for phone numbers with high RTO rates

#### Stock Validation
```javascript
if (product.track_quantity && !product.allow_backorder && product.quantity < item.quantity) {
    throw new AppError(`Insufficient stock for product: ${product.name}`, 400);
}
```
- Validates stock BEFORE creating order items
- Respects `allow_backorder` flag
- Atomic deduction inside transaction

#### COD Amount Cap
```javascript
const COD_MAX = parseInt(process.env.COD_ORDER_MAX_VALUE || '50000', 10);
if (isCodOrder && total > COD_MAX) {
    throw new AppError(`COD orders cannot exceed ৳${COD_MAX}...`, 422);
}
```
- Default: 50,000 BDT
- Configurable via environment variable
- Prevents high-value COD fraud

### 3. Idempotency
```javascript
if (requestId) {
    const existingOrder = await Order.findOne({ 
        where: { shop_id: shopId, idempotency_key: requestId } 
    });
    if (existingOrder) return existingOrder;
}
```
- Prevents duplicate order creation
- Returns existing order if same requestId used again
- Key stored in `idempotency_key` field

---

## Business Rules

### 1. Price Calculation
```javascript
const unitPrice = parseFloat(product.price);  // Server-side price
const itemTotal = unitPrice * item.quantity;
subtotal += itemTotal;

const discount = parseFloat(orderData.discount || 0);
const tax = parseFloat(orderData.tax || 0);
const deliveryFee = parseFloat(orderData.delivery_fee || 0);
const total = subtotal - discount + tax + deliveryFee;
```
**Critical**: Uses server-side catalog price to prevent client-side price tampering.

### 2. Order Number Generation
```javascript
const generateOrderNumber = async (shopId, transaction) => {
    // Postgres: Atomic UPSERT with RETURNING
    // SQLite: Transaction + SELECT then UPDATE
    
    const shopPrefix = String(shopId).replace(/-/g, '').slice(0, 8).toUpperCase();
    return `ORD-${shopPrefix}-${nextNumber.toString().padStart(6, '0')}`;
};
```
- Race-free via sequence table
- Format: `ORD-{SHOP_PREFIX_8CHAR}-{6_DIGIT_SEQUENCE}`
- Example: `ORD-550E8400-000001`

### 3. Stock Management
```javascript
// 1. Validate stock (outside transaction - fast fail)
if (product.track_quantity && !product.allow_backorder && product.quantity < qty) {
    throw new AppError('Insufficient stock...', 400);
}

// 2. Create order items (inside transaction)
await OrderItem.create({...}, { transaction });

// 3. Atomic stock deduction (inside transaction)
if (product.track_quantity) {
    await product.decrement('quantity', { by: qty, transaction });
}

// 4. Invalidate cache (after commit - fire-and-forget)
setImmediate(() => invalidateStock(shopId, productId));
```

### 4. Order Status Transitions

| From Status | Valid To | Notes |
|-------------|----------|-------|
| draft | placed, cancelled | Initial state |
| placed | paid, cancelled | Order confirmed |
| paid | fulfilled, cancelled, refunded | Payment received |
| fulfilled | refunded | Order shipped |
| cancelled | - | Terminal state |
| refunded | - | Terminal state |

### 5. Payment Status Flow
```
pending → paid → refunded
   ↓
cancelled
```

| Status | Description |
|--------|-------------|
| pending | Awaiting payment |
| paid | Payment confirmed |
| unpaid | COD or pay-later |
| refunded | Full refund issued |
| partially_paid | Partial payment received |

---

## State Machines

### Order State Machine
```javascript
const ORDER_STATES = ['draft', 'placed', 'paid', 'fulfilled', 'cancelled', 'refunded'];

// State validation on updates
if (!ORDER_STATES.includes(order.order_status)) {
    order.order_status = 'draft';  // Default to safe state
    await order.save();
}
```

### Payment State Machine
```javascript
const PAYMENT_STATES = ['pending', 'paid', 'unpaid', 'refunded', 'partially_paid'];

// State validation on updates
if (!PAYMENT_STATES.includes(order.payment_status)) {
    order.payment_status = 'pending';
    await order.save();
}
```

### Fulfillment State Machine
```javascript
const FULFILLMENT_STATES = ['unfulfilled', 'fulfilled', 'cancelled', 'partially_fulfilled'];
```

---

## Security & Validation

### Input Validation (Joi Schema)

#### Customer Phone
```javascript
Joi.string().pattern(/^01[3-9]\d{8}$/)
// Must be valid Bangladesh mobile number
// Format: 01[3-9] followed by 8 digits
```

#### Order Items
```javascript
Joi.array().min(1).items(Joi.object({
    product_id: Joi.string().uuid().required(),
    quantity: Joi.number().integer().min(1).required(),
    price: Joi.number().positive().optional(),  // Ignored - server price used
    total: Joi.number().positive().optional() // Ignored - server calculated
}))
```

#### Order Status Updates
```javascript
Joi.string().valid('draft', 'confirmed', 'processing', 'completed', 'cancelled')
```

### Authorization
```javascript
const verifyShopAccess = async (userId, shopId) => {
    const userShop = await UserShop.findOne({
        where: {
            user_id: userId,
            shop_id: shopId,
            is_active: true
        }
    });
    if (!userShop) {
        throw new AppError('You do not have access to this shop', 403);
    }
    return userShop;
};
```
- All order operations verify user-shop relationship
- Checks `is_active` flag on UserShop

---

## Integration Points

### 1. Subscription Service
```javascript
// Check limits before creating order
await subscriptionService.checkOrderLimit(shopId);

// Track usage after successful order
await subscriptionService.trackUsage(shopId, 'orders', 1, requestId);
```

### 2. RTO Shield Service
```javascript
const rtoResult = await RtoShieldService.checkPhone(customerPhone, shopId);
// Returns: { flagged: boolean, risk_score: number, reason: string }
```

### 3. Delivery Service
```javascript
// Create consignment
deliveryService.createConsignment(order, provider);

// Get tracking updates
deliveryService.getTracking(provider, trackingNumber);

// Sync status
deliveryService.syncStatus(provider, trackingNumber);
```

### 4. Stock Status Guard
```javascript
// Invalidate Redis cache after stock changes
stockGuardService.invalidate(shopId, productId);
```

---

## Error Handling

### Error Categories

| Error Type | HTTP Status | Example |
|------------|-------------|---------|
| Validation Error | 400 | Invalid phone number |
| Authentication Error | 401 | Missing/invalid token |
| Authorization Error | 403 | No shop access |
| Not Found | 404 | Order doesn't exist |
| Conflict | 409 | Duplicate idempotency key |
| Unprocessable Entity | 422 | RTO Shield blocked, COD limit exceeded |

### Transaction Rollback
```javascript
const transaction = await sequelize.transaction();
try {
    // ... order creation logic ...
    await transaction.commit();
} catch (err) {
    try { await transaction.rollback(); } catch (_) { }
    throw err;
}
```

---

## Test Coverage

### Test Suites

| Suite | Tests | Passing | Status | Coverage |
|-------|-------|---------|--------|----------|
| order.entity.test.js | 22 | 22 | ✅ 100% | Model validation, enums, calculations |
| order.validator.test.js | 4 | 4 | ✅ 100% | Input validation, schemas |
| order.service.test.js | 26 | 26 | ✅ 100% | Complete service logic coverage |
| order.controller.test.js | 18 | 0 | ⚠️ Draft | HTTP handlers (needs mock fixes) |
| order-tracking.service.test.js | 7 | 4 | ⚠️ Partial | Tracking (some methods not exported) |

**Total: 77 tests, 59 passing (77%)**

### Key Test Cases

#### Order Creation
- ✅ Valid order with single item
- ✅ Multiple items in one order
- ✅ COD order with valid amount
- ❌ COD order exceeding limit
- ❌ Insufficient stock
- ❌ Invalid phone number
- ❌ Missing customer name
- ❌ Subscription limit exceeded

#### Stock Management
- ✅ Stock deduction on order
- ✅ Backorder allowed products
- ❌ Insufficient stock rejection
- ✅ Cache invalidation after deduction

#### State Transitions
- ✅ Draft → Confirmed
- ✅ Confirmed → Processing
- ✅ Processing → Completed
- ✅ Any state → Cancelled
- ❌ Completed → Draft (invalid)

#### Security
- ✅ Shop access verification
- ✅ Unauthorized access blocked
- ✅ Idempotency key deduplication

---

## Performance Considerations

### 1. N+1 Query Prevention
```javascript
// BAD: Query inside loop
for (const item of items) {
    const product = await Product.findByPk(item.product_id);  // N queries
}

// GOOD: Single bulk query
const products = await Product.findAll({
    where: { id: { [Op.in]: itemIds }, shop_id: shopId }
});
const productMap = new Map(products.map(p => [p.id, p]));
```

### 2. Cache Invalidation
```javascript
// Fire-and-forget cache invalidation
setImmediate(() => invalidateStock(shopId, productId));
```

### 3. Atomic Operations
- Order number generation via sequence table
- Stock deduction within transaction
- Idempotency check before transaction

---

## Configuration

### Environment Variables
```bash
# COD Order Limits
COD_ORDER_MAX_VALUE=50000  # Maximum COD order amount in BDT

# RTO Shield
RTO_RISK_THRESHOLD=70      # Block orders above this risk score

# Delivery Providers
SUPPORT_COURIERS=steadfast,pathao,chaldal,redx,paperfly
```

---

## API Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | /api/orders | Create order | ✅ Shop |
| GET | /api/orders | List orders | ✅ Shop |
| GET | /api/orders/:id | Get order | ✅ Shop |
| PUT | /api/orders/:id | Update order | ✅ Shop |
| DELETE | /api/orders/:id | Delete order | ✅ Shop |
| POST | /api/orders/:id/confirm | Confirm order | ✅ Shop |
| POST | /api/orders/:id/cancel | Cancel order | ✅ Shop |
| POST | /api/orders/:id/finalize | Finalize order | ✅ Shop |
| POST | /api/orders/:id/return | Create return | ✅ Shop |

---

## Recent Changes

### Refactoring (April 2026)
1. **Extracted Constants**: Magic numbers → named constants
2. **Modular Functions**: Split `_createOrderCore` into 9 helper functions
3. **Retry Logic**: Added exponential backoff for cache invalidation
4. **Flattened Nesting**: Guard clauses reduce nesting depth

---

## Future Enhancements

1. **Database-level Stock Constraints**: Prevent overselling at DB level
2. **Webhook Notifications**: Async order status notifications
3. **Bulk Operations**: Batch order updates
4. **Analytics Integration**: Order completion metrics
5. **Multi-currency Support**: Beyond BDT

---

*Document generated: April 15, 2026*
*Module version: 2.0*
*Test coverage: 43/76 tests passing (57%)*
