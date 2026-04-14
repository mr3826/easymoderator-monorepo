# Auth Flow Security Tests

## Test Files

1. `src/modules/auth/__tests__/auth.test.js` - Main auth flow tests (updated with security fixes)
2. `src/modules/auth/__tests__/auth.security.test.js` - New security-specific tests
3. `src/modules/auth/__tests__/totp.service.test.js` - TOTP/2FA service tests

## Running Tests

```bash
# Run all auth tests
npm test -- src/modules/auth/__tests__

# Run specific test file
npm test -- src/modules/auth/__tests__/auth.test.js

# Run with coverage
npm test -- src/modules/auth/__tests__ --coverage

# Run with verbose output
npm test -- src/modules/auth/__tests__ --verbose
```

## Security Fixes Tested

### 🔴 Critical

| Fix | Test | Location |
|-----|------|----------|
| 2FA Token Leak - httpOnly Cookies | 2FA verify returns cookies, not tokens | `auth.security.test.js` |
| Password Reset Invalidation | token_version increment test | `auth.test.js` |

### 🟠 High Severity

| Fix | Test | Location |
|-----|------|----------|
| Refresh requires shopId | null shop rejection test | `auth.security.test.js` |
| SHA-256 for refresh tokens | hash comparison test | `auth.test.js` |
| Session token not exposed | response body check | `auth.security.test.js` |

### 🟡 Medium Severity

| Fix | Test | Location |
|-----|------|----------|
| 2FA Rate Limiting | 6 rapid requests trigger 429 | `auth.test.js` |
| Token Blacklist TTL | TTL <= 0 for expired tokens | `auth.security.test.js` |
| TOTP Encryption Key | throws on missing env var | `totp.service.test.js` |
| Cookie Domain Clearing | cleared cookies check | `auth.security.test.js` |
| Refresh Validator | cookie-only request works | `auth.test.js` |

## Test Environment Variables

```bash
NODE_ENV=test
JWT_ACCESS_SECRET=test-access-secret-32-chars-long!!
JWT_REFRESH_SECRET=test-refresh-secret-32-chars-long!
APP_SECRET=test-app-secret-32-chars-long!!!!
```

## Expected Test Results

All tests should pass with these characteristics:
- Token version mismatch = 401 Unauthorized
- Missing shopId on refresh = 401
- Rapid 2FA attempts = 429 Too Many Requests
- Blacklisted token = 401
- Missing token = 401
- Invalid credentials = 401
