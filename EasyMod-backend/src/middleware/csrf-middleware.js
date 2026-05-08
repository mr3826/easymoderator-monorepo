const { doubleCsrf } = require('csrf-csrf');
const config = require('../config/config');
const { AppError } = require('../utils/AppError');

// Enhanced CSRF configuration with better error handling
const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
    getSecret: () => config.sessionSecret,
    getSessionIdentifier: (req) => {
        // More reliable session ID retrieval
        if (req.sessionID) return req.sessionID;
        if (req.session?.id) return req.session.id;
        if (req.session?.sessionID) return req.session.sessionID;
        
        // Fallback to IP for anonymous requests (less secure but functional)
        const clientIP = req.headers['x-forwarded-for'] || 
                        req.headers['x-real-ip'] || 
                        req.connection?.remoteAddress || 
                        req.socket?.remoteAddress || 
                        req.ip || 
                        'anonymous';
        
        return clientIP;
    },
    cookieOptions: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: config.env === 'production'
    }
});

// Enhanced CSRF token handler with proper session management
const csrfTokenHandler = async (req, res, next) => {
    try {
        // Ensure session is initialized
        if (!req.session) {
            return next(new AppError('Session not initialized', 500));
        }

        // Mark CSRF as initialized to prevent re-initialization
        if (!req.session.csrfInit) {
            req.session.csrfInit = true;
        }

        // Use Promise-based session save for better error handling
        await new Promise((resolve, reject) => {
            req.session.save((err) => {
                if (err) {
                    console.error('Session save error on CSRF token generation:', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        // Generate CSRF token
        const csrfToken = generateCsrfToken(req, res);
        
        // Set additional headers for debugging
        res.set('X-CSRF-Token-Generated', 'true');
        res.set('X-Session-ID', req.sessionID);
        
        res.status(200).json({ 
            csrfToken,
            sessionId: req.sessionID,
            timestamp: new Date().toISOString()
        });

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

    // Skip CSRF for specific paths
    const skipPaths = [
        '/webhooks',
        '/api/webhooks',
        '/auth',
        '/api/auth',
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
    csrfDebugHandler
};
