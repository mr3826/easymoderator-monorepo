/**
 * Product Upsell Service
 *
 * Recommends complementary products based on co-purchase patterns.
 * Uses co-occurrence frequency in order_items to rank suggestions.
 */

const { Order, OrderItem, Product } = require('../entities');
const { Op, Sequelize } = require('sequelize');
const { AppError } = require('../../utils/AppError');

/**
 * Find products that are frequently co-purchased with the given product.
 *
 * Algorithm:
 *  1. Find all orders that contain `productId`.
 *  2. In those same orders, find all OTHER product_ids.
 *  3. Rank by frequency (count of shared orders).
 *  4. Return top `limit` product records.
 *
 * @param {string} shopId
 * @param {string} productId
 * @param {number} [limit=3]
 * @returns {Promise<object[]>} Array of Product records
 */
const getCopurchasedProducts = async (shopId, productId, limit = 3) => {
    // 1. Find order IDs that contain this product
    const orderItems = await OrderItem.findAll({
        attributes: ['order_id'],
        include: [{
            model: Order,
            as: 'order',
            where: { shop_id: shopId },
            attributes: []
        }],
        where: { product_id: productId }
    });

    if (!orderItems.length) return [];

    const orderIds = orderItems.map(oi => oi.order_id);

    // 2. Find other products in those orders, excluding the query product
    const coItems = await OrderItem.findAll({
        attributes: [
            'product_id',
            [Sequelize.fn('COUNT', Sequelize.col('OrderItem.order_id')), 'co_count']
        ],
        where: {
            order_id: { [Op.in]: orderIds },
            product_id: { [Op.ne]: productId }
        },
        group: ['product_id'],
        order: [[Sequelize.literal('co_count'), 'DESC']],
        limit: limit * 2 // over-fetch in case some products are inactive
    });

    if (!coItems.length) return [];

    const productIds = coItems.map(ci => ci.product_id);

    // 3. Fetch active product details
    const products = await Product.findAll({
        where: {
            id: { [Op.in]: productIds },
            shop_id: shopId,
            is_active: true
        }
    });

    // Preserve co-purchase order
    const productMap = {};
    for (const p of products) productMap[p.id] = p.toJSON();
    const ranked = productIds
        .map(id => productMap[id])
        .filter(Boolean)
        .slice(0, limit);

    return ranked;
};

/**
 * Aggregate co-purchase recommendations for a list of products (e.g. a cart).
 *
 * For each product in `currentProductIds`, gather co-purchased products,
 * exclude products already in the cart, then de-duplicate and re-rank by
 * total score.
 *
 * @param {string} shopId
 * @param {string[]} currentProductIds
 * @param {number} [limit=3]
 * @returns {Promise<object[]>}
 */
const getUpsellRecommendations = async (shopId, currentProductIds, limit = 3) => {
    if (!currentProductIds || currentProductIds.length === 0) return [];

    // Gather order IDs for all cart products
    const orderItems = await OrderItem.findAll({
        attributes: ['order_id'],
        include: [{
            model: Order,
            as: 'order',
            where: { shop_id: shopId },
            attributes: []
        }],
        where: { product_id: { [Op.in]: currentProductIds } }
    });

    if (!orderItems.length) return [];

    const orderIds = [...new Set(orderItems.map(oi => oi.order_id))];

    // Find co-purchased products outside the current cart
    const coItems = await OrderItem.findAll({
        attributes: [
            'product_id',
            [Sequelize.fn('COUNT', Sequelize.col('OrderItem.order_id')), 'co_count']
        ],
        where: {
            order_id: { [Op.in]: orderIds },
            product_id: { [Op.notIn]: currentProductIds }
        },
        group: ['product_id'],
        order: [[Sequelize.literal('co_count'), 'DESC']],
        limit: limit * 2
    });

    if (!coItems.length) return [];

    const productIds = coItems.map(ci => ci.product_id);
    const products = await Product.findAll({
        where: {
            id: { [Op.in]: productIds },
            shop_id: shopId,
            is_active: true
        }
    });

    const productMap = {};
    for (const p of products) productMap[p.id] = p.toJSON();
    return productIds.map(id => productMap[id]).filter(Boolean).slice(0, limit);
};

module.exports = { getCopurchasedProducts, getUpsellRecommendations };
