'use strict';

const crypto = require('crypto');

const SNAPSHOT_TTL_MS = 60 * 1000;

const stableValue = (value) => {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((result, key) => {
        result[key] = stableValue(value[key]);
        return result;
    }, {});
};

const snapshotPayload = (evidence) => {
    const { retrievedAt, freshnessExpiresAt, snapshotHash, ...payload } = evidence || {};
    return stableValue(payload);
};

const hashEvidence = (evidence) => crypto.createHash('sha256')
    .update(JSON.stringify(snapshotPayload(evidence)), 'utf8')
    .digest('hex');

/**
 * Stamp an existing GroundingEvidence record with a content hash and freshness
 * window. This preserves the existing evidence shape while making the exact
 * retrieval snapshot auditable by Action Gate.
 * @param {object} evidence
 * @param {object} [options]
 * @param {Date|string} [options.retrievedAt]
 * @param {number} [options.ttlMs]
 * @returns {object}
 */
const withEvidenceSnapshot = (evidence, { retrievedAt = new Date(), ttlMs = SNAPSHOT_TTL_MS } = {}) => {
    const retrieved = new Date(retrievedAt);
    if (Number.isNaN(retrieved.getTime())) throw new TypeError('retrievedAt must be a valid date');
    const stamped = {
        ...evidence,
        retrievedAt: retrieved.toISOString(),
        freshnessExpiresAt: new Date(retrieved.getTime() + ttlMs).toISOString(),
    };
    return { ...stamped, snapshotHash: hashEvidence(stamped) };
};

const isEvidenceSnapshotFresh = (evidence, now = new Date()) => {
    if (!evidence?.snapshotHash || !evidence?.retrievedAt || !evidence?.freshnessExpiresAt) return false;
    if (hashEvidence(evidence) !== evidence.snapshotHash) return false;
    const current = new Date(now).getTime();
    return current >= new Date(evidence.retrievedAt).getTime()
        && current <= new Date(evidence.freshnessExpiresAt).getTime();
};

module.exports = {
    SNAPSHOT_TTL_MS,
    hashEvidence,
    isEvidenceSnapshotFresh,
    withEvidenceSnapshot,
};
