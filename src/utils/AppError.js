const { createLogger } = require('./structured-logger');
const logger = createLogger('AppError');

const SENSITIVE_PATTERNS = [
  /postgresql:\/\/[^\s]+/gi, /mysql:\/\/[^\s]+/gi, /mongodb:\/\/[^\s]+/gi,
  /api[_-]?key[\s:='"]*[\w\-./=]+/gi, /(bearer|token)[\s:='"]*[\w\-./=]+/gi,
  /AKIA[0-9A-Z]{16}/g, /sk_[a-z0-9]{24,}/gi, /pk_[a-z0-9]{24,}/gi,
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[\w\-/.=+]+/g,
  /\+?[0-9]{1,3}[\s.-]?[0-9]{3}[\s.-]?[0-9]{3}[\s.-]?[0-9]{4}/g,
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g
];

const sanitizeErrorMessage = (message) => {
  if (!message || typeof message !== 'string') return 'An error occurred';
  let sanitized = message;
  SENSITIVE_PATTERNS.forEach(p => { if (p.test(sanitized)) sanitized = sanitized.replace(p, '[REDACTED]'); });
  sanitized = sanitized.replace(/shop_[a-zA-Z0-9]{10,}/gi, '[SHOP_ID]')
    .replace(/user_[a-zA-Z0-9]{10,}/gi, '[USER_ID]')
    .replace(/integration_[a-zA-Z0-9]{10,}/gi, '[INTEGRATION_ID]')
    .replace(/txn_[a-zA-Z0-9]{10,}/gi, '[TXN_ID]')
    .replace(/\/(?:home|var|opt|srv|usr)\/.+/gi, '[FILE_PATH]');
  if (sanitized.length > 1000) sanitized = sanitized.substring(0, 1000) + '...[truncated]';
  return sanitized;
};

class AppError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR', details = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(requestId = 'unknown') {
    return {
      success: false,
      message: sanitizeErrorMessage(this.message),
      code: this.code,
      requestId,
      timestamp: this.timestamp
    };
  }

  getFullContext() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      code: this.code,
      details: this.details,
      stack: this.stack,
      timestamp: this.timestamp
    };
  }
}

// Map a Sequelize ValidationError / UniqueConstraintError to an AppError that
// carries the *actual* offending field(s) instead of the generic
// "Validation error" parent message. Without this the global handler buried
// the err.errors[] array and returned an opaque 500, making field-level
// constraint failures hours of log-diving to diagnose (see migration 018).
function tryMapSequelizeError(err) {
  if (!err || err.name !== 'SequelizeValidationError' && err.name !== 'SequelizeUniqueConstraintError') return null;
  const items = Array.isArray(err.errors) ? err.errors : [];
  const fieldSummary = items
    .map(e => e.path ? `${e.path}: ${e.message}` : e.message)
    .filter(Boolean)
    .join('; ') || err.message || 'Validation failed';
  const status = err.name === 'SequelizeUniqueConstraintError' ? 409 : 400;
  const code = err.name === 'SequelizeUniqueConstraintError' ? 'UNIQUE_VIOLATION' : 'VALIDATION_ERROR';
  return new AppError(fieldSummary, status, code, {
    originalError: err.name,
    fields: items.map(e => ({ path: e.path, message: e.message, validatorKey: e.validatorKey })),
  });
}

const globalErrorHandler = (err, req, res, next) => {
  const requestId = req.requestId || req.headers['x-request-id'] || 'unknown';
  let appError = err;
  if (!(err instanceof AppError)) {
    appError = tryMapSequelizeError(err)
      || new AppError(err.message || 'Internal Server Error', err.status || 500, 'INTERNAL_ERROR', { originalError: err.name });
  }
  const statusCode = appError.status || 500;
  const logContext = { ...appError.getFullContext(), requestId, method: req.method, url: req.originalUrl, clientIp: req.ip };
  if (statusCode >= 500) logger.error('Server error', logContext);
  else logger.warn('Client error', logContext);
  const response = appError.toJSON(requestId);
  res.status(statusCode).json(response);
};

const sendSuccess = (res, data, status = 200, message = 'Success') => {
  const requestId = res.req?.requestId || res.req?.headers?.['x-request-id'] || 'unknown';
  res.status(status).json({ success: true, data, message, requestId, timestamp: new Date().toISOString() });
};

module.exports = { AppError, globalErrorHandler, sendSuccess, sanitizeErrorMessage };
