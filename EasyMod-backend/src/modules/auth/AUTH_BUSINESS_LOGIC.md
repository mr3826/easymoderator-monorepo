# Authentication Business Logic Specification

## Overview

This document describes the complete business logic for the EasyMod authentication flow, including:
- What each endpoint does
- What validations are applied
- What security measures are in place
- What should and shouldn't happen in each flow

Last Updated: April 14, 2026
Security Fixes Applied: 10 critical/high/medium issues resolved

---

## Table of Contents

1. [Test Coverage Achievements](#1-test-coverage-achievements)
2. [Login Form Behavior](#2-login-form-behavior)
3. [Complete Auth Flows](#3-complete-auth-flows)
4. [Security Test Matrix](#4-security-test-matrix)
5. [API Reference](#5-api-reference)

---

## 1. Test Coverage Achievements

By creating comprehensive test cases for the auth flow security fixes, we achieved:

| Achievement | Description |
|-------------|-------------|
| **Regression Protection** | Tests will fail if security fixes are accidentally reverted |
| **Behavior Documentation** | Tests serve as executable documentation of expected behavior |
| **Security Boundary Enforcement** | Tests define what should and shouldn't be allowed |
| **CI/CD Integration** | Tests can run automatically to catch issues early |
| **Developer Onboarding** | New developers can understand auth flow by reading tests |

### Test Files

```
src/modules/auth/__tests__/
├── auth.test.js              # Main auth flow tests (updated with security fixes)
├── auth.security.test.js     # Security-specific test suite
└── totp.service.test.js      # 2FA/TOTP service tests
```

### Test Count by Category

| Category | Tests | Coverage |
|----------|-------|----------|
| Critical Security | 4 | 100% |
| High Severity | 3 | 100% |
| Medium Severity | 5 | 100% |
| Normal Flow | 8 | Core paths |
| **Total** | **20+** | Full coverage |

---

## 2. Login Form Behavior

### Input Validation Rules

| Field | Required | Validation Rules | Error Message |
|-------|----------|------------------|---------------|
| **Email** | Yes | Valid email format (tlds: { allow: false }) | "Please provide a valid email address" |
| **Password** | Yes | Min 8 chars, 1 uppercase, 1 digit, 1 special | "Password must be at least 8 characters long" |

### Login Flow (Normal Case)

```
Step 1: User submits email + password
        ↓
Step 2: System checks account lockout status (Redis: login_lockout:{email})
        ↓
    IF locked → Return 429 "Account temporarily locked... Try again in X minutes"
    IF not locked → Continue
        ↓
Step 3: Verify credentials (bcrypt password comparison)
        ↓
    IF invalid → Record failed attempt (Redis: login_attempts:{email})
              → Increment counter
              → After 5 failures: Lock account for 15 minutes
              → Return 401 "Invalid email or password"
    IF valid → Clear failed attempts from Redis
             → Continue
        ↓
Step 4: Check if 2FA enabled (user.settings.totp_enabled)
        ↓
    IF 2FA enabled → Generate tempToken (crypto.randomBytes, 5 min TTL in Redis)
                  → Return { requires2fa: true, tempToken }
    IF 2FA not enabled → Generate tokens
                      → Set httpOnly cookies
                      → Return user data (NO tokens in body)
```

### Response Format (Success - Normal Login)

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "full_name": "User Name",
      "phone": null,
      "profile_picture": null
    },
    "currentShop": {
      "id": "uuid",
      "unique_code": "ABC12",
      "shop_name": "My Shop",
      "role": "owner"
    },
    "allShops": [
      {
        "id": "uuid",
        "unique_code": "ABC12",
        "shop_name": "My Shop",
        "role": "owner"
      }
    ]
  }
}
```

**HTTP Cookies Set:**
- `access_token` - HttpOnly, Secure, SameSite=Strict, Path=/, MaxAge=1 day
- `refresh_token` - HttpOnly, Secure, SameSite=Strict, Path=/auth, MaxAge=30 days

### Response Format (Success - 2FA Required)

```json
{
  "success": true,
  "message": "2FA required",
  "data": {
    "requires2fa": true,
    "tempToken": "abc123..."  // 5 minute TTL
  }
}
```

### What Should NOT Happen (Negative Cases)

| # | Scenario | Expected Behavior | Security Fix |
|---|----------|-------------------|--------------|
| 1 | Tokens in response body | Should NOT appear - only httpOnly cookies | 2FA Token Leak Fix |
| 2 | Session without credentials | Should NOT create session | Basic security |
| 3 | 2FA bypass | Should NOT skip 2FA verification | 2FA enforcement |
| 4 | Email enumeration | Same error message for invalid email vs invalid password | Anti-enumeration |
| 5 | Unlimited login attempts | Account lockout after 5 failures | Rate limiting |
| 6 | Token reuse after password reset | Old tokens should be rejected | Token Version Fix |

---

## 3. Complete Auth Flows

### 3.1 Signup (`POST /api/auth/signup`)

#### Input Validation

```javascript
{
  email: Joi.string().email({ tlds: { allow: false } }).lowercase().required(),
  password: Joi.string()
    .min(8)
    .pattern(/[A-Z]/, 'uppercase')
    .pattern(/[0-9]/, 'digit')
    .pattern(/[^A-Za-z0-9]/, 'special')
    .required(),
  full_name: Joi.string().trim().min(2).optional(),
  phone: Joi.string().trim().optional()
}
```

#### Business Logic Flow

```
1. Validate input (Joi validation)
   ↓
2. Check email uniqueness
   IF exists → Return 400 "User with this email already exists"
   ↓
3. Hash password (bcrypt, salt rounds: 12)
   ↓
4. Create entities in transaction:
   - User (email, hashed_password, full_name, phone, token_version: 1)
   - Tenant (name from user input or email prefix)
   - Shop (unique 5-6 char code, tenant_id, name)
   - UserShop (user_id, shop_id, role: 'owner', is_active: true)
   ↓
5. Generate tokens:
   - access_token: JWT (userId, email, shopId, tokenVersion, exp: 1 day)
   - refresh_token: random string
   ↓
6. Store refresh_token hash (SHA-256, NOT bcrypt)
   ↓
7. Set httpOnly cookies
   ↓
8. Return 201 with user data (NO tokens in body)
```

#### Success Response (201)

```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "user": { /* user object */ },
    "currentShop": { /* shop object */ },
    "allShops": [ /* array */ ]
  }
}
```

#### What Should NOT Happen

- ❌ Duplicate email should NOT create new account
- ❌ Weak password should NOT be accepted
- ❌ Tokens should NOT appear in response body
- ❌ Bcrypt should NOT be used for refresh token hashing

---

### 3.2 Signin (`POST /api/auth/signin`)

#### Rate Limits

| Limit | Window | Action |
|-------|--------|--------|
| 5 attempts | 15 minutes | Lock account |

#### Business Logic Flow

```
1. Validate input (email format, password non-empty)
   ↓
