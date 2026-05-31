'use strict';

/**
 * Growth metrics — activation & retention.
 *
 * Activation = a shop's FIRST successful AI reply to a real customer. Recorded
 * once per shop (Redis NX-gated) into shop.settings.activation, so no migration
 * is needed and the hot reply path is never blocked.
 *
 * Retention = a shop with >=1 captured order in a given week, derived live from
 * the Orders table (no extra storage).
 *
 * Together these power the launch / 10-shop smoke-test dashboard: how many shops
 * activated, how fast, and how many are still transacting week over week.
 */

const { Op } = require('sequelize');
const Shop = require('../shop/shop.entity');
const Order = require('../order/order.entity');
const { cacheRedis } = require('../../config/redis');

const DAY_MS = 24 * 60 * 60 * 1000;

const normalizeSettings = (settings) => {
    if (!settings) return {};
    if (typeof settings === 'object') return settings;
    try {
        const parsed = JSON.parse(settings);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

/**
 * Mark a shop ACTIVATED on its first successful AI reply. Idempotent and
 * best-effort: a Redis NX claim throttles to one write per shop lifetime, and a
 * second DB-level guard prevents overwriting an existing activation timestamp.
 * Never throws — activation tracking must never block or fail a customer reply.
 * @param {string} shopId
 * @param {string|null} conversationId  the conversation that first activated the shop
 */
const recordActivation = async (shopId, conversationId = null) => {
    if (!shopId) return;
    try {
        // NX (no expiry) → succeeds only the first time for this shop.
        const claimed = await cacheRedis.set(`shop:activated:${shopId}`, '1', 'NX');
        if (claimed !== 'OK' && claimed !== 1) return; // already claimed, or claim failed

        const shop = await Shop.findByPk(shopId);
        if (!shop) return;

        const settings = normalizeSettings(shop.settings);
        if (settings.activation && settings.activation.activated_at) return; // already recorded

        await shop.update({
            settings: {
                ...settings,
                activation: {
                    activated_at: new Date().toISOString(),
                    first_conversation_id: conversationId || null,
                },
            },
        });
    } catch (_) {
        // best-effort — swallow so a reply is never blocked by metrics bookkeeping
    }
};

/**
 * Cross-shop activation + retention report.
 * @param {{ now?: Date|string }} [opts]
 * @returns {Promise<object>} { generatedAt, totals, shops[] }
 */
const getGrowthMetrics = async (opts = {}) => {
    const now = opts.now ? new Date(opts.now) : new Date();
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS);

    const shops = await Shop.findAll({
        attributes: ['id', 'shop_name', 'name', 'settings', 'created_at'],
    });

    const rows = await Promise.all(shops.map(async (shop) => {
        const settings = normalizeSettings(shop.settings);
        const activatedAt = settings.activation?.activated_at || null;
        const createdAt = shop.created_at || null;

        const [ordersLast7d, ordersPrev7d] = await Promise.all([
            Order.count({ where: { shop_id: shop.id, created_at: { [Op.gte]: weekAgo } } }),
            Order.count({ where: { shop_id: shop.id, created_at: { [Op.gte]: twoWeeksAgo, [Op.lt]: weekAgo } } }),
        ]);

        const daysToActivation = (activatedAt && createdAt)
            ? Math.max(0, Math.round((new Date(activatedAt) - new Date(createdAt)) / DAY_MS))
            : null;

        return {
            shopId: shop.id,
            name: shop.shop_name || shop.name || null,
            createdAt,
            activatedAt,
            activated: Boolean(activatedAt),
            daysToActivation,
            ordersLast7d,
            ordersPrev7d,
            retainedThisWeek: ordersLast7d > 0,
            retainedLastWeek: ordersPrev7d > 0,
        };
    }));

    const total = rows.length;
    const activated = rows.filter(r => r.activated).length;
    const retainedThisWeek = rows.filter(r => r.retainedThisWeek).length;
    const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

    return {
        generatedAt: now.toISOString(),
        totals: {
            shops: total,
            activated,
            activationRate: pct(activated, total),
            retainedThisWeek,
            // Retention is measured against ACTIVATED shops — the meaningful denominator.
            retentionRate: pct(retainedThisWeek, activated),
        },
        // Most-active shops first.
        shops: rows.sort((a, b) => b.ordersLast7d - a.ordersLast7d),
    };
};

module.exports = { recordActivation, getGrowthMetrics };
