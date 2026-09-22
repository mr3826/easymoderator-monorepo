'use strict';

const TEMPORARY_PASSWORD_TTL_MS = 24 * 60 * 60 * 1000;

function timestamp(value) {
    if (value instanceof Date) return value.getTime();
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
}

function getTemporaryPasswordExpiry(now = Date.now()) {
    return new Date((timestamp(now) ?? Date.now()) + TEMPORARY_PASSWORD_TTL_MS);
}

function isTemporaryPasswordExpired(expiresAt, now = Date.now()) {
    const expiryTimestamp = timestamp(expiresAt);
    const nowTimestamp = timestamp(now) ?? Date.now();
    return expiryTimestamp === null || expiryTimestamp <= nowTimestamp;
}

function getTemporaryPasswordState(user, now = Date.now()) {
    const required = user?.must_change_password === true;
    const expiresAt = timestamp(user?.temporary_password_expires_at);
    const expiry = expiresAt === null ? null : new Date(expiresAt);

    return {
        required,
        expiresAt: expiry,
        expired: required && isTemporaryPasswordExpired(expiry, now),
    };
}

module.exports = {
    TEMPORARY_PASSWORD_TTL_MS,
    getTemporaryPasswordExpiry,
    getTemporaryPasswordState,
    isTemporaryPasswordExpired,
};