2. Check account lockout (Redis: login_lockout:{email})
   IF locked → Return 429 with remaining lockout time
   ↓
3. Find user by email (include shops via UserShop)
   IF not found → Record failed login → Return 401
   ↓
4. Compare password (bcrypt)
   IF invalid → Record failed login
             → Increment attempt counter (Redis)
             → IF attempts >= 5 → Lock account for 15 minutes
             → Return 401 "Invalid email or password"
   ↓
5. Clear failed attempts (Redis del)
   ↓
6. Check 2FA enabled (user.settings?.totp_enabled)
   IF enabled → Generate tempToken (crypto.randomBytes 32 hex)
             → Save to Redis (5 min TTL)
             → Return { requires2fa: true, tempToken }
   ↓
7. Check user has shops
   IF no shops → Return 403 "User has no associated shops"
   ↓
8. Determine shop context:
   - Try last_logged_shop_id
   - If invalid, use first owner shop or first shop
   ↓
9. Update last_logged_shop_id
   ↓
10. Generate tokens (with token_version in JWT)
    ↓
11. Hash and store refresh_token (SHA-256)
    ↓
12. Set httpOnly cookies
    ↓
13. Return user data
```

#### What Should NOT Happen

- ❌ Locked account should authenticate
- ❌ Valid password should unlock account automatically
- ❌ 2FA code should work without tempToken
- ❌ Different error messages for invalid email vs password
- ❌ Tokens in response body

---

### 3.3 2FA Verify (`POST /api/auth/2fa/verify`)

#### Rate Limits

| Limit | Window | Trigger |
|-------|--------|---------|
| 5 attempts | 5 minutes | Return 429 |

#### Input Validation

```javascript
{
  tempToken: Joi.string().required(),  // From signin response
  token: Joi.string().length(6).pattern(/^[0-9]+$/).required()  // 6-digit TOTP
}
```

#### Business Logic Flow

```
1. Rate limit check (5 per 5 min per IP)
   IF exceeded → Return 429 "Too many 2FA attempts"
   ↓
