'use strict';

const crypto = require('crypto');
const asyncHandler = require('../../utils/async-middleware-handler');
const { AppError, sendSuccess } = require('../../utils/AppError');
const { Op } = require('sequelize');

let AuditLog = null;
let Product = null;
let Category = null;
try {
    const entities = require('../entities');
    AuditLog = entities.AuditLog;
    Product = entities.Product;
    Category = entities.Category;
} catch (_) {}

const MAX_PAGE_SIZE = 50;

function positiveInteger(value, fallback, maximum) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, maximum);
}

function productIdFrom(req) {
    const productId = String(req.params.productId || '').trim();
    if (!productId || productId.length > 100) {
        throw new AppError('Product ID is required', 400, 'VALIDATION_ERROR');
    }
    return productId;
}

function computeStockStatus(product) {
    if (!product.in_stock || (product.quantity !== null && product.quantity <= 0)) {
        return 'out_of_stock';
    }
    const threshold = product.low_stock_threshold || 5;
    if (product.quantity !== null && product.quantity <= threshold) {
        return 'low_stock';
    }
    return 'in_stock';
}

function formatProduct(product) {
    const raw = product.toJSON ? product.toJSON() : product;
    return {
        id: raw.id,
        name: raw.name || '',
        name_bn: raw.name_bn || null,
        sku: raw.sku || null,
        category: raw.category || raw.category_ref?.name || null,
        price: Number(raw.price) || 0,
        compare_at_price: raw.compare_at_price ? Number(raw.compare_at_price) : null,
        quantity: raw.quantity !== undefined && raw.quantity !== null ? Number(raw.quantity) : 0,
        low_stock_threshold: raw.low_stock_threshold !== undefined && raw.low_stock_threshold !== null ? Number(raw.low_stock_threshold) : 5,
        track_quantity: Boolean(raw.track_quantity),
        in_stock: Boolean(raw.in_stock),
        stock_status: computeStockStatus(raw),
        image_url: raw.image_url || null,
        images: Array.isArray(raw.images) ? raw.images : [],
        description: raw.description || null,
        is_active: Boolean(raw.is_active),
        created_at: raw.createdAt || raw.created_at || null,
        updated_at: raw.updatedAt || raw.updated_at || null,
    };
}

/**
 * GET /api/mobile/products
 * Returns paginated product list with search and stock status filtering.
 */
const getProducts = asyncHandler(async (req, res) => {
    const shopId = req.shop.id;
    const page = positiveInteger(req.query.page, 1, 1000);
    const limit = positiveInteger(req.query.limit, 20, MAX_PAGE_SIZE);
    const offset = (page - 1) * limit;

    const whereClause = {
        shop_id: shopId,
    };

    const search = String(req.query.search || '').trim().slice(0, 100);
    if (search) {
        whereClause[Op.or] = [
            { name: { [Op.like]: `%${search}%` } },
            { sku: { [Op.like]: `%${search}%` } },
            { description: { [Op.like]: `%${search}%` } },
        ];
    }

    const stockStatus = String(req.query.stock_status || req.query.stockStatus || 'all').toLowerCase();
    if (stockStatus === 'out_of_stock') {
        whereClause[Op.or] = [
            { quantity: { [Op.lte]: 0 } },
            { in_stock: false },
        ];
    } else if (stockStatus === 'low_stock') {
        whereClause.in_stock = true;
        whereClause.quantity = {
            [Op.gt]: 0,
            [Op.lte]: 5,
        };
    } else if (stockStatus === 'in_stock') {
        whereClause.in_stock = true;
        whereClause.quantity = {
            [Op.gt]: 5,
        };
    }

    const categoryId = req.query.category_id || req.query.categoryId;
    if (categoryId) {
        whereClause.category_id = categoryId;
    }

    const include = [];
    if (Category) {
        include.push({
            model: Category,
            as: 'category_ref',
            attributes: ['id', 'name'],
            required: false,
        });
    }

    const { count, rows } = await Product.findAndCountAll({
        where: whereClause,
        include,
        limit,
        offset,
        order: [['updated_at', 'DESC'], ['created_at', 'DESC']],
    });

    const products = rows.map(formatProduct);

    sendSuccess(res, {
        products,
        pagination: {
            page,
            limit,
            total_items: count,
            total_pages: Math.ceil(count / limit) || 1,
        },
    });
});

/**
 * PATCH /api/mobile/products/:productId/quick-update
 * Instant stock and price quick update for mobile merchants.
 */
