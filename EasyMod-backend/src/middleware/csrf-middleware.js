const { doubleCsrf } = require('csrf-csrf');
const crypto = require('crypto');
const config = require('../config/config');
const { AppError } = require('../utils/AppError');

/**
 * Cookie-issuing authentication endpoints cannot use the double-submit token
 * before a browser session exists. In production, bind those requests to the
 * merchant app origin instead. Browsers include Origin on cross-origin and
 * same-origin POST requests, so a missing or sibling origin must fail closed.
 */
const isTrustedAuthOrigin = (
    origin,
    environment = config.env,
    appOrigin = config.origins?.app
) => environment !== 'production' || origin === appOrigin;

// Enhanced CSRF configuration with better error handling
const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
    getSecret: () => config.csrfSecret,
    getSessionIdentifier: (req) => {
        // Prefer express-session ID (stable across requests in the same session)
        if (req.sessionID) return req.sessionID;
        if (req.session?.id) return req.session.id;

        // No session available: generate a random ID and persist it in the session.
        // This replaces the previous IP-based fallback which was vulnerable to:
        //   (a) X-Forwarded-For spoofing, and
        //   (b) CSRF token sharing on shared networks (NAT / proxies).
        if (req.session) {
            if (!req.session._csrfSessionId) {
                req.session._csrfSessionId = crypto.randomUUID();
                // Non-blocking save — if it fails the token will still work for this
                // request but the session won't be persisted (acceptable for anonymous).
                req.session.save((err) => {
                    if (err) console.error('[csrf] session save error:', err.message);
                });
            }
            return req.session._csrfSessionId;
        }

        // Hard fallback: every call gets a fresh UUID, meaning no CSRF protection for
        // truly session-less requests.  Auth-required endpoints are protected by JWT,
        // so this path only applies to unauthenticated state-changing endpoints, which
        // should not exist (they are either public or auth-gated).
        return crypto.randomUUID();
    },
    cookieOptions: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: config.env === 'production'
    }
});

// CSRF token endpoint — session ID is already stable (saveUninitialized: true),
// so no explicit session.save() is needed before generating the token.
const csrfTokenHandler = (req, res, next) => {
    try {
        if (!req.session) {
            return next(new AppError('Session not initialized', 500));
        }
        const csrfToken = generateCsrfToken(req, res);
        res.status(200).json({ csrfToken });
    } catch (error) {
        console.error('CSRF token generation error:', error);
        next(new AppError('Failed to generate CSRF token', 500));
    }
};

// Enhanced CSRF protection middleware with better error handling
const csrfProtectionMiddleware = (req, res, next) => {
    // Skip CSRF for safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    // These routes are intentionally anonymous and never read or mutate an
    // authenticated user's state. Keep this list exact so no authenticated
    // analytics or partner-admin route inherits the exemption.
    const publicWritePaths = new Set([
        '/api/analytics/funnel',
        '/api/partner/apply',
    ]);
    if (publicWritePaths.has(req.path)) {
        return next();
    }

    // Anonymous authentication flows do not act on an existing authenticated
    // account. Keep this exact: logout, 2FA setup/enable/disable and session
    // management remain CSRF-protected.
    const anonymousAuthPaths = new Set([
        '/api/auth/signup',
        '/api/auth/signin',
        '/api/auth/refresh',
        '/api/auth/forgot-password',
        '/api/auth/reset-password',
        '/api/auth/2fa/verify',
    ]);
    if (anonymousAuthPaths.has(req.path)) {
        if (!isTrustedAuthOrigin(req.get('Origin'))) {
            return next(new AppError('Authentication requests must originate from the merchant app.', 403));
        }
        return next();
    }

    // Skip CSRF for provider callbacks and auth endpoints.
    const skipPaths = [
        '/webhooks',
        '/api/webhooks',
        '/health',
        '/csrf',
        '/api/csrf'
    ];

    const path = req.path;
    if (skipPaths.some(skipPath => path.startsWith(skipPath))) {
        return next();
    }

    // Skip CSRF in test environment
    if (config.env === 'test') {
        return next();
    }

    // Apply CSRF protection with enhanced error handling
    doubleCsrfProtection(req, res, (err) => {
        if (err) {
            // Enhanced error logging
            const errorInfo = {
                method: req.method,
                path: req.path,
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                sessionId: req.sessionID,
                timestamp: new Date().toISOString(),
                error: err.message
            };

            if (config.env === 'development') {
                console.warn('❌ CSRF Error:', errorInfo);
            } else {
                // In production, log structured error for monitoring
                console.error('CSRF Validation Failed', JSON.stringify(errorInfo));
            }

            // Return appropriate error response
            if (err.message.includes('invalid csrf token')) {
                return next(new AppError('Invalid CSRF token. Please refresh the page and try again.', 403));
            } else if (err.message.includes('csrf token missing')) {
                return next(new AppError('CSRF token required. Please include the token in your request.', 400));
            } else {
                return next(new AppError('CSRF validation failed. Please try again.', 403));
            }
        }
        next();
    });
};

// CSRF debugging endpoint (development only)
const csrfDebugHandler = (req, res, next) => {
    if (config.env !== 'development') {
        return next(new AppError('Debug endpoint not available in production', 404));
    }

    try {
        const debugInfo = {
            sessionId: req.sessionID,
            sessionExists: !!req.session,
            csrfInit: req.session?.csrfInit,
            cookies: req.cookies,
            headers: {
                'x-csrf-token': req.get('x-csrf-token'),
                'cookie': req.get('cookie')
            },
            config: {
                env: config.env,
                secureCookies: config.env === 'production'
            }
        };

        res.json(debugInfo);
    } catch (error) {
        next(new AppError('Debug information unavailable', 500));
    }
};

module.exports = {
    csrfTokenHandler,
    csrfProtectionMiddleware,
    csrfDebugHandler,
    isTrustedAuthOrigin,
};
