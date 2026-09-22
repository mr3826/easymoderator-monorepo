'use strict';

const { User } = require('../entities');
const { sequelize } = require('../../utils/database/database-setup');
const { AppError } = require('../../utils/AppError');
const cacheService = require('../../utils/cache.service');

/**
 * Invalidate every credential session for a user by rotating the token
 * generation and clearing the stored refresh token. The cache write is kept
 * inside the caller's transaction and is confirmed before the mutation can
 * commit, so a cache outage cannot leave old JWTs accepted as valid.
 */
const invalidateUserSessions = async (userId, { transaction = null } = {}) => {
    if (!transaction) {
        return sequelize.transaction((t) => invalidateUserSessions(userId, { transaction: t }));
    }

    const user = await User.findByPk(userId, {
        attributes: ['id', 'token_version'],
        transaction,
        lock: transaction.LOCK?.UPDATE,
    });
    if (!user) return null;

    const currentTokenVersion = Number(user.token_version);
    if (!Number.isInteger(currentTokenVersion) || currentTokenVersion < 0) {
        throw new AppError(
            'Session invalidation service is temporarily unavailable.',
            503,
            'AUTH_SESSION_INVALIDATION_UNAVAILABLE',
        );
    }
    const nextTokenVersion = currentTokenVersion + 1;

    await user.update({
        refresh_token: null,
        token_version: nextTokenVersion,
    }, { transaction });

    try {
        const cached = await cacheService.setStrict(
            `user:${userId}:token_version`,
            nextTokenVersion,
            60,
        );
        if (cached !== true) throw new Error('token version cache write was not confirmed');
        if (typeof cacheService.getStrict === 'function') {
            const confirmedVersion = await cacheService.getStrict(`user:${userId}:token_version`);
            if (confirmedVersion !== nextTokenVersion) {
                throw new Error('token version cache read-back was not confirmed');
            }
        }
    } catch (_error) {
        throw new AppError(
            'Session invalidation service is temporarily unavailable.',
            503,
            'AUTH_SESSION_INVALIDATION_UNAVAILABLE',
        );
    }

    return nextTokenVersion;
};

module.exports = { invalidateUserSessions };
