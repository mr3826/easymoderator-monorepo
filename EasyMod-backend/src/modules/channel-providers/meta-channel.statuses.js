'use strict';

const VALID_STATUSES = Object.freeze([
    'CONNECTED',
    'TOKEN_EXPIRED',
    'REVOKED',
    'DISCONNECTED',
    'ERROR',
]);

const HEALTHY_STATUSES = new Set(['CONNECTED']);
const RECONNECT_REQUIRED_STATUSES = new Set(['TOKEN_EXPIRED', 'REVOKED', 'ERROR']);

module.exports = {
    VALID_STATUSES,
    HEALTHY_STATUSES,
    RECONNECT_REQUIRED_STATUSES,
};
