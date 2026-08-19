'use strict';

/**
 * Growth metrics — activation & retention.
 *
 * Activation = a shop's FIRST successful AI reply to a real customer. Recorded
 * once per shop into shop.settings.activation. Redis uses a temporary NX claim
 * while the database write is in flight and persists it only after activation
 * is confirmed, so a failed DB write can never poison the shop permanently.
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
const ACTIVATION_CLAIM_TTL_SECONDS = 5 * 60;

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
    const claimKey = `shop:activated:${shopId}`;
    let claimed = false;
    let activationConfirmed = false;

    try {
        // The expiry is a recovery boundary, not the long-term marker. Once the
        // DB confirms activation, PERSIST restores the fast lifetime short-circuit.
        const claimResult = await cacheRedis.set(
            claimKey,
            '1',
            'EX',
            ACTIVATION_CLAIM_TTL_SECONDS,
            'NX',
        );
        claimed = claimResult === 'OK' || claimResult === 1;
        if (!claimed) return;

        const shop = await Shop.findByPk(shopId);
        if (!shop) return;

        const settings = normalizeSettings(shop.settings);
        if (settings.activation && settings.activation.activated_at) {
            activationConfirmed = true;
            return;
        }

        await shop.update({
            settings: {
                ...settings,
                activation: {
                    activated_at: new Date().toISOString(),
                    first_conversation_id: conversationId || null,
                },
            },
        });
        activationConfirmed = true;
    } catch (_) {
        // best-effort — swallow so a reply is never blocked by metrics bookkeeping
    } finally {
        if (claimed) {
            try {
                if (activationConfirmed) {
                    await cacheRedis.persist(claimKey);
                } else {
                    await cacheRedis.del(claimKey);
                }
            } catch (_) {
                // The temporary claim still expires, so cleanup failure cannot poison
                // activation permanently and must never block the customer reply.
            }
        }
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

    const shopIds = shops.map(shop => shop.id);
    const [lastWeekCounts, previousWeekCounts] = shopIds.length > 0
        ? await Promise.all([
            Order.count({
                where: {
                    shop_id: { [Op.in]: shopIds },
                    created_at: { [Op.gte]: weekAgo },
                },
                group: ['shop_id'],
            }),
            Order.count({
                where: {
                    shop_id: { [Op.in]: shopIds },
                    created_at: { [Op.gte]: twoWeeksAgo, [Op.lt]: weekAgo },
                },
                group: ['shop_id'],
            }),
        ])
        : [[], []];
    const toCountMap = counts => new Map(
        counts.map(row => [row.shop_id, Number(row.count) || 0]),
    );
    const lastWeekByShop = toCountMap(lastWeekCounts);
    const previousWeekByShop = toCountMap(previousWeekCounts);

    const rows = shops.map((shop) => {
        const settings = normalizeSettings(shop.settings);
        const activatedAt = settings.activation?.activated_at || null;
        const createdAt = shop.created_at || null;
        const ordersLast7d = lastWeekByShop.get(shop.id) || 0;
        const ordersPrev7d = previousWeekByShop.get(shop.id) || 0;

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
    });

    const total = rows.length;
    const activatedRows = rows.filter(r => r.activated);
    const activated = activatedRows.length;
    const retainedThisWeek = activatedRows.filter(r => r.retainedThisWeek).length;
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
