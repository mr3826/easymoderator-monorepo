'use strict';

const { canonicalJson } = require('./action.contract');

const AUTHORIZATION_TTL_MS = 30 * 1000;

const authorizationPayload = (authorization) => {
    const { signature, ...payload } = authorization || {};
    return payload;
};

const serializeAuthorization = (authorization) => canonicalJson(authorizationPayload(authorization));

const isAuthorizationShapeValid = (authorization) => {
    if (!authorization || authorization.contractVersion !== '1.0') return false;
    for (const field of [
        'authorizationId',
        'actionType',
        'shopId',
        'actorAgent',
        'idempotencyKey',
        'evidenceSnapshotHash',
        'issuedAt',
        'expiresAt',
        'gateDecisionId',
        'signature',
    ]) {
        if (typeof authorization[field] !== 'string' || !authorization[field]) return false;
    }
    return true;
};

module.exports = {
    AUTHORIZATION_TTL_MS,
    authorizationPayload,
    isAuthorizationShapeValid,
    serializeAuthorization,
};
