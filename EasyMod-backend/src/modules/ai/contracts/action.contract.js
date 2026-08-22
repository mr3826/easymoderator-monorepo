'use strict';

const crypto = require('crypto');
const { CONTRACT_VERSION } = require('./agent-task.contract');

const ACTION_TYPES = Object.freeze([
    'READ_PRODUCT',
    'READ_FAQ',
    'READ_DELIVERY_POLICY',
    'READ_PAYMENT_POLICY',
    'READ_ORDER_STATUS',
    'READ_CUSTOMER_CONTEXT',
    'CREATE_ORDER',
    'EDIT_PREORDER_CART',
    'CANCEL_ORDER_SESSION',
    'ACCEPT_PAYMENT',
    'BOOK_COURIER',
    'CREATE_SUPPORT_CASE',
]);

const MUTATING_ACTION_TYPES = Object.freeze([
    'CREATE_ORDER',
    'EDIT_PREORDER_CART',
    'CANCEL_ORDER_SESSION',
    'ACCEPT_PAYMENT',
    'BOOK_COURIER',
    'CREATE_SUPPORT_CASE',
]);

const READ_ONLY_ACTION_TYPES = Object.freeze(
    ACTION_TYPES.filter(type => !MUTATING_ACTION_TYPES.includes(type)),
);

const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

const normalizeText = (value) => String(value ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ');

const normalizePhone = (value) => {
    const raw = normalizeText(value).replace(/[\s().-]/g, '');
    let digits = raw.replace(/^\+/, '');
    if (digits.startsWith('00880')) digits = digits.slice(2);
    if (digits.startsWith('01')) digits = `880${digits.slice(1)}`;
    if (!/^8801[3-9]\d{8}$/.test(digits)) {
        throw new TypeError('customer phone must be a Bangladesh E.164 number');
    }
    return `+${digits}`;
};

const toMinorUnits = (value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) throw new TypeError('money value must be non-negative');
    return Math.round(amount * 100);
};

const sortKeys = (value) => {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((result, key) => {
        result[key] = sortKeys(value[key]);
        return result;
    }, {});
};

const canonicalJson = (value) => JSON.stringify(sortKeys(value));

const normalizeCustomer = (summary = {}) => {
    const customer = summary.customer || {};
    return {
        address: normalizeText(summary.address ?? customer.address),
        name: normalizeText(summary.customerName ?? customer.name),
        phone: normalizePhone(summary.phone ?? summary.customerPhone ?? customer.phone),
    };
};

const normalizeItem = (item = {}) => {
    const productId = normalizeText(item.productId ?? item.product_id);
    const variantId = normalizeText(item.variantId ?? item.variant_id) || null;
    const quantity = Number(item.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity < 1) {
        throw new TypeError('order item productId and positive integer quantity are required');
    }
    const unitPrice = toMinorUnits(item.unitPrice ?? item.unit_price ?? item.price);
    const lineTotal = toMinorUnits(item.lineTotal ?? item.line_total ?? (Number(item.unitPrice ?? item.unit_price ?? item.price) * quantity));
    return { lineTotal, productId, quantity, unitPrice, variantId };
};

/**
 * Canonical order summary used for customer confirmation and CREATE_ORDER
 * idempotency. Items are sorted; object keys are recursively sorted; money is
 * stored in poisha and phone numbers are E.164.
 * @param {object} summary
 * @returns {object}
 */
const canonicalOrderSummary = (summary = {}) => {
    const items = (summary.items || summary.cart || []).map(normalizeItem)
        .sort((left, right) => (
            `${left.productId}|${left.variantId || ''}`.localeCompare(`${right.productId}|${right.variantId || ''}`)
        ));
    return sortKeys({
        currency: normalizeText(summary.currency || 'BDT').toUpperCase(),
        customer: normalizeCustomer(summary),
        deliveryCharge: toMinorUnits(summary.deliveryCharge ?? summary.delivery_charge ?? 0),
        deliveryMethod: normalizeText(summary.deliveryMethod ?? summary.delivery_method ?? 'COURIER').toUpperCase(),
        items,
        paymentMethod: normalizeText(summary.paymentMethod ?? summary.payment_method).toUpperCase(),
        total: toMinorUnits(summary.total ?? (items.reduce((sum, item) => sum + item.lineTotal, 0) + toMinorUnits(summary.deliveryCharge ?? summary.delivery_charge ?? 0)) / 100),
    });
};

