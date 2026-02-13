const { Product, Category, Shop, UserShop } = require('../entities');
const crypto = require('crypto');
const { AppError } = require('../../utils/AppError');
const { sequelize } = require('../../utils/database/database-setup');
const { Op } = require('sequelize');
const subscriptionService = require('../subscription/subscription.service');
const { createLogger } = require('../../utils/structured-logger');

const MAX_EXTRACT_ROWS = 200;
const HEADER_ALIASES = {
    name: ['name', 'product', 'product_name', 'title', 'product_title'],
    sku: ['sku', 'code', 'product_code', 'item_code'],
    price: ['price', 'unit_price', 'selling_price', 'sale_price'],
    category: ['category', 'category_name'],
    description: ['description', 'desc', 'details'],
    tags: ['tags', 'keywords'],
    variants: ['variants', 'options'],
    quantity: ['quantity', 'qty', 'stock'],
    brand: ['brand'],
    weight: ['weight'],
    weight_unit: ['weight_unit', 'weight unit', 'unit']
};

const normalizeHeader = (value) => value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const mapHeaderToField = (header) => {
    const normalized = normalizeHeader(header);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
        if (aliases.some(alias => normalizeHeader(alias) === normalized)) {
            return field;
        }
    }
    return null;
};

const parseDelimitedLine = (line, delimiter) => {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === delimiter && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    result.push(current.trim());
    return result;
};

const parseDelimited = (content, delimiter = ',') => {
    const lines = content
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    if (lines.length === 0) {
        return { headers: [], rows: [] };
    }

    const rawHeaders = parseDelimitedLine(lines[0], delimiter);
    const headers = rawHeaders.map(mapHeaderToField);
    const rows = lines.slice(1).map(line => parseDelimitedLine(line, delimiter));

    return { headers, rows };
};

const parseTags = (value) => {
    if (!value) return [];
    return value
        .split(/[,;|]/)
        .map(tag => tag.trim())
        .filter(Boolean);
};

const parseVariants = (value) => {
    if (!value) return [];
    return value
        .split(/[,;|]/)
        .map(variant => variant.trim())
        .filter(Boolean);
};

const parsePrice = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const normalized = String(value).replace(/[^0-9.]/g, '');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
};

const calculateConfidence = (product) => {
    let score = 0.4;
    if (product.name) score += 0.2;
    if (product.price && product.price > 0) score += 0.2;
    if (product.sku) score += 0.1;
    if (product.category) score += 0.1;
    return Math.min(score, 0.99);
};

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

    // Handle track_quantity: if not tracking, clear quantity
    if (productData.track_quantity === false) {
        productData.quantity = 0;
    }

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
        try { await transaction.rollback(); } catch (_) { /* already committed */ }
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

    // Handle track_quantity: if not tracking, clear quantity
    if (updateData.track_quantity === false) {
        updateData.quantity = 0;
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
        }
    });

    if (!product) {
        throw new AppError('Product not found', 404);
    }

    // Transform to match API response format - category should be just the ID (string)
    const productData = product.toJSON ? product.toJSON() : product;
    
    return productData;
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

    // Add search filter (search in name, description, and SKU)
    if (filters.search) {
        whereClause[Op.or] = [
            { name: { [Op.like]: `%${filters.search}%` } },
            { description: { [Op.like]: `%${filters.search}%` } },
            { sku: { [Op.like]: `%${filters.search}%` } }
        ];
    }

    // Add category filter
    if (filters.category_id) {
        whereClause.category_id = filters.category_id;
    }

    // Add status filter
    if (filters.is_active !== undefined) {
        whereClause.is_active = filters.is_active;
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
        include: [
            {
                model: Category,
                as: 'category_ref',
                attributes: ['id', 'name']
            }
        ],
        order: [
            ['created_at', 'DESC']
        ]
    });

    // Map products to include category name and status string
    const mappedProducts = products.map(product => {
        const productData = product.toJSON();
        return {
            ...productData,
            category: productData.category_ref?.name || null,
            status: productData.is_active ? 'active' : 'inactive'
        };
    });

    return mappedProducts;
};

