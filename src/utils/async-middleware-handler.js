/**
 * Async Middleware Error Handler
 * 
 * Higher-order function that wraps async middleware to catch exceptions
 * and convert them to AppError objects for consistent error handling.
 * 
 * This eliminates the need for try-catch blocks in every middleware function
 * and ensures errors are always passed through next() consistently.
 * 
 * @module utils/async-middleware-handler
 * @example
 * const asyncHandler = require('./async-middleware-handler');
 * 
 * const authenticate = asyncHandler(async (req, res, next) => {
 *   const token = req.headers.authorization;
 *   if (!token) throw new AppError('No token', 401);
 *   const decoded = verifyToken(token);
 *   req.user = decoded;
 *   next();
 * });
 */

const { AppError } = require('./AppError');

/**
 * Wraps async middleware function to handle errors automatically
 * 
 * @param {Function} middlewareFn - Async middleware function
 * @returns {Function} Wrapped middleware with error handling
 * 
 * @throws {AppError} Errors are caught and converted to AppError
 * @throws {Error} Non-AppError exceptions are wrapped in AppError
 */
function asyncHandler(middlewareFn) {
  return async (req, res, next) => {
    try {
      await middlewareFn(req, res, next);
    } catch (error) {
      // If already an AppError, pass through unchanged
      if (error instanceof AppError) {
        return next(error);
      }

      // Wrap other errors in AppError
      const appError = new AppError(
        error.message || 'Middleware processing failed',
        error.status || 500,
        error.code || 'MIDDLEWARE_ERROR',
        { originalError: error.name }
      );

      return next(appError);
    }
  };
}

module.exports = asyncHandler;
