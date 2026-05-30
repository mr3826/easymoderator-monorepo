const express = require('express');
const { sequelize } = require('../../utils/database/database-setup');
const { QueryTypes } = require('sequelize');

const router = express.Router();

/**
 * Public, unauthenticated platform stats for the marketing landing page
 * ("live proof"). Aggregate counts only — no per-shop or PII data is exposed.
 * Cached in-process for 5 minutes so a viral landing page can't hammer the DB.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = { at: 0, data: null };

const countSafe = async (sql) => {
    try {
        const [row] = await sequelize.query(sql, { type: QueryTypes.SELECT });
        return parseInt(row?.c, 10) || 0;
    } catch (_e) {
        return 0;
    }
};

// GET /api/public/live-stats
router.get('/live-stats', async (_req, res) => {
    if (cache.data && Date.now() - cache.at < CACHE_TTL_MS) {
        return res.json({ success: true, data: cache.data, cached: true });
    }

    const [messagesHandled, ordersCaptured, rtoTracked, blacklisted] = await Promise.all([
        countSafe('SELECT COUNT(*)::int AS c FROM messages'),
        countSafe('SELECT COUNT(*)::int AS c FROM orders'),
        countSafe('SELECT COALESCE(SUM(rto_count), 0)::int AS c FROM customer_delivery_stats'),
        countSafe('SELECT COUNT(*)::int AS c FROM rto_blacklist')
    ]);

    const data = {
        messages_handled: messagesHandled,
        orders_captured: ordersCaptured,
        // Fraud signals caught by RTO Shield: actual tracked RTOs + flagged numbers.
        fake_orders_blocked: rtoTracked + blacklisted,
        updated_at: new Date().toISOString()
    };

    cache = { at: Date.now(), data };
    return res.json({ success: true, data, cached: false });
});

module.exports = router;
