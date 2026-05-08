const productService = require('./product.service');
const productLinkService = require('./product-link.service');
const upsellService = require('./product-upsell.service');
const { HTTP_STATUS } = require('../../constants/http-status');

/**
 * Helper: Returns a standard validation error response for missing shop
 * @returns {Object} Standard error response object
 */
const getNoShopError = () => ({
    success: false,
    error: {
        code: 'VALIDATION_ERROR',
        message: 'No shop selected. Please login again.'
    }
});

/**
 * Helper: Returns a standard validation error response with custom message
 * @param {string} message - Custom error message
 * @returns {Object} Standard error response object
 */
const getValidationError = (message) => ({
    success: false,
    error: {
        code: 'VALIDATION_ERROR',
        message
    }
});

/**
 * RESTful: Get products with pagination and filters
 */
const getProducts = async (req, res, next) => {
    try {
        const { userId, shopId } = req.user;
        if (!shopId) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(getNoShopError());
        }

        const options = req.query; // Already validated
        const result = await productService.listProducts(userId, shopId, options);

        res.status(HTTP_STATUS.OK).json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * RESTful: Get product by ID
 */
const getProductById = async (req, res, next) => {
    try {
        const { userId, shopId } = req.user;
        if (!shopId) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(getNoShopError());
        }

        const { id } = req.params; // Already validated
        const product = await productService.getProductById(id, userId, shopId);

        res.status(HTTP_STATUS.OK).json({
            success: true,
            data: product
        });
    } catch (error) {
        next(error);
    }
};

/**
 * RESTful: Create product
 */
const createProductRest = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(getNoShopError());
        }

        const product = await productService.createProduct(
            req.user.userId,
            shopId,
            req.body // Already validated
        );

        res.status(HTTP_STATUS.CREATED).json({
            success: true,
            data: product
        });
    } catch (error) {
        next(error);
    }
};

/**
 * RESTful: Update product by ID
 */
const updateProductById = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(getNoShopError());
        }

        const { id } = req.params; // Already validated
        const product = await productService.updateProduct(
            id,
            req.user.userId,
            shopId,
            req.body // Already validated
        );

        res.status(HTTP_STATUS.OK).json({
            success: true,
            data: product
        });
    } catch (error) {
        next(error);
    }
};

/**
 * RESTful: Delete a product by ID
 */
const deleteProductById = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(getNoShopError());
        }

        const { id } = req.params; // Already validated
        const result = await productService.deleteProduct(
            id,
            req.user.userId,
            shopId
        );

        res.status(HTTP_STATUS.OK).json({
            success: true,
            ...result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * AI: Extract products from uploaded content
 */
const extractProducts = async (req, res, next) => {
    try {
        const { userId, shopId } = req.user;
        if (!shopId) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(getNoShopError());
        }

        const result = await productService.extractProductsFromContent(
            userId,
            shopId,
            req.body
        );

        res.status(HTTP_STATUS.OK).json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Legacy: Create a new product (for backward compatibility)
 */
const createProduct = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(getNoShopError());
        }

        const product = await productService.createProduct(
            req.user.userId,
            shopId,
            req.body // Already validated
        );

        res.status(HTTP_STATUS.CREATED).json({
            success: true,
            data: product
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Legacy: Update a product (for backward compatibility)
 */
const updateProduct = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(getNoShopError());
        }

        const { productId, ...updateData } = req.body;
        const product = await productService.updateProduct(
            productId,
            req.user.userId,
            shopId,
            updateData
        );

        res.status(HTTP_STATUS.OK).json({
            success: true,
            data: product
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Legacy: Delete a product (for backward compatibility)
 */
const deleteProduct = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(getNoShopError());
        }

        const { productId } = req.body;
        const result = await productService.deleteProduct(
            productId,
            req.user.userId,
            shopId
        );

        res.status(HTTP_STATUS.OK).json({
            success: true,
            ...result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * V2: Product search
 */
const searchProducts = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(getNoShopError());
        }

        const result = await productService.searchProducts(
            req.user.userId,
            shopId,
            req.body
        );

        res.status(HTTP_STATUS.OK).json({
            products: result,
            total: result.length,
            page: 1
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Legacy: Get a single product (for backward compatibility)
 */
const getProduct = async (req, res, next) => {
    try {
        const { userId, shopId } = req.user;
        if (!shopId) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(getNoShopError());
        }

        const { productId } = req.query;
        const product = await productService.getProductById(
            productId,
            userId,
            shopId
        );

        res.status(HTTP_STATUS.OK).json({
            success: true,
            data: product
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Legacy: List products (for backward compatibility)
 */
const listProducts = async (req, res, next) => {
    try {
        const { userId, shopId } = req.user;
        if (!shopId) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(getNoShopError());
        }

        const options = req.query;
        const result = await productService.listProducts(userId, shopId, options);

        res.status(HTTP_STATUS.OK).json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Detect product mentions in AI response text and return product cards.
 * POST /products/detect-mentions
 * Body: { text, shopId? }
 */
const detectMentions = async (req, res, next) => {
    try {
        const { text, shopId: bodyShopId } = req.body;
        const shopId = bodyShopId || req.user.shopId;

        if (!text) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(getValidationError('text is required'));
        }

        if (!shopId) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(getValidationError('shopId is required'));
        }

        const result = await productLinkService.enrichResponseWithProductCards(text, shopId);

        res.status(HTTP_STATUS.OK).json({
            success: true,
            productCards: result.productCards
        });
    } catch (error) {
        next(error);
    }
};

/**
 * B4: Bulk update products — price, status, is_active.
 * PATCH /products/bulk
 * Body: { productIds: [], updates: { price?, status?, is_active? } }
 */
const bulkUpdateProducts = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(getNoShopError());
        }

        const { productIds, updates } = req.body;
        const result = await productService.bulkUpdateProducts(shopId, productIds, updates || {});

        res.status(HTTP_STATUS.OK).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /products/:productId/upsells
 * Return co-purchase upsell recommendations for a single product.
 */
const getProductUpsells = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(getNoShopError());
        }
        const { productId } = req.params;
        const limit = parseInt(req.query.limit, 10) || 3;
        const data = await upsellService.getCopurchasedProducts(shopId, productId, limit);
        res.status(HTTP_STATUS.OK).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /products/upsells
 * Return upsell recommendations for a set of products (e.g. cart).
 * Body: { productIds: [] }
 */
const getUpsellsForCart = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(getNoShopError());
        }
        const { productIds = [] } = req.body;
        if (!Array.isArray(productIds)) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(getValidationError('productIds must be an array'));
        }
        const limit = parseInt(req.query.limit, 10) || 3;
        const data = await upsellService.getUpsellRecommendations(shopId, productIds, limit);
        res.status(HTTP_STATUS.OK).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    // RESTful methods
    getProducts,
    getProductById,
    createProductRest,
    updateProductById,
    deleteProductById,
    extractProducts,
    detectMentions,
    bulkUpdateProducts,
    getProductUpsells,
    getUpsellsForCart,
    // Legacy methods (for backward compatibility)
    createProduct,
    updateProduct,
    deleteProduct,
    getProduct,
    listProducts,
    searchProducts
};
