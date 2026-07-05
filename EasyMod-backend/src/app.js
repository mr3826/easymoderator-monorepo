const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const timeout = require('express-timeout-handler');
const { csrfTokenHandler, csrfProtectionMiddleware, csrfDebugHandler } = require('./middleware/csrf-middleware');
const config = require('./config/config');
const routes = require('./modules/routes');
const healthRoutes = require('./routes/health.routes');
const metaWebhookRoutes = require('./modules/integration/meta-webhook.routes');
const courierWebhookRoutes = require('./modules/webhooks/courier-webhook.routes');
const telegramWebhookRoutes = require('./modules/webhooks/telegram-webhook.routes');
const { AppError, globalErrorHandler } = require('./utils/AppError');
const { initSentry, sentryCaptureException } = require('./config/sentry');
const { requestContextMiddleware } = require('./middleware/request-context.middleware');
const createSessionMiddleware = require('./middleware/session.middleware');
const xssSanitize = require('./middleware/xss-sanitize.middleware');

const cacheService = require('./utils/cache.service');
const { getTierByCode } = require('./modules/subscription/subscription.plans');

// Extract shopId for rate-limit key derivation.
// Prefers req.user.shopId (set by verified auth middleware) to prevent shopId spoofing.
// Falls back to an unverified JWT peek only for unauthenticated requests where
// rate-limit precision matters more than security (the key is just a bucket, not a trust decision).
function getShopIdFromRequest(req) {
    if (req.user?.shopId) return req.user.shopId;
    try {
        let token = null;
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else if (req.cookies?.access_token) {
            token = req.cookies.access_token;
        }
        if (!token) return null;
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
        return payload.shopId || null;
    } catch (_) {
        return null;
    }
}

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

// Security headers.
// COOP override: default `same-origin` severs `window.opener` when an OAuth
// popup navigates to facebook.com and back, breaking the postMessage handshake
// in [OAuthCallbackPage.tsx](../../EasyMod-frontend/src/app/components/OAuthCallbackPage.tsx).
// `same-origin-allow-popups` keeps the opener reference for popups WE open
// while still preventing external pages from grabbing it.
app.use(helmet({
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
}));

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

    // Per-shop rate limiter — keyed by shopId when authenticated, falls back to IP.
    // Per-plan limits come from the plan tier's features.rate_limit_per_minute (cached 5 min).
    const shopRateLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15-minute window
        keyGenerator: (req) => {
            const shopId = getShopIdFromRequest(req);
            return shopId ? `t:shop:${shopId}` : req.ip;
        },
        max: async (req) => {
            const shopId = getShopIdFromRequest(req);
            if (!shopId) return 500; // unauthenticated — global baseline
            try {
                const cached = await cacheService.getForShop(shopId, 'subscription:plan_ratelimit');
                if (cached !== null) return cached;
                const { Subscription } = require('./modules/entities');
                const sub = await Subscription.findOne({ where: { shop_id: shopId }, attributes: ['plan_code'] });
                // getTierByCode normalizes legacy/unknown codes → GROWTH (fail-safe).
                const ratePerMin = getTierByCode(sub?.plan_code)?.features?.rate_limit_per_minute ?? 40;
                const limit = ratePerMin * 15;
                await cacheService.setForShop(shopId, 'subscription:plan_ratelimit', limit, 300);
                return limit;
            } catch (_) {
                return 500; // fail open
            }
        },
        standardHeaders: true,
        legacyHeaders: false,
        store: buildStore('rl:shop:')
    });
    app.use(shopRateLimiter);

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
        app.use('/api/auth', authLimiter);
    }
}

// Webhook routes (must be before JSON parsing middleware)
// Phase 5: only canonical /api/webhooks/meta remains.
// Update your Meta App Dashboard webhook URL to use /api/webhooks/meta.
app.use('/api/webhooks/meta', metaWebhookRoutes);
app.use('/webhooks/delivery', courierWebhookRoutes);

// Body parsing — verify callback captures raw bytes so payment HMAC middleware
// can compare against the original request body, not re-serialized JSON.
app.use(express.json({
    limit: config.bodySizeLimit,
    verify: (req, _res, buf) => { req.rawBody = buf; }
}));
app.use(express.urlencoded({ extended: true, limit: config.bodySizeLimit }));

// Telegram Bot API webhook is JSON and secret-header protected. It must be
// registered before CSRF because Telegram cannot supply browser CSRF tokens.
app.use('/api/webhooks/telegram', telegramWebhookRoutes);

// Global XSS sanitization — strips script tags, event handlers, javascript: URIs from req.body
app.use(xssSanitize);

// Cookie parser (for httpOnly token cookies)
app.use(cookieParser());

// Request context middleware (must be early — provides req.logger for P2-5)
app.use(requestContextMiddleware);

// Session middleware (Redis-backed in production)
app.use(createSessionMiddleware());

// P2-3: CSRF — Enhanced CSRF middleware with better error handling
// Both paths work: frontend uses /api/csrf via its baseURL, direct callers use /csrf
app.get('/csrf', csrfTokenHandler);
app.get('/api/csrf', csrfTokenHandler);

// CSRF debug endpoint (development only — not registered in other environments)
if (config.env === 'development') {
    app.get('/csrf/debug', csrfDebugHandler);
}

// Apply CSRF protection to all non-safe methods
app.use(csrfProtectionMiddleware);

// P2-2: Apply global timeout after CSRF so protected routes are covered
app.use(timeoutHandler);

// Dev logging
if (config.env === 'development') {
    app.use(morgan('dev'));
}

app.get('/', (req, res) => {
    res.send('welcome to EasyModerator API server');
});

// This tells AWS: "Yes, I am alive and working!"
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Sentry request handler (no-op until SENTRY_DSN is set)
initSentry(app);

// Health check endpoints (no auth required, must be before other routes)
app.use('/health', healthRoutes);

// Public uploaded assets used by Meta Messenger attachment delivery. Filenames
// are generated server-side; do not expose user-provided directory paths.
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
    maxAge: config.env === 'production' ? '1h' : 0,
}));

// Unauthenticated version probe — answers "is the fix live on prod?" in one curl.
// Must be mounted before `/api` so it bypasses every authenticated route module.
app.use('/api/version', require('./routes/version.routes'));

// API routes
app.use('/api', routes);

// 404 Handler
app.all('*', (req, res, next) => {
    next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Forward 500-level errors to Sentry (no-op until SENTRY_DSN is set)
app.use((err, req, res, next) => {
    if (!err.status || err.status >= 500) {
        sentryCaptureException(err, { url: req.originalUrl, method: req.method });
    }
    next(err);
});

// Global Error Handler
app.use(globalErrorHandler);

module.exports = app;
