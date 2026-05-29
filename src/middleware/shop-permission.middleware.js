const { AppError } = require('../utils/AppError');

/**
 * Require owner role
 */
const requireOwner = (req, res, next) => {
    if (req.userRole !== 'owner') {
        return next(new AppError('Only shop owners can perform this action', 403));
    }
    next();
};

/**
 * Require owner or admin role
 */
const requireOwnerOrAdmin = (req, res, next) => {
    if (req.userRole !== 'owner' && req.userRole !== 'admin') {
        return next(new AppError('Only shop owners or admins can perform this action', 403));
    }
    next();
};

/**
 * Require any role (owner, admin, or staff)
 */
const requireAnyRole = (req, res, next) => {
    if (!req.userRole) {
        return next(new AppError('User role not found', 403));
    }
    next();
};

module.exports = {
    requireOwner,
    requireOwnerOrAdmin,
    requireAnyRole
};
