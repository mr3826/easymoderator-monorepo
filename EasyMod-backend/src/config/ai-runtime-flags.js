'use strict';

// Every MUTATING action type must map to an explicit sub-flag. A mutating
// type with no mapping (including any type added later) is DENIED, not
// allowed by fall-through — adding a new mutating action to the contract
// without wiring its flag fails closed. Read types carry no side effect and
// are gated only by the parent runtime flag.
const MUTATING_ACTION_FLAGS = Object.freeze({
    CREATE_ORDER: 'AI_ORDER_MUTATIONS_ENABLED',
    EDIT_PREORDER_CART: 'AI_ORDER_MUTATIONS_ENABLED',
    CANCEL_ORDER_SESSION: 'AI_ORDER_MUTATIONS_ENABLED',
    BOOK_COURIER: 'AI_COURIER_BOOKING_ENABLED',
    ACCEPT_PAYMENT: 'AI_PAYMENT_ACCEPTANCE_ENABLED',
    CREATE_SUPPORT_CASE: 'AI_SUPPORT_CASE_ENABLED',
});

const READ_ACTION_TYPES = Object.freeze([
    'READ_PRODUCT',
    'READ_FAQ',
    'READ_DELIVERY_POLICY',
    'READ_PAYMENT_POLICY',
    'READ_ORDER_STATUS',
    'READ_CUSTOMER_CONTEXT',
]);

const isRuntimeFlagEnabled = (name) => {
    const value = process.env[name];
    if (value === 'true') return true;
    if (value === 'false') return false;
    return process.env.NODE_ENV !== 'production';
};

const isDomainAgentActionEnabled = (actionType) => {
    if (!isRuntimeFlagEnabled('DOMAIN_AGENT_RUNTIME_ENABLED')) return false;
    if (READ_ACTION_TYPES.includes(actionType)) return true;
    const flag = MUTATING_ACTION_FLAGS[actionType];
    if (!flag) return false;
    return isRuntimeFlagEnabled(flag);
};

module.exports = { isRuntimeFlagEnabled, isDomainAgentActionEnabled, MUTATING_ACTION_FLAGS, READ_ACTION_TYPES };
