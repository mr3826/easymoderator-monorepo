const productService = require('./product.service');

/**
 * RESTful: Get products with pagination and filters
 */
const getProducts = async (req, res, next) => {
    try {
        const { userId, shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const options = req.query; // Already validated
        const result = await productService.listProducts(userId, shopId, options);

        res.status(200).json({
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
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { id } = req.params; // Already validated
        const product = await productService.getProductById(id, userId, shopId);

        res.status(200).json({
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
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const product = await productService.createProduct(
            req.user.userId,
            shopId,
            req.body // Already validated
        );

        res.status(201).json({
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
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { id } = req.params; // Already validated
        const product = await productService.updateProduct(
            id,
            req.user.userId,
            shopId,
            req.body // Already validated
        );

        res.status(200).json({
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
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { id } = req.params; // Already validated
        const result = await productService.deleteProduct(
            id,
            req.user.userId,
            shopId
        );

        res.status(200).json({
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
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const result = await productService.extractProductsFromContent(
            userId,
            shopId,
            req.body
        );

        res.status(200).json({
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
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const product = await productService.createProduct(
            req.user.userId,
            shopId,
            req.body // Already validated
        );

        res.status(201).json({
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
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { productId, ...updateData } = req.body;
        const product = await productService.updateProduct(
            productId,
            req.user.userId,
            shopId,
            updateData
        );

        res.status(200).json({
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
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { productId } = req.body;
        const result = await productService.deleteProduct(
            productId,
            req.user.userId,
            shopId
        );

        res.status(200).json({
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
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const result = await productService.searchProducts(
            req.user.userId,
            shopId,
            req.body
        );

        res.status(200).json({
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
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { productId } = req.query;
        const product = await productService.getProductById(
            productId,
            userId,
            shopId
        );

        res.status(200).json({
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
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const options = req.query;
        const result = await productService.listProducts(userId, shopId, options);

        res.status(200).json({
            success: true,
            data: result
        });
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
    // Legacy methods (for backward compatibility)
    createProduct,
    updateProduct,
    deleteProduct,
    getProduct,
    listProducts,
    searchProducts
};
