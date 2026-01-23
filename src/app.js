const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('src/config/config');
const routes = require('src/modules/routes');
const healthRoutes = require('src/routes/health.routes');
const metaWebhookRoutes = require('src/modules/integration/meta-webhook.routes');
const { AppError, globalErrorHandler } = require('src/utils/AppError');
const { requestContextMiddleware } = require('src/middleware/request-context.middleware');

const app = express();

// Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request context middleware (must be early for all requests)
app.use(requestContextMiddleware);

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
