/**
 * Middleware to require a valid shopId in the request
 * Eliminates duplicate shopId checks across dashboard controllers
 */
const requireShop = (req, res, next) => {
    const { shopId } = req.user;
    if (!shopId) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'No shop selected. Please login again.'
            }
        });
    }
    next();
};

module.exports = { requireShop };
