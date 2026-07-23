'use strict';

const { Op } = require('sequelize');
const { PaymentTransaction } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { opsAlert } = require('../../utils/ops-alert');

const DEFAULT_STALE_MINUTES = 15;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function boundedInteger(value, fallback, min, max, label) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new AppError(`${label} must be an integer from ${min} to ${max}`, 400);
    }
    return parsed;
}

/**
 * Read-only operational report. It deliberately does not reset or replay a
 * payment: a gateway callback in `processing` is non-claimable, so an operator
 * must verify gateway and order state before choosing a manual resolution.
 */
async function getStalePaymentProcessingReport({
    olderThanMinutes,
    limit,
    now = new Date(),
} = {}) {
    const thresholdMinutes = boundedInteger(
        olderThanMinutes,
        DEFAULT_STALE_MINUTES,
        5,
        7 * 24 * 60,
        'olderThanMinutes',
    );
    const safeLimit = boundedInteger(limit, DEFAULT_LIMIT, 1, MAX_LIMIT, 'limit');
    const cutoff = new Date(now.getTime() - thresholdMinutes * 60 * 1000);
    const { count, rows } = await PaymentTransaction.findAndCountAll({
        where: {
            status: 'processing',
            updated_at: { [Op.lt]: cutoff },
        },
        attributes: [
            'id',
            'shop_id',
            'order_id',
            'payment_gateway',
            'status',
            'updated_at',
        ],
        order: [['updated_at', 'ASC']],
        limit: safeLimit,
    });
    const items = rows.map((row) => {
        const updatedAt = row.updated_at || row.get?.('updated_at');
        return {
            paymentId: row.id,
            shopId: row.shop_id,
            orderId: row.order_id,
            gateway: row.payment_gateway || null,
            status: row.status,
            updatedAt,
            ageMinutes: Math.max(
                0,
                Math.floor((now.getTime() - new Date(updatedAt).getTime()) / 60000),
            ),
        };
    });

    if (count > 0) {
        await opsAlert('Stale payment processing requires reconciliation', {
            detail: `${count} payment transaction(s) exceed the ${thresholdMinutes}-minute processing threshold`,
            level: 'warning',
            context: {
                staleCount: count,
                thresholdMinutes,
                oldestAgeMinutes: items[0]?.ageMinutes || thresholdMinutes,
            },
        });
    }

    return {
        thresholdMinutes,
        generatedAt: now,
        total: count,
        items,
    };
}

module.exports = {
    getStalePaymentProcessingReport,
    _private: {
        boundedInteger,
    },
};