const quickUpdateStock = asyncHandler(async (req, res) => {
    const productId = productIdFrom(req);
    const shopId = req.shop.id;
    const userId = req.user.userId || req.user.id;

    const product = await Product.findOne({
        where: {
            id: productId,
            shop_id: shopId,
        },
    });

    if (!product) {
        throw new AppError('Product not found', 404, 'NOT_FOUND');
    }

    const { stockDelta, newStock, newPrice, inStock } = req.body || {};

    const previousQuantity = product.quantity !== undefined && product.quantity !== null ? Number(product.quantity) : 0;
    const previousPrice = Number(product.price) || 0;
    const previousInStock = Boolean(product.in_stock);

    let nextQuantity = previousQuantity;
    if (newStock !== undefined && newStock !== null) {
        const parsedStock = Number.parseInt(String(newStock), 10);
        if (!Number.isInteger(parsedStock) || parsedStock < 0) {
            throw new AppError('Stock quantity must be a non-negative integer', 400, 'VALIDATION_ERROR');
        }
        nextQuantity = parsedStock;
    } else if (stockDelta !== undefined && stockDelta !== null) {
        const parsedDelta = Number.parseInt(String(stockDelta), 10);
        if (!Number.isInteger(parsedDelta)) {
            throw new AppError('Stock delta must be an integer', 400, 'VALIDATION_ERROR');
        }
        nextQuantity = Math.max(0, previousQuantity + parsedDelta);
    }

    let nextPrice = previousPrice;
    if (newPrice !== undefined && newPrice !== null) {
        const parsedPrice = Number.parseFloat(String(newPrice));
        if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
            throw new AppError('Price must be a positive number', 400, 'VALIDATION_ERROR');
        }
        nextPrice = parsedPrice;
    }

    let nextInStock = nextQuantity > 0;
    if (inStock !== undefined && inStock !== null) {
        nextInStock = Boolean(inStock);
    }
    if (nextQuantity === 0) {
        nextInStock = false;
    }

    const updateFields = {
        quantity: nextQuantity,
        in_stock: nextInStock,
        price: nextPrice,
    };

    await product.update(updateFields);

    if (AuditLog && typeof AuditLog.create === 'function') {
        const auditHash = crypto.createHash('sha256')
            .update(['PRODUCT_STOCK_UPDATED', shopId, productId, userId, Date.now()].join('|'))
            .digest('hex');
        await AuditLog.create({
            user_id: userId,
            shop_id: shopId,
            action: 'PRODUCT_STOCK_UPDATED',
            resource_type: 'product',
            resource_id: productId,
            idempotency_key: auditHash,
            metadata: {
                source: 'MOBILE',
                previous_quantity: previousQuantity,
                next_quantity: nextQuantity,
                previous_price: previousPrice,
                next_price: nextPrice,
                previous_in_stock: previousInStock,
                next_in_stock: nextInStock,
                stock_delta: stockDelta ?? (nextQuantity - previousQuantity),
            },
        }).catch((err) => console.warn('Mobile product stock update audit log failed:', err.message));
    }

    sendSuccess(res, formatProduct(product));
});

/**
 * POST /api/mobile/products/photo-draft
 * Creates a product draft from photo or quick input.
 * CRITICAL: Always created as draft (is_active: false), NEVER auto-published.
 */
const createPhotoDraft = asyncHandler(async (req, res) => {
    const shopId = req.shop.id;
    const userId = req.user.userId || req.user.id;

    const { name, price, quantity = 0, description, category, sku, image_url, images } = req.body || {};

    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
        throw new AppError('Product name is required', 400, 'VALIDATION_ERROR');
    }

    const parsedPrice = Number.parseFloat(String(price));
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        throw new AppError('Valid price is required', 400, 'VALIDATION_ERROR');
    }

    const parsedQuantity = Math.max(0, Number.parseInt(String(quantity || 0), 10) || 0);

    const draftProduct = await Product.create({
        shop_id: shopId,
        name: trimmedName,
        price: parsedPrice,
        quantity: parsedQuantity,
        description: description ? String(description).trim() : null,
        category: category ? String(category).trim() : null,
        sku: sku ? String(sku).trim() : null,
        image_url: image_url || (Array.isArray(images) && images.length > 0 ? images[0] : null),
        images: Array.isArray(images) ? images : (image_url ? [image_url] : []),
        track_quantity: true,
        in_stock: parsedQuantity > 0,
        is_active: false, // CRITICAL: NEVER auto-publish, always draft
    });

    if (AuditLog && typeof AuditLog.create === 'function') {
        const auditHash = crypto.createHash('sha256')
            .update(['PRODUCT_DRAFT_CREATED', shopId, draftProduct.id, userId, Date.now()].join('|'))
            .digest('hex');
        await AuditLog.create({
            user_id: userId,
            shop_id: shopId,
            action: 'PRODUCT_DRAFT_CREATED',
            resource_type: 'product',
            resource_id: draftProduct.id,
            idempotency_key: auditHash,
            metadata: {
                source: 'MOBILE',
                name: trimmedName,
                price: parsedPrice,
                quantity: parsedQuantity,
                is_active: false,
            },
        }).catch((err) => console.warn('Mobile photo draft audit log failed:', err.message));
    }

    sendSuccess(res, formatProduct(draftProduct));
});

module.exports = {
    getProducts,
    quickUpdateStock,
    createPhotoDraft,
    computeStockStatus,
    formatProduct,
};