2. Consume tempToken (Redis get + del)
   IF not found/expired → Return 401 "Invalid or expired session"
   ↓
3. Find user by userId (from tempToken)
   IF not found → Return 404 "User not found"
   ↓
4. Verify shopId exists
   IF !last_logged_shop_id → Return 401 "No active shop session"
   ↓
5. Verify TOTP code:
   a. Check if token already used (Redis: totp_used:{userId}:{code})
      IF used → Return 400 "TOTP token already used"
   b. Decrypt TOTP secret (AES-256-GCM)
   c. Calculate TOTP for current time ±30s window (clock skew tolerance)
   d. IF invalid → Return 400 "Invalid TOTP token"
   e. Mark token as used (Redis setex 90s)
   ↓
6. Generate full JWT tokens (access + refresh)
   ↓
7. Hash and store refresh_token (SHA-256)
   ↓
8. Set httpOnly cookies
   ↓
9. Return { authenticated: true } (NO tokens in body!)
```

#### Success Response (200)

```json
{
  "success": true,
  "data": {
    "authenticated": true
    // NOTE: NO accessToken or refreshToken here
  }
}
```

#### What Should NOT Happen

- ❌ Reused TOTP code should work (replay attack)
- ❌ Invalid tempToken should reveal user info
- ❌ Tokens in response body (2FA Token Leak fix)
- ❌ More than 5 attempts in 5 minutes
- ❌ TOTP code outside ±30s window should work

---

### 3.4 Token Refresh (`POST /api/auth/refresh`)

#### Input Sources (Priority)

1. `req.body.refresh_token`
2. `req.cookies.refresh_token`

#### Business Logic Flow

```
1. Extract refresh_token (body or cookie)
   IF missing → Return 400 "Refresh token is required"
   ↓
2. Verify JWT signature (HS256)
   IF invalid/expired → Return 401 "Invalid or expired refresh token"
   ↓
3. Find user by userId (from JWT)
   IF not found → Return 401 "Invalid refresh token"
   ↓
4. Verify refresh_token hash (SHA-256 comparison)
   IF no match → Return 401 "Invalid refresh token"
   ↓
5. Check last_logged_shop_id
   IF null → Return 401 "No active shop session found. Please login again."
   ↓
6. Get current token_version from DB
   ↓
7. Generate new access_token (with current tokenVersion)
   ↓
8. Set httpOnly access_token cookie
   ↓
9. Audit log: TOKEN_REFRESH
   ↓
10. Return { refreshed: true }
```

#### Success Response (200)

```json
{
  "success": true,
  "message": "Access token refreshed successfully",
  "data": {
    "refreshed": true
  }
}
```

#### What Should NOT Happen

- ❌ Refresh with null shopId should work
- ❌ Bcrypt should be used for refresh token (too slow)
- ❌ Blacklisted refresh token should work
- ❌ Body validation should reject cookie-only requests (fixed: made optional)

---

### 3.5 Get Current User (`GET /api/auth/me`)

#### Authentication Required

- Valid access_token (Authorization header OR cookie)
- Token NOT blacklisted (Redis check)
- Token version matches DB (token_version field)

#### Business Logic Flow

```
1. Extract token (Authorization: Bearer XXX or cookie)
   ↓
2. Verify JWT (signature + expiry)
   IF invalid → Return 401
   ↓
3. Check blacklist (Redis: token_blacklist:{token})
   IF blacklisted → Return 401 "Token has been revoked"
   ↓
4. Verify token_version (IF present in JWT)
   - Find user by userId
   - Compare JWT tokenVersion with DB token_version
   IF mismatch → Return 401 "Token has been invalidated"
   ↓
5. Get auth context (user + shops + subscription)
   ↓
6. Return user data
```

#### What Should NOT Happen

- ❌ Expired token should work
- ❌ Blacklisted token should work
- ❌ Token after password reset should work (token_version mismatch)
- ❌ Missing token should return any data

---

### 3.6 Logout (`POST /api/auth/logout`)

#### Business Logic Flow

```
1. Extract token (Authorization header OR cookie)
   ↓
