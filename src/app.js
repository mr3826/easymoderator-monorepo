const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('src/config/config');
const routes = require('src/modules/routes'); // Centralized routes
const metaWebhookRoutes = require('src/modules/integration/meta-webhook.routes');
const { AppError, globalErrorHandler } = require('src/utils/AppError');

const app = express();

// Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (config.env === 'development') {
    app.use(morgan('dev'));
}


app.get('/', (req, res) => {
    res.send('welcome to commerce-ai server');
});

// Webhook routes (must be before JSON parsing middleware)
app.use('/webhooks/meta', metaWebhookRoutes);

// Routes
app.use('/', routes);

// 404 Handler
app.all('*', (req, res, next) => {
    next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Global Error Handler
app.use(globalErrorHandler);

module.exports = app;