/**
 * V2: Search products with filters
 */
const searchProducts = async (userId, shopId, payload = {}) => {
    await verifyShopAccess(userId, shopId);

    const whereClause = {
        shop_id: shopId
    };

    if (payload.query) {
        whereClause[Op.or] = [
            { name: { [Op.iLike]: `%${payload.query}%` } },
            { description: { [Op.iLike]: `%${payload.query}%` } },
            { category: { [Op.iLike]: `%${payload.query}%` } }
        ];
    }

    if (payload.filters) {
        const { category, min_price, max_price, in_stock } = payload.filters;
        if (category) {
            whereClause.category = category;
        }
        if (in_stock !== undefined) {
            whereClause.in_stock = in_stock;
        }
        if (min_price !== undefined || max_price !== undefined) {
            whereClause.price = {};
            if (min_price !== undefined) {
                whereClause.price[Op.gte] = min_price;
            }
            if (max_price !== undefined) {
                whereClause.price[Op.lte] = max_price;
            }
        }
    }

    const limit = Number(payload.limit || 10);

    const products = await Product.findAll({
        where: whereClause,
        order: [['created_at', 'DESC']],
        limit
    });

    return products;
};

/**
 * Extract products from uploaded content without persisting
 */
const extractProductsFromContent = async (userId, shopId, payload) => {
    await verifyShopAccess(userId, shopId);

    const { content, filename = '', content_type = '' } = payload;
    const lowerName = filename.toLowerCase();
    const isCsv = lowerName.endsWith('.csv') || content_type === 'text/csv';
    const isTsv = lowerName.endsWith('.tsv') || content_type === 'text/tab-separated-values';
    const delimiter = isTsv ? '\t' : ',';

    if (!isCsv && !isTsv && !content) {
        throw new AppError('Unsupported or empty content for extraction.', 400);
    }

    const { headers, rows } = parseDelimited(content, delimiter);
    if (headers.length === 0 || rows.length === 0) {
        throw new AppError('No tabular data found in the uploaded file.', 400);
    }

    const products = [];
    let skipped = 0;
    const limitedRows = rows.slice(0, MAX_EXTRACT_ROWS);

    for (const row of limitedRows) {
        const product = {
            id: crypto.randomUUID(),
            name: null,
            sku: null,
            price: null,
            category: null,
            description: null,
            tags: [],
            variants: [],
            quantity: null,
            brand: null,
            weight: null,
            weight_unit: null
        };

        headers.forEach((field, index) => {
            if (!field) return;
            const value = row[index];
            if (value === undefined || value === null || value === '') return;

            switch (field) {
                case 'tags':
                    product.tags = parseTags(value);
                    break;
                case 'variants':
                    product.variants = parseVariants(value);
                    break;
                case 'price':
                    product.price = parsePrice(value);
                    break;
                case 'quantity':
                    product.quantity = Number.parseInt(String(value), 10);
                    break;
                case 'weight':
                    product.weight = parsePrice(value);
                    break;
                case 'weight_unit':
                    product.weight_unit = String(value).trim().toLowerCase();
                    break;
                default:
                    product[field] = String(value).trim();
                    break;
            }
        });

        if (!product.name) {
            skipped += 1;
            continue;
        }

        const confidence = calculateConfidence(product);
        products.push({
            ...product,
            status: 'pending',
            ai_generated: true,
            confidence,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });
    }

    return {
        products,
        stats: {
            total: rows.length,
            parsed: products.length,
            skipped
        }
    };
};

module.exports = {
    createProduct,
    updateProduct,
    deleteProduct,
    getProductById,
    listProducts,
    searchProducts,
    verifyShopAccess,
    extractProductsFromContent
};