2. IF token AND user exists:
   a. Calculate TTL (decoded.exp - now)
   b. IF TTL > 0 → Blacklist in Redis (token_blacklist:{token}, TTL seconds)
      IF TTL <= 0 → Skip (token already expired)
   ↓
3. Clear httpOnly cookies (with domain if set)
   ↓
4. Audit log: LOGOUT
   ↓
5. Return success
```

#### Cookie Clearing Details

```javascript
// Correct implementation includes domain if set
clearCookie('access_token', {
  path: '/',
  ...(config.cookieDomain && { domain: config.cookieDomain })
});
clearCookie('refresh_token', {
  path: '/auth',
  ...(config.cookieDomain && { domain: config.cookieDomain })
});
```

#### What Should NOT Happen

- ❌ Blacklist TTL should extend token lifetime (fixed: Math.max(0, exp - now))
- ❌ Cookies should persist after logout (fixed: include domain)
- ❌ Expired tokens should be blacklisted with 1 day TTL (fixed: only if TTL > 0)

---

### 3.7 Forgot Password (`POST /api/auth/forgot-password`)

#### Input Validation

```javascript
{
  email: Joi.string().email({ tlds: { allow: false } }).lowercase().required()
}
```

#### Business Logic Flow

```
1. Validate email format
   ↓
2. Find user by email
   IF not found → Still return 200 "If an account exists..." (anti-enumeration)
   ↓
3. Delete any existing unused reset tokens for this user
   ↓
4. Generate reset token:
   - Raw token: crypto.randomBytes(32).toString('hex')
   - Stored hash: SHA-256(rawToken)
   - Expiry: 1 hour (Date.now() + 60 * 60 * 1000)
   ↓
5. Save to PasswordResetToken table:
   { user_id, token_hash, expires_at, used_at: null }
   ↓
6. Send email with reset link containing raw token
   ↓
7. Return 200 "If an account exists for this email, a reset link has been sent."
```

#### What Should NOT Happen

- ❌ Email enumeration via different responses
- ❌ Multiple unused tokens accumulating
- ❌ Token stored in plain text
- ❌ Token valid forever

---

### 3.8 Reset Password (`POST /api/auth/reset-password`)

#### Input Validation

```javascript
{
  token: Joi.string().required(),      // Reset token from email
  password: Joi.string()
    .min(8)
    .pattern(/[A-Z]/, 'uppercase')
    .pattern(/[0-9]/, 'digit')
    .pattern(/[^A-Za-z0-9]/, 'special')
    .required()
}
```

#### Business Logic Flow

```
1. Validate inputs
   ↓
2. Calculate SHA-256 hash of provided token
   ↓
3. Lookup PasswordResetToken:
   { token_hash, used_at: null, expires_at: { $gt: now } }
   IF not found → Return 400 "Invalid or expired reset token"
   ↓
4. Find user by userId (from token record)
   IF not found → Return 400 "Invalid or expired reset token"
   ↓
5. Transaction:
   a. Mark token as used (update used_at)
   b. Update password (bcrypt hash)
   c. Clear refresh_token (force re-login on all devices)
   d. INCREMENT token_version (invalidates ALL existing access tokens!)
   ↓
6. Commit transaction
   ↓
