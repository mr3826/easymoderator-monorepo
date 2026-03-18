const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const timeout = require('express-timeout-handler');
const { doubleCsrf } = require('csrf-csrf');
const config = require('./config/config');
const routes = require('./modules/routes');
const healthRoutes = require('./routes/health.routes');
const metaWebhookRoutes = require('./modules/integration/meta-webhook.routes');
const { AppError, globalErrorHandler } = require('./utils/AppError');
const { requestContextMiddleware } = require('./middleware/request-context.middleware');
const createSessionMiddleware = require('./middleware/session.middleware');
const xssSanitize = require('./middleware/xss-sanitize.middleware');

const app = express();

// P2-2: Request timeouts — global 30s; use timeout.set(5000) for read routes, timeout.set(10000) for write routes
const timeoutHandler = timeout.handler({
    timeout: 30000,
    onTimeout(req, res) {
        res.status(503).json({ success: false, error: { code: 'TIMEOUT', message: 'Request timeout' } });
    }
});

// Trust proxy so secure cookies work behind load balancers
if (config.env === 'production') {
    app.set('trust proxy', 1);
}

// Security headers
app.use(helmet());

// CORS with allowlist
const allowedOrigins = config.corsOrigins || [];
if (config.env === 'production' && allowedOrigins.length === 0) {
    throw new Error('CORS_ORIGINS must be set in production');
}

const corsOptions = allowedOrigins.length > 0
    ? {
        origin(origin, callback) {
            if (!origin || allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            return callback(new Error('Not allowed by CORS'));
        },
        credentials: true
    }
    : { origin: true, credentials: true };
app.use(cors(corsOptions));

// Rate limiting (skip in test environment to avoid interference with test suites)
// H8: Use Redis store so limits are shared across all PM2 workers/processes.
// Falls back to memory store if Redis is unavailable (development without Redis).
if (config.env !== 'test') {
    const { rateLimitRedis } = require('./config/redis');
    const buildStore = (prefix) => {
        try {
            if (rateLimitRedis && typeof rateLimitRedis.call === 'function') {
                return new RedisStore({
                    prefix,
                    sendCommand: (...args) => rateLimitRedis.call(...args)
                });
            }
        } catch (e) {
            // ioredis mock or unavailable — fall through to memory store
        }
        return undefined; // express-rate-limit default: MemoryStore
    };

    const apiLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 500,
        standardHeaders: true,
        legacyHeaders: false,
        store: buildStore('rl:api:')
    });
    app.use(apiLimiter);

    // Stricter rate limiting for auth endpoints (per IP)
    if (config.env !== 'development') {
        const authLimiter = rateLimit({
            windowMs: 60 * 1000, // 1 minute
            max: 10, // 10 requests per minute per IP
            standardHeaders: true,
            legacyHeaders: false,
            message: { success: false, error: { code: '429', message: 'Too many authentication attempts. Please try again later.' } },
            store: buildStore('rl:auth:')
        });
        app.use('/auth', authLimiter);
    }
}

// Webhook routes (must be before JSON parsing middleware)
app.use('/webhooks/meta', metaWebhookRoutes);

// Body parsing
app.use(express.json({ limit: config.bodySizeLimit }));
app.use(express.urlencoded({ extended: true, limit: config.bodySizeLimit }));

// Global XSS sanitization — strips script tags, event handlers, javascript: URIs from req.body
app.use(xssSanitize);

// Cookie parser (for httpOnly token cookies)
app.use(cookieParser());

// Request context middleware (must be early — provides req.logger for P2-5)
app.use(requestContextMiddleware);

// Session middleware (Redis-backed in production)
app.use(createSessionMiddleware());

// P2-3: CSRF — csrf-csrf (Double Submit Cookie); cookie-parser must be before this
const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
    getSecret: () => config.sessionSecret,
    getSessionIdentifier: (req) => req.session?.id || req.ip || 'anonymous',
    cookieOptions: {
        httpOnly: false, // Must be accessible by client-side JS if not using double submit cookie pattern, 
        // but csrf-csrf uses double submit cookie pattern where the token is in a header AND a cookie.
        // The cookie itself should be httpOnly: true for security usually, but csrf-csrf has its own logic.
        sameSite: 'lax',
        path: '/',
        secure: config.env === 'production'
    }
});

app.get('/csrf', (req, res) => {
    // Force session to be saved so the session ID is stable for CSRF validation.
    // Without this, saveUninitialized:false means the session is never persisted to Redis,
    // so successive requests get different session IDs and CSRF HMAC validation fails.
    if (!req.session.csrfInit) {
        req.session.csrfInit = true;
    }
    const csrfToken = generateCsrfToken(req, res);
    res.status(200).json({ csrfToken });
});

app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }
    const path = req.path;
    if (
        path.startsWith('/webhooks') ||
        path.startsWith('/api/webhooks') ||
        path.startsWith('/auth') ||
        path.startsWith('/api/auth') ||
        path.startsWith('/health') ||
        path === '/csrf' ||
        path.startsWith('/payment/aamarpay') ||
        path.startsWith('/api/payment/aamarpay') ||
        path.startsWith('/payment/sslcommerz') ||
        path.startsWith('/api/payment/sslcommerz')
        // NOTE: /order-session, /ai-chatbot, /notifications, /analytics
        // are browser-facing state-mutating routes — CSRF protection is enforced on these.
        // Automation callers (n8n/Make) must obtain a CSRF token via GET /csrf first.
    ) {
        return next();
    }
    return doubleCsrfProtection(req, res, (err) => {
        if (err && config.env === 'development') {
            console.warn(`❌ CSRF Error [${req.method} ${req.path}]:`, err.message);
        }
        next(err);
    });
});

// P2-2: Apply global timeout after CSRF so protected routes are covered
app.use(timeoutHandler);

// Dev logging
if (config.env === 'development') {
    app.use(morgan('dev'));
}

app.get('/', (req, res) => {
    res.send('welcome to commerce-ai server');
});

// This tells AWS: "Yes, I am alive and working!"
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Health check endpoints (no auth required, must be before other routes)
app.use('/health', healthRoutes);

// API routes
app.use('/api', routes);

// 404 Handler
app.all('*', (req, res, next) => {
    next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Global Error Handler
app.use(globalErrorHandler);

module.exports = app;
