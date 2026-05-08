const { createLogger } = require('../utils/structured-logger');
const logger = createLogger('ResponseStandardizationMiddleware');

const isStandardized = (data) => {
  if (typeof data !== 'object' || data === null) return false;
  return data.hasOwnProperty('success') && data.hasOwnProperty('message') && data.hasOwnProperty('requestId') && data.hasOwnProperty('timestamp');
};

const responseStandardization = () => {
  return (req, res, next) => {
    const requestId = req.requestId || req.headers['x-request-id'] || 'unknown';
    const timestamp = new Date().toISOString();
    const originalJson = res.json.bind(res);
    res.json = function(data) {
      if (isStandardized(data)) return originalJson(data);
      const statusCode = res.statusCode || 200;
      const isSuccess = statusCode >= 200 && statusCode < 400;
      if (isSuccess) {
        const isArray = Array.isArray(data);
        const responseData = isArray ? data : (data && typeof data === 'object' ? data : { result: data });
        const standardized = { success: true, data: responseData, message: data?.message || 'Success', requestId, timestamp };
        return originalJson(standardized);
      }
      return originalJson(data);
    };
    next();
  }
};

const requestTracking = (idGenerator = null) => {
  const { v4: uuid } = require('uuid');
  const generator = idGenerator || (() => eq_);
  return (req, res, next) => {
    req.requestId = req.headers['x-request-id'] || generator();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  };
};

const responseTimeTracking = () => {
  return (req, res, next) => {
    const startTime = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      logger.debug('Request completed', { requestId: req.requestId, method: req.method, path: req.path, statusCode: res.statusCode, duration_ms: duration });
    });
    next();
  };
};

module.exports = { responseStandardization, requestTracking, responseTimeTracking, isStandardized };
