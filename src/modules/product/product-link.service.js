const { Product } = require('../entities');
const { Op } = require('sequelize');
const { AppError } = require('../../utils/AppError');

/**
 * Find products mentioned by name in the given text for a specific shop.
 * Uses case-insensitive LIKE matching against Product.name.
 * Returns an array of matching Product instances.
 */
const findProductMentions = async (text, shopId) => {
    if (!text || !shopId) return [];

    // Split text into tokens (words and short phrases) to search against product names.
    // We query all active products for the shop and check name presence in text to avoid
    // N+1 queries — one DB call, filter in JS.
    const products = await Product.findAll({
        where: { shop_id: shopId, is_active: true },
        attributes: ['id', 'name', 'price', 'image_url'],
        order: [['name', 'ASC']]
    });

    const lowerText = text.toLowerCase();
    const matched = products.filter(product => {
        const lowerName = product.name.toLowerCase();
        return lowerText.includes(lowerName);
    });

    return matched;
};

/**
 * Build a product card object from a Product instance.
 */
const buildProductCard = (product) => {
    const data = product.toJSON ? product.toJSON() : product;
    return {
        productId: data.id,
        name: data.name,
        price: data.price,
        imageUrl: data.image_url || null,
        linkText: 'পণ্য দেখুন'
    };
};

/**
 * Enriches an AI response text with product cards for any mentioned products.
 * Returns { text: responseText, productCards: [ { ...card } ] }
 */
const enrichResponseWithProductCards = async (responseText, shopId) => {
    const mentions = await findProductMentions(responseText, shopId);
    const productCards = mentions.map(buildProductCard);
    return {
        text: responseText,
        productCards
    };
};

module.exports = {
    findProductMentions,
    buildProductCard,
    enrichResponseWithProductCards
};
