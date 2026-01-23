const { Product, Category, Shop, UserShop } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { sequelize } = require('../../utils/database/database-setup');
const { Op } = require('sequelize');
const subscriptionService = require('../subscription/subscription.service');
const { createLogger } = require('../../utils/structured-logger');

/**
 * Verify user has access to shop
 */
const verifyShopAccess = async (userId, shopId) => {
    const userShop = await UserShop.findOne({
        where: {
            user_id: userId,
            shop_id: shopId,
            is_active: true
        }
    });

    if (!userShop) {
        throw new AppError('You do not have access to this shop', 403);
    }

    return userShop;
};

/**
 * Create a new product
 * CRITICAL: Tracks usage for billing on successful creation
 */
const createProduct = async (userId, shopId, productData, requestId = null) => {
    const logger = createLogger(requestId, shopId, userId);

    // Verify shop access
    await verifyShopAccess(userId, shopId);

    // Verify category exists if provided
    if (productData.category_id) {
        const category = await Category.findOne({
            where: {
                id: productData.category_id,
                shop_id: shopId
            }
        });

        if (!category) {
            throw new AppError('Category not found', 404);
        }
    }

    const transaction = await sequelize.transaction();
    
    try {
        // Create product within transaction
        const product = await Product.create({
            shop_id: shopId,
            ...productData
        }, { transaction });

        // Commit transaction - NOW product is persisted
        await transaction.commit();

        // ATOMIC: Track usage ONLY after successful DB commit
        // Uses transaction-safe idempotent tracking with request_id
        // Usage increments ONLY on successful database persistence
        try {
            const usageResult = await subscriptionService.trackUsage(
                shopId,
                'products',
                1,
                requestId, // Request-scoped idempotency key - prevents double counting
                {
                    resourceId: product.id,
                    productName: product.name,
                    sku: product.sku
                }
            );
            
            logger.logUsage('product_created', shopId, userId, {
                productId: product.id,
                productName: product.name,
                sku: product.sku,
                transactionId: usageResult.transactionId,
                isRetry: usageResult.isRetry
            });
        } catch (usageError) {
            // CRITICAL errors: usage_limit_exceeded, validation errors
            if (usageError.code === 'USAGE_LIMIT_EXCEEDED') {
                logger.error('Usage limit exceeded on product', usageError, { severity: 'critical' });
                throw usageError;
            }
            
            // Non-critical errors: transient tracking issues don't fail product
            logger.error('Failed to track product usage', usageError, {
                productId: product.id,
                severity: 'warning'
            });
        }

        // Fetch product with category
        return await getProductById(product.id, userId, shopId);
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
};

/**
 * Update a product
 */
const updateProduct = async (productId, userId, shopId, updateData) => {
    // Verify shop access
    await verifyShopAccess(userId, shopId);

    // Find product
    const product = await Product.findOne({
        where: {
            id: productId,
            shop_id: shopId
        }
    });

    if (!product) {
        throw new AppError('Product not found', 404);
    }

    // Verify category exists if being updated
    if (updateData.category_id) {
        const category = await Category.findOne({
            where: {
                id: updateData.category_id,
                shop_id: shopId
            }
        });

        if (!category) {
            throw new AppError('Category not found', 404);
        }
    }

    // Update product
    await product.update(updateData);

    // Fetch updated product with category
    return await getProductById(productId, userId, shopId);
};

/**
 * Delete a product
 */
const deleteProduct = async (productId, userId, shopId) => {
    // Verify shop access
    await verifyShopAccess(userId, shopId);

    // Find product
    const product = await Product.findOne({
        where: {
            id: productId,
            shop_id: shopId
        }
    });

    if (!product) {
        throw new AppError('Product not found', 404);
    }

    // Delete product
    await product.destroy();

    return { message: 'Product deleted successfully' };
};

/**
 * Get a single product by ID
 */
const getProductById = async (productId, userId, shopId) => {
    // Verify shop access
    await verifyShopAccess(userId, shopId);

    const product = await Product.findOne({
        where: {
            id: productId,
            shop_id: shopId
        },
        include: [{
            model: Category,
            as: 'category',
            attributes: ['id', 'name', 'description']
        }]
    });

    if (!product) {
        throw new AppError('Product not found', 404);
    }

    return product;
};

/**
 * List all products for a shop with filters
 */
const listProducts = async (userId, shopId, filters = {}) => {
    // Verify shop access
    await verifyShopAccess(userId, shopId);

    // Build where clause
    const whereClause = {
        shop_id: shopId
    };

    // Add search filter (search in name and description)
    if (filters.search) {
        whereClause[Op.or] = [
            { name: { [Op.iLike]: `%${filters.search}%` } },
            { description: { [Op.iLike]: `%${filters.search}%` } }
        ];
    }

    // Add category filter
    if (filters.category_id) {
        whereClause.category_id = filters.category_id;
    }

    // Add status filter
    if (filters.status) {
        whereClause.is_active = filters.status === 'active';
    }

    // Add price range filter
    if (filters.min_price !== undefined || filters.max_price !== undefined) {
        whereClause.price = {};

        if (filters.min_price !== undefined) {
            whereClause.price[Op.gte] = filters.min_price;
        }

        if (filters.max_price !== undefined) {
            whereClause.price[Op.lte] = filters.max_price;
        }
    }

    // Get all products with filters
    const products = await Product.findAll({
        where: whereClause,
        include: [{
            model: Category,
            as: 'category',
            attributes: ['id', 'name', 'description']
        }],
        order: [
            ['created_at', 'DESC']
        ]
    });

    return products;
};

module.exports = {
    createProduct,
    updateProduct,
    deleteProduct,
    getProductById,
    listProducts,
    verifyShopAccess
};
