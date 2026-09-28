'use strict';

/**
 * RTO Shield v2 / Order Confidence — deterministic rules (pure).
 *
 * Inputs are facts the platform already records; nothing here calls a model.
 * Rules are monotonic: history can add caution but never removes a reason,
 * so a borrowed or shared phone cannot "inherit" a clean record to skip
 * verification. Evidence carries counts and codes only — never phone,
 * address or name.
 */

const crypto = require('crypto');
const { normalizeBdMobile } = require('../customer-intelligence/order-outcome');

const RULES_VERSION = 'order-confidence/1.0.0';

const DECISIONS = Object.freeze({
    READY: 'READY',
    VERIFY: 'VERIFY',
    MANUAL_REVIEW: 'MANUAL_REVIEW',
});

const SEVERITY = Object.freeze({
    BLOCK: 'BLOCK',     // not bookable at all (not overridable)
    REVIEW: 'REVIEW',   // MANUAL_REVIEW — owner/admin approval
    VERIFY: 'VERIFY',   // VERIFY — any shop role may confirm
    INFO: 'INFO',       // supporting context only
});

const LEVEL = Object.freeze({ READY: 0, VERIFY: 1, MANUAL_REVIEW: 2 });

const NOT_BOOKABLE_STATUSES = new Set(['cancelled', 'refunded']);
const UNCONFIRMED_STATUSES = new Set(['draft', 'pending']);

const lower = (value) => String(value || '').trim().toLowerCase();

function normalizeAddressText(address) {
    if (address === null || address === undefined) return '';
    if (typeof address === 'object') {
        const text = address.full_address
            || ['street_address', 'address', 'road', 'house', 'area', 'upazila', 'thana', 'district', 'city']
                .map((key) => address[key])
                .filter((part) => part !== null && part !== undefined && String(part).trim())
                .join(', ');
        return normalizeAddressText(text);
    }
    return String(address).replace(/\s+/g, ' ').trim().toLowerCase();
}

const money = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

const orderItems = (order) => {
    let items = order?.items;
    if (typeof items === 'string') {
        try { items = JSON.parse(items); } catch (_) { items = []; }
    }
    return Array.isArray(items) ? items : [];
};

/**
 * Hash of the order facts a merchant decision is about. When any of these
 * change, a recorded verification/approval no longer applies (ADR-0010).
 * Order status is deliberately excluded: confirming a draft is not a change
 * in what was approved.
 */
function fingerprint(order) {
    const items = orderItems(order)
        .map((item) => `${item?.product_id || item?.name || item?.product_name || ''}|${Number(item?.quantity) || 1}`)
        .sort();
    const material = [
        normalizeBdMobile(order?.customer_phone) || lower(order?.customer_phone),
        normalizeAddressText(order?.delivery_address),
        money(order?.total).toFixed(2),
        lower(order?.payment_status),
        lower(order?.payment_method),
        order?.customer_id || '',
        items.join(','),
    ];
    return crypto.createHash('sha256').update(JSON.stringify(material)).digest('hex').slice(0, 64);
}

const isPaid = (order) => lower(order?.payment_status) === 'paid';

/**
 * @param {object} facts
 * @param {object} facts.order         the order row (tenant-scoped)
 * @param {object|null} facts.history  { delivered, returned, cancelled, total } for the same
 *                                      phone/customer in this shop, excluding this order; null = unavailable
 * @param {Array}  facts.recentActiveOrders  other active orders for the same phone within 24h (numbers only)
 * @param {object|null} facts.rtoShield   RtoShieldService.checkPhone() result; null = unavailable
 * @param {object} config               { high_value_cod_threshold, address_min_length }
 */
