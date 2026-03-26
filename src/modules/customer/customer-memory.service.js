const CustomerPreference = require('./customer-preference.entity');
const { AppError } = require('../../utils/AppError');

/**
 * Get stored preferences/memory for a customer within a shop.
 *
 * @param {string} shopId
 * @param {string} customerId
 * @returns {Promise<CustomerPreference|null>}
 */
const getCustomerMemory = async (shopId, customerId) => {
    const prefs = await CustomerPreference.findOne({
        where: { shop_id: shopId, customer_id: customerId }
    });
    return prefs;
};

/**
 * Update customer memory from a completed order.
 * Increments total_orders and total_spent, updates last_ordered_at,
 * and infers preferred_payment from the order's payment_method.
 *
 * @param {string} shopId
 * @param {string} customerId
 * @param {object} order - Order object with payment_method, total_amount fields
 * @returns {Promise<CustomerPreference>}
 */
const updateFromOrder = async (shopId, customerId, order) => {
    let prefs = await CustomerPreference.findOne({
        where: { shop_id: shopId, customer_id: customerId }
    });

    const orderAmount = parseFloat(order.total_amount || order.total || 0);
    const paymentMethod = order.payment_method || null;

    // Normalise payment method to enum values
    const paymentMap = {
        cod: 'COD',
        cash_on_delivery: 'COD',
        bkash: 'bKash',
        nagad: 'Nagad',
        online: 'online',
        card: 'online',
        bank: 'online'
    };
    const normalisedPayment = paymentMethod
        ? (paymentMap[paymentMethod.toLowerCase()] || null)
        : null;

    if (prefs) {
        const updates = {
            total_orders: (prefs.total_orders || 0) + 1,
            total_spent: parseFloat(prefs.total_spent || 0) + orderAmount,
            last_ordered_at: new Date()
        };
        if (normalisedPayment) updates.preferred_payment = normalisedPayment;
        if (order.delivery_zone) updates.delivery_zone = order.delivery_zone;
        await prefs.update(updates);
    } else {
        prefs = await CustomerPreference.create({
            shop_id: shopId,
            customer_id: customerId,
            total_orders: 1,
            total_spent: orderAmount,
            last_ordered_at: new Date(),
            preferred_payment: normalisedPayment || null,
            delivery_zone: order.delivery_zone || null
        });
    }

    return prefs;
};

/**
 * Build a human-readable personalisation context string for use in AI prompts.
 *
 * @param {string} shopId
 * @param {string} customerId
 * @returns {Promise<string>} Context string, e.g. "Repeat customer. Prefers COD. 3 previous orders."
 */
const getPersonalizationContext = async (shopId, customerId) => {
    const prefs = await getCustomerMemory(shopId, customerId);
    if (!prefs) return 'New customer. No previous order history.';

    const parts = [];

    if (prefs.total_orders > 0) {
        parts.push(prefs.total_orders === 1 ? '1 previous order.' : `${prefs.total_orders} previous orders.`);
        parts.push(prefs.total_orders > 1 ? 'Repeat customer.' : 'First-time buyer.');
    }

    if (prefs.preferred_payment) {
        parts.push(`Prefers ${prefs.preferred_payment}.`);
    }

    if (prefs.preferred_size) {
        parts.push(`Usual size: ${prefs.preferred_size}.`);
    }

    if (prefs.delivery_zone) {
        parts.push(`Delivery zone: ${prefs.delivery_zone}.`);
    }

    if (prefs.total_spent > 0) {
        parts.push(`Total spent: ৳${parseFloat(prefs.total_spent).toFixed(0)}.`);
    }

    if (prefs.notes) {
        parts.push(prefs.notes);
    }

    return parts.join(' ');
};

module.exports = {
    getCustomerMemory,
    updateFromOrder,
    getPersonalizationContext
};
