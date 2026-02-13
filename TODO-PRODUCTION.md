# EasyMod - Pre-Production TODO

## CRITICAL (Deploy Blockers)

### Security
- [ ] Remove `.env` from git history, add to `.gitignore`, use environment variables on server
- [ ] Replace dev JWT secrets (`dev-access-secret`, `dev-refresh-secret`) with strong random secrets
- [ ] Replace dev session secret (`dev-session-secret`) with strong random secret
- [ ] Remove `NODE_TLS_REJECT_UNAUTHORIZED = '0'` from `sync.js` and `server.js`
- [ ] Remove `rejectUnauthorized: false` from `database-setup.js` — use proper SSL certs
- [ ] Add webhook signature verification for AamarPay and SSLCommerz payment callbacks
- [ ] Add authentication/IP whitelisting to payment callback routes (`/payment/aamarpay/success`, `/sslcommerz/ipn`)

### Database
- [ ] Migrate from SQLite to PostgreSQL (SQLite cannot handle concurrent writes)
- [ ] Add database indexes to Order table: `shop_id`, `customer_id`, `order_number`, `created_at`
- [ ] Add missing Product entity columns (14 fields the frontend sends but DB silently drops):
  - `is_active` (BOOLEAN), `track_quantity` (BOOLEAN), `quantity` (INTEGER)
  - `low_stock_threshold` (INTEGER), `allow_discounts` (BOOLEAN), `charge_tax` (BOOLEAN)
  - `send_low_stock_alert` (BOOLEAN), `variants` (JSONB), `brand` (STRING)
  - `weight` (DECIMAL), `weight_unit` (STRING), `compare_at_price` (DECIMAL)
  - `cost_per_item` (DECIMAL), `category_id` (UUID FK — replace `category` STRING)

### Infrastructure
- [ ] Ensure Redis is required at startup (sessions, token blacklist, rate limiting all depend on it)
- [ ] Add `process.on('unhandledRejection')` and `process.on('uncaughtException')` to `server.js`
- [ ] Validate all required environment variables at startup (fail fast if missing)

---

## HIGH (Must Fix Before Launch)

### Security
- [ ] Fix CORS fallback — `{ origin: true }` allows any origin; require explicit allowlist in production
- [ ] Add rate limiting to payment and webhook endpoints
- [ ] Encrypt delivery provider credentials at rest (currently plaintext JSONB in `delivery_integrations`)
- [ ] Stop exposing stack traces to clients in error responses
- [ ] Add request timeout middleware (prevent hanging requests from exhausting server)

### Data Integrity
- [ ] Fix N+1 query in `createOrder` — batch `Product.findOne()` into single `Product.findAll()`
- [ ] Remove duplicate `status`/`order_status` fields on Order entity — keep only `order_status`
- [ ] Remove duplicate `note`/`notes` fields on Order entity — keep only `note`
- [ ] Fix Product `status` vs `is_active` mismatch — frontend sends string status, backend has boolean `in_stock`
- [ ] Fix `customer_phone` not being set in `createOrder` service (field exists but not mapped from `orderData`)

### Process
- [ ] Add graceful shutdown handler (`SIGTERM`/`SIGINT`) — close DB pool, Redis, in-flight requests
- [ ] Configure proper PM2 cluster mode, remove hardcoded IP from `ecosystem.config.js`

---

## MEDIUM (Should Fix)

### Frontend-Backend Alignment
- [ ] Standardize field naming convention — pick either snake_case or camelCase across entire API
- [ ] Fix Product `category` (STRING) vs `category_id` (UUID FK) inconsistency
- [ ] Remove redundant `cover_image`/`image` fields on Category entity
- [ ] Add proper order number generation with unique constraint (current approach has race condition)

### Security Hardening
- [ ] Add HSTS header via Helmet
- [ ] Add Content-Security-Policy header
- [ ] Filter PII/secrets from request logging in `request-context.middleware.js`
- [ ] Add audit logging for security events (failed logins, credential access, payment config changes)
- [ ] Add CSRF protection on payment callback POST routes

### Infrastructure
- [ ] Configure database connection pooling for PostgreSQL
- [ ] Add email sending retry logic and failure logging in `email.service.js`
- [ ] Add health check endpoints for Redis and database connectivity (not just HTTP 200)

---

## LOW (Nice to Have)

- [ ] Add database backup strategy and point-in-time recovery
- [ ] Add API documentation (Swagger/OpenAPI)
- [ ] Add integration tests for payment flows end-to-end
- [ ] Add monitoring/alerting (error rates, response times, queue depths)
- [ ] Implement proper subscription billing enforcement (currently stubs)
- [ ] Implement multi-tenancy data isolation enforcement in tenant routes
- [ ] Add request deduplication for order creation (idempotency beyond current requestId)
- [ ] Set up CI/CD pipeline with automated tests before deploy

---

## Already Fixed (This Session)

- [x] Customer field mapping: `number` -> `phone`, `channel` -> `channel_type`
- [x] Knowledge RAG graceful fallback when Qdrant unavailable
- [x] Knowledge FAQ `category` field made optional
- [x] Order `delivery_address` made optional in validator
- [x] Order entity: added 17 missing columns (order_number, statuses, fees, delivery tracking)
- [x] Order service: fixed Product include attributes (`sku`/`images` -> `image_url`/`price`)
- [x] Order service: fixed transaction rollback crash after commit
- [x] Dashboard metrics: fixed non-existent column references
- [x] Shop-access middleware: added `req.user.shopId` fallback
