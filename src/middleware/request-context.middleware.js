/**
 * Request Context Middleware
 * Injects request ID and user context into all requests
 * Enables structured logging and request tracing
 */

const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('../utils/structured-logger');

/**
 * Middleware to attach request context
 * Every request gets a unique ID for tracing and audit
 */
const requestContextMiddleware = (req, res, next) => {
    // Generate or use provided request ID
    const requestId = req.headers['x-request-id'] || uuidv4();
    
    // Extract user context from JWT payload (set by auth middleware)
    const userId = req.user?.userId || null;
    const shopId = req.user?.shopId || req.headers['x-shop-id'] || null;
    
    // Attach logger to request
    req.logger = createLogger(requestId, shopId, userId);
    
    // Attach context to response for tracing
    res.set('X-Request-ID', requestId);
    
    // Log request
    req.logger.info('Incoming request', {
        method: req.method,
        path: req.path,
        query: req.query,
        ip: req.ip
    });
    
    // Log response when finished
    const originalSend = res.send;
    res.send = function(data) {
        req.logger.info('Response sent', {
            statusCode: res.statusCode,
            method: req.method,
            path: req.path
        });
        return originalSend.call(this, data);
    };
    
    next();
};

module.exports = {
    requestContextMiddleware
};