const confirmedSummaryHash = (summary) => sha256(canonicalJson(canonicalOrderSummary(summary)));

const deriveIdempotencyKey = (parts) => {
    if (!Array.isArray(parts) || parts.some(part => typeof part !== 'string' || part === '')) {
        throw new TypeError('idempotency derivation parts must be non-empty strings');
    }
    return sha256(parts.join('|'));
};

const deriveCreateOrderIdempotencyKey = ({ shopId, conversationId, orderSessionId, confirmedSummaryHash: summaryHash }) => {
    if (!/^[a-f0-9]{64}$/i.test(summaryHash || '')) throw new TypeError('confirmed summary hash is required');
    return deriveIdempotencyKey([shopId, conversationId, orderSessionId, summaryHash]);
};

const deriveBookCourierIdempotencyKey = ({ shopId, orderId, provider }) =>
    deriveIdempotencyKey([shopId, orderId, provider]);

const deriveAcceptPaymentIdempotencyKey = ({ shopId, orderId, trxId }) =>
    deriveIdempotencyKey([shopId, orderId, trxId]);

/**
 * @typedef {object} ProposedAction
 * @property {string} contractVersion
 * @property {string} actionId
 * @property {string} requestedByAgent
 * @property {string} actionType
 * @property {string} domain
 * @property {string} shopId
 * @property {string} conversationId
 * @property {string} idempotencyKey
 * @property {string} evidenceSnapshotHash
 * @property {object} payload
 * @property {boolean} mutates
 * @property {object|null} confirmation
 * @property {string} createdAt
 * @property {string} expiresAt
 */

const validateProposedAction = (action) => {
    if (!action || action.contractVersion !== CONTRACT_VERSION) return false;
    if (!ACTION_TYPES.includes(action.actionType)) return false;
    if (typeof action.actionId !== 'string' || !action.actionId) return false;
    if (typeof action.requestedByAgent !== 'string' || !action.requestedByAgent) return false;
    if (typeof action.shopId !== 'string' || !action.shopId) return false;
    if (typeof action.conversationId !== 'string' || !action.conversationId) return false;
    if (!/^[a-f0-9]{64}$/i.test(action.idempotencyKey || '')) return false;
    if (typeof action.evidenceSnapshotHash !== 'string' || !action.evidenceSnapshotHash) return false;
    if (typeof action.payload !== 'object' || action.payload === null) return false;
    return action.mutates === MUTATING_ACTION_TYPES.includes(action.actionType);
};

const createProposedAction = (input = {}) => {
    const action = {
        contractVersion: CONTRACT_VERSION,
        actionId: input.actionId || crypto.randomUUID(),
        requestedByAgent: input.requestedByAgent,
        actionType: input.actionType,
        domain: input.domain,
        shopId: input.shopId,
        conversationId: input.conversationId,
        idempotencyKey: input.idempotencyKey,
        evidenceSnapshotHash: input.evidenceSnapshotHash,
        payload: input.payload || {},
        mutates: MUTATING_ACTION_TYPES.includes(input.actionType),
        confirmation: input.confirmation || null,
        createdAt: input.createdAt || new Date().toISOString(),
        expiresAt: input.expiresAt || new Date(Date.now() + 30_000).toISOString(),
    };
    if (!validateProposedAction(action)) throw new TypeError('invalid proposed action');
    return action;
};

module.exports = {
    ACTION_TYPES,
    MUTATING_ACTION_TYPES,
    READ_ONLY_ACTION_TYPES,
    canonicalJson,
    canonicalOrderSummary,
    confirmedSummaryHash,
    createProposedAction,
    deriveAcceptPaymentIdempotencyKey,
    deriveBookCourierIdempotencyKey,
    deriveCreateOrderIdempotencyKey,
    deriveIdempotencyKey,
    isDeterministicIdempotencyKey: value => /^[a-f0-9]{64}$/i.test(value || ''),
    normalizePhone,
    toMinorUnits,
    validateProposedAction,
};
