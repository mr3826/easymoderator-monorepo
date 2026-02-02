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

    console.error('Unhandled error:', {
        method: req.method,
        path: req.originalUrl,
        statusCode: err.statusCode,
        message: err.message,
        stack: err.stack
    });

    res.status(err.statusCode).json({
        success: false,
        data: null,
        error: {
            code: err.statusCode.toString(),
            message: err.message
        }
    });
};

module.exports = {
    AppError,
    globalErrorHandler,
};