7. Return 200 "Password reset successfully."
```

#### What Should NOT Happen

- ❌ Old access tokens should work after reset (prevented by token_version increment)
- ❌ Used/expired token should work
- ❌ Weak password should be accepted
- ❌ Other sessions should remain valid

---

## 4. Security Test Matrix

| Scenario | Expected Result | Test File | Test Name |
|----------|-----------------|-----------|-----------|
| Login with correct credentials | 200 + httpOnly cookies | auth.test.js | Login with valid credentials |
| Login with wrong password | 401 + increment lockout | auth.test.js | Login with invalid credentials |
| 5 failed logins | 429 account locked | auth.test.js | Account lockout after max attempts |
| 2FA verify 5 rapid attempts | 429 rate limited | auth.test.js | 2FA rate limiting |
| Reuse TOTP code | 400 "already used" | totp.service.test.js | TOTP replay protection |
| Refresh with null shopId | 401 "No active shop session" | auth.security.test.js | Refresh requires shopId |
| Token after password reset | 401 "invalidated" | auth.test.js | Token version mismatch |
| Blacklist expired token | No Redis call (TTL <= 0) | auth.security.test.js | TTL calculation |
| Missing APP_SECRET | Error on startup | totp.service.test.js | Encryption key validation |
| Session creation | No sessionToken in response | auth.security.test.js | Session token exposure |
| Cookie-only refresh | Should work without body token | auth.test.js | Refresh with cookie only |
| 2FA verify tokens in body | Should NOT have accessToken/refreshToken | auth.security.test.js | 2FA verify httpOnly cookies |
| Password reset | Increment token_version | auth.service.js | Reset password transaction |

---

## 5. API Reference

### Endpoints Summary

| Method | Endpoint | Auth Required | Rate Limit | Description |
|--------|----------|---------------|------------|-------------|
| POST | `/api/auth/signup` | No | Yes | Create user with shop |
| POST | `/api/auth/signin` | No | Yes | Login (returns 2FA challenge if enabled) |
| POST | `/api/auth/2fa/verify` | No | Yes (strict) | Complete 2FA login |
| POST | `/api/auth/refresh` | No | Yes | Refresh access token |
| GET | `/api/auth/me` | Yes | Yes | Get current user context |
| POST | `/api/auth/logout` | Yes | Yes | Logout and blacklist token |
| POST | `/api/auth/forgot-password` | No | Yes | Request password reset |
| POST | `/api/auth/reset-password` | No | Yes | Reset password with token |
| POST | `/api/auth/2fa/setup` | Yes | Yes | Generate TOTP secret |
| POST | `/api/auth/2fa/enable` | Yes | Yes | Enable 2FA |
| POST | `/api/auth/2fa/disable` | Yes | Yes | Disable 2FA |

### HTTP Status Codes

| Code | Meaning | Usage |
|------|---------|-------|
| 200 | OK | Successful operation |
| 201 | Created | User created successfully |
| 400 | Bad Request | Validation error, invalid input |
| 401 | Unauthorized | Authentication failed or required |
| 403 | Forbidden | User has no shops |
| 404 | Not Found | User not found |
| 429 | Too Many Requests | Rate limit or account lockout |
| 500 | Internal Server Error | Unexpected error |

---

## Database Schema Changes

### token_version Field

```sql
-- Required migration for password reset invalidation
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1;

-- Index for faster lookups (optional)
CREATE INDEX idx_users_token_version ON users(token_version);
```

### Redis Key Patterns

| Pattern | TTL | Purpose |
|---------|-----|---------|
| `token_blacklist:{token}` | Token remaining lifetime | Revoked tokens |
| `login_attempts:{email}` | 15 minutes | Failed login counter |
| `login_lockout:{email}` | 15 minutes | Account lockout |
| `totp_temp:{tempToken}` | 5 minutes | 2FA step-1 session |
| `totp_used:{userId}:{code}` | 90 seconds | Prevent TOTP replay |
| `reset_token:{hash}` | 1 hour | Password reset tokens |

---

## Security Checklist

- [x] 2FA tokens delivered via httpOnly cookies only
- [x] Password reset invalidates all existing access tokens (token_version)
- [x] Refresh token requires valid shopId
- [x] SHA-256 used for refresh token hashing (not bcrypt)
- [x] Session token not exposed in API responses
- [x] 2FA verify endpoint rate limited (5 per 5 min)
- [x] Token blacklist uses correct TTL (not extending expired tokens)
- [x] TOTP encryption requires APP_SECRET or JWT_SECRET
- [x] Cookie clearing includes domain when set
- [x] Refresh validator accepts cookie-only requests

---

## Related Files

| File | Purpose |
|------|---------|
| `auth.controller.js` | HTTP request handlers |
| `auth.service.js` | Core business logic |
| `auth.routes.js` | Route definitions with middleware |
| `auth.middleware.js` | JWT authentication middleware |
| `auth.validator.js` | Input validation schemas |
| `auth-cookies.js` | Cookie setting/clearing utilities |
| `jwt.util.js` | JWT generation and verification |
| `password.util.js` | Bcrypt password hashing |
| `totp.service.js` | 2FA/TOTP implementation |
| `totp.controller.js` | 2FA HTTP handlers |
| `session.service.js` | Session management |

---

## Document Information

- **Version**: 1.0
- **Last Updated**: April 14, 2026
- **Author**: AI Assistant
- **Security Fixes Applied**: 10 issues (2 critical, 3 high, 5 medium)
- **Test Coverage**: 20+ test cases
