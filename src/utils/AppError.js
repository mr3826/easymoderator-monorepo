class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

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

    res.status(err.statusCode).json({
        success: false,
        data: null,
        error: {
            code: err.statusCode.toString(),
            message: err.message,
            requestId,
            path,
            method
        }
    });
};

module.exports = {
    AppError,
    globalErrorHandler,
};
