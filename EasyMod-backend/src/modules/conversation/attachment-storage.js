'use strict';

const crypto = require('crypto');
const path = require('path');
const { PRODUCTION_DEFAULTS, resolvePublicAssetOrigin } = require('../../config/origins');
const config = require('../../config/config');

const ATTACHMENT_URL_TTL_SECONDS = 15 * 60;
const STORAGE_SEGMENT_RE = /^[A-Za-z0-9_-]{1,64}$/;
const FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const ATTACHMENT_ROOT = path.resolve(
    process.env.EASYMOD_UPLOAD_ROOT || path.resolve(__dirname, '../../../uploads'),
    'conversation-attachments',
);

// This marker lets the HTTP write boundary distinguish server-derived metadata
// from a client-supplied metadata object after the normal denylist runs.
const PREPARED_ATTACHMENT_METADATA = Symbol('prepared-attachment-metadata');

function attachmentSigningSecret() {
    return config.csrfSecret || config.sessionSecret || '';
}

function invalidStorageKey() {
    return null;
}

function isSafeFileName(fileName) {
    return typeof fileName === 'string'
        && FILE_NAME_RE.test(fileName)
        && path.posix.basename(fileName) === fileName
        && path.win32.basename(fileName) === fileName
        && !fileName.includes('..');
}

function buildStorageKey(shopId, fileName) {
    const normalizedShopId = String(shopId || '');
    if (!STORAGE_SEGMENT_RE.test(normalizedShopId) || !isSafeFileName(fileName)) {
        throw Object.assign(new Error('Invalid conversation attachment storage key'), {
            code: 'INVALID_ATTACHMENT_STORAGE_KEY',
        });
    }
    return `${normalizedShopId}/${fileName}`;
}

function parseStorageKey(value) {
    if (typeof value !== 'string' || !value || value.length > 320) return invalidStorageKey();
    const parts = value.split('/');
    if (parts.length !== 2) return invalidStorageKey();
    const [shopId, fileName] = parts;
    if (!STORAGE_SEGMENT_RE.test(shopId) || !isSafeFileName(fileName)) {
        return invalidStorageKey();
    }
    return { shopId, fileName };
}

function signAttachmentPath(shopId, fileName, expires) {
    const key = buildStorageKey(shopId, fileName);
    if (!attachmentSigningSecret()) {
        throw Object.assign(new Error('Attachment signing is not configured'), {
            code: 'ATTACHMENT_SIGNING_NOT_CONFIGURED',
        });
    }
    if (!Number.isSafeInteger(expires) || expires < 0) {
        throw Object.assign(new Error('Invalid attachment expiry'), {
            code: 'INVALID_ATTACHMENT_EXPIRY',
        });
    }
    return crypto.createHmac('sha256', attachmentSigningSecret())
        .update(`${key}.${expires}`)
        .digest('hex');
}

function mintAttachmentUrl({
    shopId,
    fileName,
    baseUrl,
    ttlSeconds = ATTACHMENT_URL_TTL_SECONDS,
    now = Math.floor(Date.now() / 1000),
}) {
    const key = buildStorageKey(shopId, fileName);
    if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
        throw Object.assign(new Error('Attachment public base URL is required'), {
            code: 'ATTACHMENT_BASE_URL_MISSING',
        });
    }
    let parsedBase;
    try {
        parsedBase = new URL(baseUrl);
    } catch (_) {
        throw Object.assign(new Error('Invalid attachment public base URL'), {
            code: 'INVALID_ATTACHMENT_BASE_URL',
        });
    }
    if (!['http:', 'https:'].includes(parsedBase.protocol)
        || parsedBase.username
        || parsedBase.password
        || parsedBase.search
        || parsedBase.hash) {
        throw Object.assign(new Error('Invalid attachment public base URL'), {
            code: 'INVALID_ATTACHMENT_BASE_URL',
        });
    }
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0
        || !Number.isSafeInteger(now) || now < 0
        || now + ttlSeconds > Number.MAX_SAFE_INTEGER) {
        throw Object.assign(new Error('Invalid attachment URL lifetime'), {
            code: 'INVALID_ATTACHMENT_TTL',
        });
    }

    const expires = now + ttlSeconds;
    const signature = signAttachmentPath(shopId, fileName, expires);
    const origin = parsedBase.origin;
    const publicPath = `/uploads/conversation-attachments/${key}`;
    return `${origin}${publicPath}?expires=${expires}&signature=${signature}`;
}

