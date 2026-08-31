'use strict';

const crypto = require('crypto');

const getCourierDispatchModel = (suppliedModel = null) => {
    if (suppliedModel && typeof suppliedModel.findOrCreate === 'function') return suppliedModel;

    let entitiesLoaded = false;
    try {
        entitiesLoaded = true;
        const entities = require('../entities');
        if (entities?.CourierDispatch && typeof entities.CourierDispatch.findOrCreate === 'function') {
            return entities.CourierDispatch;
        }
    } catch (_) {
        // The isolated unit fixtures may not be able to initialise all entities.
    }

    // If the entity registry loaded successfully but intentionally does not
    // expose CourierDispatch, do not instantiate a second Sequelize model. This
    // keeps isolated callers fail-closed and prevents an unmocked SQLite model
    // from bypassing the registry's test boundary.
    if (entitiesLoaded) return null;

    try {
        const model = require('./courier-dispatch.entity');
        return typeof model?.findOrCreate === 'function' ? model : null;
    } catch (_) {
        return null;
    }
};

const statusOf = (record) => String(record?.status || '').toUpperCase();

/**
 * Create or observe one durable claim. Only a newly-created claim receives an
 * owner token. Existing PENDING/INDETERMINATE claims are never re-owned here.
 */
const claimCourierDispatch = async ({ model: suppliedModel, shopId, orderId, provider, idempotencyKey }) => {
    const model = getCourierDispatchModel(suppliedModel);
    if (!model) return { state: 'unavailable', provider, record: null, ownerToken: null, idempotencyKey };

    const ownerToken = crypto.randomUUID();
    const [record, created] = await model.findOrCreate({
        where: { shop_id: shopId, order_id: orderId, provider },
        defaults: {
            idempotency_key: idempotencyKey,
            status: 'PENDING',
            dispatch_owner_token: ownerToken,
        },
    });

    if (created) {
        // Lightweight test doubles do not apply Sequelize defaults. Keeping the
        // token on the returned object lets the same ownership checks run there.
        if (record && !record.dispatch_owner_token) record.dispatch_owner_token = ownerToken;
        return { state: 'claimed', provider, record, ownerToken, idempotencyKey };
    }

    if (statusOf(record) === 'COMMITTED') {
        return { state: 'committed', provider, record, ownerToken: null, idempotencyKey };
    }

    // A definitive provider rejection is the only state that may be explicitly
    // reopened by a new caller. The CAS prevents two retries from both owning it.
    if (statusOf(record) === 'FAILED' && record?.id && typeof model.update === 'function') {
        const [updated] = await model.update(
            {
                status: 'PENDING',
                dispatch_owner_token: ownerToken,
                error: null,
            },
            { where: { id: record.id, status: 'FAILED' } },
        );
        if (updated > 0) {
            Object.assign(record, {
                status: 'PENDING',
                dispatch_owner_token: ownerToken,
                error: null,
            });
            return { state: 'claimed', provider, record, ownerToken, idempotencyKey };
        }
    }

    return { state: 'existing', provider, record, ownerToken: null, idempotencyKey };
};

/**
 * Transition a claim only while its owner token and expected status still
 * match. A zero-row update is a lost race, not permission to retry.
 */
const transitionCourierDispatch = async (
    record,
    values,
    { model: suppliedModel, ownerToken, expectedStatus = 'PENDING' } = {},
) => {
    if (!record || !ownerToken) return { updated: false, record };

    const model = getCourierDispatchModel(suppliedModel);
    if (model && record.id && typeof model.update === 'function') {
        const [updated] = await model.update(values, {
            where: {
                id: record.id,
                dispatch_owner_token: ownerToken,
                ...(expectedStatus ? { status: expectedStatus } : {}),
            },
        });
        return { updated: updated > 0, record };
    }

    // Test doubles without a static update method still get the same guard.
    if (record.dispatch_owner_token !== ownerToken) return { updated: false, record };
    if (expectedStatus && statusOf(record) !== expectedStatus) return { updated: false, record };
    if (typeof record.update !== 'function') return { updated: false, record };

    await record.update(values);
    Object.assign(record, values);
    return { updated: true, record };
};

module.exports = {
    claimCourierDispatch,
    transitionCourierDispatch,
    getCourierDispatchModel,
    statusOf,
};
