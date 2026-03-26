/**
 * API Key Service
 *
 * Shop owners can generate API keys for programmatic/developer access.
 * The raw key is returned ONCE on generation; only the SHA-256 hash is persisted.
 */

const crypto = require('crypto');
const { AppError } = require('../../utils/AppError');
const ApiKey = require('./api-key.entity');

const VALID_SCOPES = [
    'conversations:read',
    'conversations:write',
    'orders:read',
    'orders:write',
    'products:read',
    'products:write',
    'analytics:read',
    'customers:read'
];

/**
 * Hash a raw API key with SHA-256.
 * @param {string} rawKey
 * @returns {string} hex digest
 */
const hashKey = (rawKey) =>
    crypto.createHash('sha256').update(rawKey).digest('hex');

/**
 * Generate a new API key for a shop.
 * Returns the plaintext key ONCE — it is never stored.
 *
 * @param {string} shopId
 * @param {string} name    - Human-readable label
 * @param {string[]} scopes - Array of scope strings
 * @returns {{ key: string, record: object }}
 */
const generateApiKey = async (shopId, name, scopes = []) => {
    if (!name || !name.trim()) throw new AppError('name is required', 400);

    // Validate scopes
    const invalidScopes = scopes.filter(s => !VALID_SCOPES.includes(s));
    if (invalidScopes.length > 0) {
        throw new AppError(
            `Invalid scopes: ${invalidScopes.join(', ')}. Valid: ${VALID_SCOPES.join(', ')}`,
            400
        );
    }

    // Generate cryptographically secure 32-byte key, prefix with "em_" for identifiability
    const rawKey = 'em_' + crypto.randomBytes(32).toString('hex');
    const last4 = rawKey.slice(-4);
    const keyHash = hashKey(rawKey);

    const record = await ApiKey.create({
        shop_id: shopId,
        name: name.trim(),
        key_hash: keyHash,
        last_4: last4,
        scopes,
        is_active: true
    });

    return {
        key: rawKey, // plaintext — returned only once
        record: {
            id: record.id,
            name: record.name,
            last_4: record.last_4,
            scopes: record.scopes,
            is_active: record.is_active,
            created_at: record.created_at
        }
    };
};

/**
 * Validate a raw API key.
 * @param {string} rawKey
 * @returns {{ shopId: string, scopes: string[] } | null}
 */
const validateApiKey = async (rawKey) => {
    if (!rawKey) return null;

    const keyHash = hashKey(rawKey);
    const record = await ApiKey.findOne({
        where: { key_hash: keyHash, is_active: true }
    });

    if (!record) return null;

    // Update last_used_at (fire-and-forget)
    record.update({ last_used_at: new Date() }).catch(() => {});

    return { shopId: record.shop_id, scopes: record.scopes };
};

/**
 * List all API keys for a shop (never returns key_hash).
 * @param {string} shopId
 * @returns {object[]}
 */
const listApiKeys = async (shopId) => {
    const keys = await ApiKey.findAll({
        where: { shop_id: shopId },
        attributes: ['id', 'name', 'last_4', 'scopes', 'is_active', 'last_used_at', 'created_at'],
        order: [['created_at', 'DESC']]
    });
    return keys.map(k => k.toJSON());
};

/**
 * Revoke an API key (soft-delete via is_active = false).
 * @param {string} shopId
 * @param {string} keyId
 */
const revokeApiKey = async (shopId, keyId) => {
    const record = await ApiKey.findOne({ where: { id: keyId, shop_id: shopId } });
    if (!record) throw new AppError('API key not found', 404);
    await record.update({ is_active: false });
    return { revoked: true };
};

module.exports = { generateApiKey, validateApiKey, listApiKeys, revokeApiKey, VALID_SCOPES };
