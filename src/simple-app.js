const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const timeout = require('express-timeout-handler');
const config = require('./config/config');
const routes = require('./modules/routes');
const healthRoutes = require('./routes/health.routes.js');
const { AppError, globalErrorHandler } = require('./utils/AppError');

const app = express();

// Debug middleware - log all incoming requests
app.use((req, res, next) => {
    console.log(`🔍 DEBUG: ${req.method} ${req.url} - Headers:`, req.headers);
    console.log(`🔍 DEBUG: Request body:`, req.body);
    next();
});

// Basic middleware
app.use(helmet());
app.use(cors({
    origin: config.corsOrigins || ['http://localhost:5173', 'http://localhost:5174'],
    credentials: true
}));
app.use(express.json({ limit: config.bodySizeLimit || '1mb' }));
app.use(express.urlencoded({ extended: true, limit: config.bodySizeLimit || '1mb' }));
app.use(cookieParser());

// Simple rate limiting (disabled for now)
/*
if (rateLimitRedis) {
    app.use(rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 500,
        standardHeaders: true,
        legacyHeaders: false,
        store: new RedisStore({
            sendCommand: (...args) => rateLimitRedis.call(...args),
        })
    }));
}
*/

// Health check endpoints (no auth required)
app.use('/health', healthRoutes);

// API routes
app.use('/api', routes);

// Root endpoint
app.get('/', (req, res) => {
    res.send('EasyMod Backend API Server is running!');
});

// 404 Handler
app.all('*', (req, res, next) => {
    next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Global Error Handler
app.use(globalErrorHandler);

module.exports = app;
