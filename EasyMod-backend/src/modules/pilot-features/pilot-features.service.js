'use strict';

const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');
const metrics = require('./pilot-metrics');

const logger = createLogger('PilotFeatures');

const ORDER_CONFIDENCE_MODES = Object.freeze(['off', 'shadow', 'enforce']);

// Merchant-facing thresholds are platform-configured during the pilot so a
// shop member cannot weaken the gate by editing shop settings.
const DEFAULT_ORDER_CONFIDENCE_CONFIG = Object.freeze({
    high_value_cod_threshold: 10000,
    address_min_length: 15,
});

const CONFIG_LIMITS = Object.freeze({
    high_value_cod_threshold: [0, 1000000],
    address_min_length: [0, 100],
});

const OFF = Object.freeze({
    customerIntelligence: false,
    orderConfidenceMode: 'off',
    orderConfidenceConfig: { ...DEFAULT_ORDER_CONFIDENCE_CONFIG },
});

const getModel = () => {
    try {
        return require('../entities').ShopPilotFeatures || null;
    } catch (_) {
        // Narrow unit fixtures replace the entity registry; no model = no pilot.
        return null;
    }
};

function sanitizeConfig(config = {}) {
    const clean = { ...DEFAULT_ORDER_CONFIDENCE_CONFIG };
    for (const [key, [min, max]] of Object.entries(CONFIG_LIMITS)) {
        const value = Number(config?.[key]);
        if (Number.isInteger(value) && value >= min && value <= max) clean[key] = value;
    }
    return clean;
}

function toFeatures(row) {
    if (!row) return { ...OFF, orderConfidenceConfig: { ...OFF.orderConfidenceConfig } };
    const mode = ORDER_CONFIDENCE_MODES.includes(row.order_confidence_mode)
        ? row.order_confidence_mode
        : 'off';
    return {
        customerIntelligence: row.customer_intelligence === true,
        orderConfidenceMode: mode,
        orderConfidenceConfig: sanitizeConfig(row.order_confidence_config),
    };
}

/**
 * Read a shop's pilot flags. A missing row, or a lookup failure, resolves to
 * every feature OFF — i.e. exactly the pre-pilot behaviour. The flag read is
 * never the reason an order cannot be booked.
 */
async function getPilotFeatures(shopId) {
    const Model = getModel();
    if (!shopId || typeof Model?.findByPk !== 'function') return toFeatures(null);
    try {
        const row = await Model.findByPk(shopId);
        return toFeatures(row);
    } catch (error) {
        metrics.increment('pilot_features.lookup_failed');
        logger.warn('Pilot feature lookup failed; treating features as off', {
            shopId,
            error: error.message,
        });
        return toFeatures(null);
    }
}

async function isCustomerIntelligenceEnabled(shopId) {
    return (await getPilotFeatures(shopId)).customerIntelligence;
}

function serialize(row, shopId) {
    const features = toFeatures(row);
    return {
        shop_id: shopId,
        customer_intelligence: features.customerIntelligence,
        order_confidence_mode: features.orderConfidenceMode,
        order_confidence_config: features.orderConfidenceConfig,
        updated_by: row?.updated_by || null,
        updated_at: row?.updated_at || null,
    };
}

async function getForAdmin(shopId) {
    const row = await getModel().findByPk(shopId);
    return serialize(row, shopId);
}

/**
 * SUPER_ADMIN write. Returns { previous, current } for the audit record.
 */
async function setPilotFeatures(shopId, updates, actorUserId, { transaction = null } = {}) {
    const { Shop } = require('../entities');
    const tx = transaction ? { transaction } : {};
    const shop = await Shop.findByPk(shopId, { attributes: ['id'], ...tx });
    if (!shop) throw new AppError('Shop not found', 404, 'NOT_FOUND');

    const Model = getModel();
    const existing = await Model.findByPk(shopId, { ...tx, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
    const previous = serialize(existing, shopId);

    const next = {
        customer_intelligence: typeof updates.customer_intelligence === 'boolean'
            ? updates.customer_intelligence
            : previous.customer_intelligence,
        order_confidence_mode: updates.order_confidence_mode !== undefined
            ? updates.order_confidence_mode
            : previous.order_confidence_mode,
        order_confidence_config: updates.order_confidence_config !== undefined
            ? sanitizeConfig({ ...previous.order_confidence_config, ...updates.order_confidence_config })
            : previous.order_confidence_config,
        updated_by: actorUserId || null,
    };
    if (!ORDER_CONFIDENCE_MODES.includes(next.order_confidence_mode)) {
        throw new AppError('Invalid order_confidence_mode', 400, 'VALIDATION_ERROR');
    }

    if (existing) {
        await existing.update(next, tx);
    } else {
        await Model.create({ shop_id: shopId, ...next }, tx);
    }
    const current = serialize(await Model.findByPk(shopId, tx), shopId);
    return { previous, current };
}

/** Global kill switch: every shop back to pre-pilot behaviour, no deploy. */
async function disableAll(actorUserId, { transaction = null } = {}) {
    const [affected] = await getModel().update(
        { customer_intelligence: false, order_confidence_mode: 'off', updated_by: actorUserId || null },
        { where: {}, ...(transaction ? { transaction } : {}) },
    );
    return { affected };
}

module.exports = {
    ORDER_CONFIDENCE_MODES,
    DEFAULT_ORDER_CONFIDENCE_CONFIG,
    getPilotFeatures,
    isCustomerIntelligenceEnabled,
    getForAdmin,
    setPilotFeatures,
    disableAll,
    sanitizeConfig,
};
