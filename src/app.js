const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const config = require('src/config/config');
const routes = require('src/modules/routes');
const healthRoutes = require('src/routes/health.routes');
const metaWebhookRoutes = require('src/modules/integration/meta-webhook.routes');
const { AppError, globalErrorHandler } = require('src/utils/AppError');
const { requestContextMiddleware } = require('src/middleware/request-context.middleware');
const createSessionMiddleware = require('src/middleware/session.middleware');

const app = express();

// Trust proxy so secure cookies work behind load balancers
if (config.env === 'production') {
    app.set('trust proxy', 1);
}

// Security headers
app.use(helmet());

// CORS with allowlist
const allowedOrigins = config.corsOrigins || [];
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

// Rate limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500,
    standardHeaders: true,
    legacyHeaders: false
});
app.use(apiLimiter);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request context middleware (must be early for all requests)
app.use(requestContextMiddleware);

// Session middleware (Redis-backed in production)
app.use(createSessionMiddleware());

// Dev logging
if (config.env === 'development') {
    app.use(morgan('dev'));
}

app.get('/', (req, res) => {
    res.send('welcome to commerce-ai server');
});

// Health check endpoints (no auth required, must be before other routes)
app.use('/health', healthRoutes);

// Webhook routes (must be before JSON parsing middleware)
app.use('/webhooks/meta', metaWebhookRoutes);

// API routes
app.use('/', routes);

// 404 Handler
app.all('*', (req, res, next) => {
    next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Global Error Handler
app.use(globalErrorHandler);

module.exports = app;
