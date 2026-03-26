class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Sanitize error messages to remove sensitive information
 * @param {string} message - Original error message
 * @returns {string} Sanitized message
 */
const sanitizeErrorMessage = (message) => {
    if (!message) return 'An error occurred';
    
    // Remove passwords, API keys, tokens, etc. - remove the entire key=value or key: value
    let sanitized = String(message)
        .replace(/password\s*=\s*[^\s,;)]+/gi, '[REDACTED]')
        .replace(/api[_-]?key\s*[=:]\s*[^\s,;)]+/gi, '[REDACTED]')
        .replace(/token\s*[=:]\s*[^\s,;)]+/gi, '[REDACTED]')
        .replace(/authorization\s*[=:]\s*[^\s,;)]+/gi, '[REDACTED]')
        .replace(/bearer\s+[^\s,;)]+/gi, '[REDACTED]')
        .replace(/secret\s*[=:]\s*[^\s,;)]+/gi, '[REDACTED]')
        .replace(/key\s*[=:]\s*[^\s,;)]+/gi, '[REDACTED]')
        // Also remove standalone passwords/keys/tokens
        .replace(/(\bpassword\b.*?[:=].*?)[\s,;)]/gi, '[REDACTED] ')
        .replace(/\bpassword\b/gi, '[REDACTED]')
        .replace(/\bsecret\b/gi, '[REDACTED]');
    
    return sanitized;
};

const globalErrorHandler = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    const requestId = req.requestId || req.headers['x-request-id'] || res.getHeader('X-Request-ID') || null;
    const path = req.originalUrl;
    const method = req.method;

    if (req.logger) {
        req.logger.error('Unhandled error', err, {
            method,
            path,
            statusCode: err.statusCode,
            requestId
        });
    } else {
        console.error('Unhandled error:', {
            method,
            path,
            statusCode: err.statusCode,
            message: err.message,
            requestId,
            stack: err.stack
        });
    }

    // Standardized error response with success: false and sanitized message
    res.status(err.statusCode).json({
        success: false,
        message: sanitizeErrorMessage(err.message),
        code: err.statusCode.toString(),
        requestId,
        path,
        method
    });
};

module.exports = {
    AppError,
    globalErrorHandler,
};