function evaluate({ order, history, recentActiveOrders = [], rtoShield }, config = {}) {
    const reasons = [];
    const add = (code, severity, source, evidence = {}) => reasons.push({ code, severity, source, evidence });
    const threshold = Number(config.high_value_cod_threshold ?? 10000);
    const addressMin = Number(config.address_min_length ?? 15);

    const status = lower(order?.order_status);
    if (NOT_BOOKABLE_STATUSES.has(status)) add('ORDER_CANCELLED', SEVERITY.BLOCK, 'ORDER', { order_status: status });

    // Existing RTO Shield (per-shop list, whitelist appeal, and the shop's own
    // choice about the cross-shop network) — consumed as-is, not re-scored.
    if (rtoShield === null) {
        add('INPUT_UNAVAILABLE', SEVERITY.VERIFY, 'RTO_SHIELD', { input: 'rto_shield' });
    } else if (rtoShield) {
        const networkEvidence = rtoShield.network ? {
            shops_reported: rtoShield.network.shops_reported,
            total_attempts: rtoShield.network.total_attempts,
            rto_rate: Math.round((rtoShield.network.rto_rate || 0) * 100) / 100,
        } : null;
        const listSource = rtoShield.entry ? (rtoShield.entry.is_global ? 'NETWORK_LIST' : 'SHOP_LIST') : 'NETWORK_SIGNAL';
        if (rtoShield.tier === 'block') {
            add('RTO_SHIELD_BLOCK', SEVERITY.REVIEW, 'RTO_SHIELD', {
                risk_score: rtoShield.risk_score, list: listSource, ...(networkEvidence ? { network: networkEvidence } : {}),
            });
        } else if (rtoShield.tier === 'verify') {
            add('RTO_SHIELD_VERIFY', SEVERITY.VERIFY, 'RTO_SHIELD', {
                risk_score: rtoShield.risk_score, list: listSource, ...(networkEvidence ? { network: networkEvidence } : {}),
            });
        }
    }

    if (history === null) {
        add('INPUT_UNAVAILABLE', SEVERITY.VERIFY, 'ORDER_HISTORY', { input: 'order_history' });
    } else if (history) {
        const delivered = history.delivered || 0;
        const returned = history.returned || 0;
        if (returned >= 2 && returned > delivered) {
            add('REPEATED_RETURNS', SEVERITY.REVIEW, 'ORDER_HISTORY', { returned, delivered });
        } else if (returned >= 1 && returned >= delivered) {
            add('PRIOR_RETURN', SEVERITY.VERIFY, 'ORDER_HISTORY', { returned, delivered });
        }
        if (delivered > 0 || returned > 0) {
            add('DELIVERY_HISTORY', SEVERITY.INFO, 'ORDER_HISTORY', { delivered, returned });
        } else {
            add('NEW_CUSTOMER', SEVERITY.INFO, 'ORDER_HISTORY', { previous_orders: history.total || 0 });
        }
    }

    if (recentActiveOrders.length) {
        add('POSSIBLE_DUPLICATE_ORDER', SEVERITY.VERIFY, 'ORDER_HISTORY', {
            other_orders: recentActiveOrders.slice(0, 3).map((o) => o.order_number || o.id),
            window_hours: 24,
        });
    }

    if (!normalizeBdMobile(order?.customer_phone)) add('PHONE_INVALID', SEVERITY.VERIFY, 'ORDER');

    const addressLength = normalizeAddressText(order?.delivery_address).length;
    if (addressLength < addressMin) {
        add('ADDRESS_TOO_SHORT', SEVERITY.VERIFY, 'ORDER', { length: addressLength, minimum: addressMin });
    }

    if (UNCONFIRMED_STATUSES.has(status)) add('ORDER_NOT_CONFIRMED', SEVERITY.VERIFY, 'ORDER', { order_status: status });

    if (isPaid(order)) {
        add('PREPAID', SEVERITY.INFO, 'ORDER');
    } else if (history && (history.delivered || 0) === 0 && money(order?.total) >= threshold) {
        add('HIGH_VALUE_FIRST_COD', SEVERITY.VERIFY, 'ORDER', { total: money(order?.total), threshold });
    }

    const has = (severity) => reasons.some((r) => r.severity === severity);
    const decision = has(SEVERITY.BLOCK) || has(SEVERITY.REVIEW)
        ? DECISIONS.MANUAL_REVIEW
        : has(SEVERITY.VERIFY) ? DECISIONS.VERIFY : DECISIONS.READY;
    return {
        decision,
        bookable: !has(SEVERITY.BLOCK),
        reasons,
        rules_version: RULES_VERSION,
    };
}

/**
 * Effective state for the booking gate: a recorded resolution clears the
 * decision only when it covers the decision's level AND was made for the same
 * order facts (fingerprint).
 */
function effectiveState(row, { currentFingerprint } = {}) {
    if (!row) return { state: null, resolved: false, stale: false };
    const fp = currentFingerprint || row.input_fingerprint;
    const resolutionApplies = Boolean(row.resolution)
        && row.resolution_fingerprint === fp
        && (LEVEL[row.resolution_level] ?? -1) >= (LEVEL[row.decision] ?? 99);
    const stale = Boolean(row.resolution) && row.resolution_fingerprint !== fp;
    if (row.decision === DECISIONS.READY) return { state: DECISIONS.READY, resolved: false, stale };
    return resolutionApplies
        ? { state: DECISIONS.READY, resolved: true, stale: false }
        : { state: row.decision, resolved: false, stale };
}

module.exports = {
    RULES_VERSION,
    DECISIONS,
    SEVERITY,
    LEVEL,
    evaluate,
    effectiveState,
    fingerprint,
    normalizeAddressText,
};
