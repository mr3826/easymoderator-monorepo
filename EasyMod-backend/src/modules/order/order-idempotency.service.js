'use strict';

/**
 * Single read definition for an already-committed order idempotency key.
 * Kept outside order.service so Action Gate can perform the same read without
 * importing a mutation service.
 */
const findOrderByIdempotencyKey = async (shopId, idempotencyKey) => {
    if (!shopId || !idempotencyKey) return null;
    try {
        const { Order } = require('../entities');
        if (Order && typeof Order.findOne === 'function') {
            return Order.findOne({ where: { shop_id: shopId, idempotency_key: idempotencyKey } });
        }
    } catch (_) {
        // Some isolated unit seams intentionally do not load the entity graph.
    }
    try {
        const Order = require('./order.entity');
        if (Order && typeof Order.findOne === 'function') {
            return Order.findOne({ where: { shop_id: shopId, idempotency_key: idempotencyKey } });
        }
    } catch (_) {
        // An unavailable read model is not a committed order; the Action Gate
        // still fails closed on its other required context checks.
    }
    return null;
};

module.exports = { findOrderByIdempotencyKey };