function absolutePathForKey(key) {
    const parsed = parseStorageKey(key);
    if (!parsed) return null;
    const absolutePath = path.resolve(ATTACHMENT_ROOT, parsed.shopId, parsed.fileName);
    if (!absolutePath.startsWith(`${ATTACHMENT_ROOT}${path.sep}`)) return null;
    return absolutePath;
}

async function attachmentExists(key) {
    const absolutePath = absolutePathForKey(key);
    if (!absolutePath) return false;
    const fs = require('fs/promises');
    const stat = await fs.stat(absolutePath).catch(() => null);
    return Boolean(stat?.isFile());
}

function allowedLegacyOrigins() {
    const origins = new Set();
    for (const candidate of [resolvePublicAssetOrigin(), PRODUCTION_DEFAULTS.api]) {
        try {
            origins.add(new URL(candidate).origin);
        } catch (_) {
            // Invalid configuration is handled by the normal config validator.
        }
    }
    return origins;
}

function isAllowedLegacyAssetUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    if (value.startsWith('/') && !value.startsWith('//')) return true;
    try {
        return allowedLegacyOrigins().has(new URL(value).origin);
    } catch (_) {
        return false;
    }
}

function recoverStorageKeyFromLegacyUrl(value, { expectedShopId } = {}) {
    if (typeof value !== 'string' || !value.trim()) return null;
    if (!isAllowedLegacyAssetUrl(value)) return null;

    let parsed;
    try {
        if (value.startsWith('/') && !value.startsWith('//')) {
            parsed = new URL(value, 'https://local.invalid');
        } else {
            parsed = new URL(value);
            if (!allowedLegacyOrigins().has(parsed.origin)) return null;
        }
    } catch (_) {
        return null;
    }

    if (!value.startsWith('/') && !allowedLegacyOrigins().has(parsed.origin)) return null;
    if (!parsed.pathname.startsWith('/uploads/')) return null;

    let decodedPath;
    try {
        decodedPath = decodeURIComponent(parsed.pathname.slice('/uploads/'.length))
            .replace(/\\/g, '/');
    } catch (_) {
        return null;
    }
    const parts = decodedPath.split('/');
    if (parts.length !== 3 || parts[0] !== 'conversation-attachments') return null;
    const key = parseStorageKey(`${parts[1]}/${parts[2]}`);
    if (!key) return null;
    if (expectedShopId !== undefined && expectedShopId !== null
        && String(expectedShopId) !== key.shopId) return null;
    return `${key.shopId}/${key.fileName}`;
}

function resolveAttachmentStorageKey(metadata, expectedShopId) {
    const durableKey = metadata?.attachment_storage_key;
    if (durableKey !== undefined && durableKey !== null) {
        const parsed = parseStorageKey(durableKey);
        if (!parsed || parsed.shopId !== String(expectedShopId || '')) return null;
        return `${parsed.shopId}/${parsed.fileName}`;
    }
    if (!expectedShopId) return null;
    for (const candidate of [metadata?.image_url, metadata?.file_url]) {
        const recovered = recoverStorageKeyFromLegacyUrl(candidate, { expectedShopId });
        if (recovered) return recovered;
    }
    return null;
}

function markPreparedAttachmentMetadata(value, metadata) {
    Object.defineProperty(value, PREPARED_ATTACHMENT_METADATA, {
        value: Object.freeze({ ...metadata }),
        enumerable: false,
        configurable: false,
        writable: false,
    });
    return value;
}

module.exports = {
    ATTACHMENT_ROOT,
    ATTACHMENT_URL_TTL_SECONDS,
    FILE_NAME_RE,
    PREPARED_ATTACHMENT_METADATA,
    STORAGE_SEGMENT_RE,
    absolutePathForKey,
    attachmentExists,
    attachmentSigningSecret,
    buildStorageKey,
    markPreparedAttachmentMetadata,
    mintAttachmentUrl,
    isAllowedLegacyAssetUrl,
    parseStorageKey,
    recoverStorageKeyFromLegacyUrl,
    resolveAttachmentStorageKey,
    signAttachmentPath,
};
