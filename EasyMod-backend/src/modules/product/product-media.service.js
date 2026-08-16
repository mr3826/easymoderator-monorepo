'use strict';

/**
 * Product-image storage guard.
 *
 * Product images are deliberately kept on the existing uploads volume. The
 * quota is measured from the volume itself, so files that predate this guard
 * are included and a failed database write cannot leave accounting behind.
 * PostgreSQL's transaction advisory lock makes the check-and-write sequence
 * safe across backend processes; the in-process lock covers SQLite/tests and
 * two requests handled by the same Node process.
 */

const fs = require('fs/promises');
const path = require('path');
const { sequelize } = require('../../utils/database/database-setup');
const { Product } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');
const {
    parseDataUrl,
    saveDataUrlImage,
    UPLOAD_ROOT,
} = require('../../utils/image-upload.service');

const logger = createLogger('ProductMedia');
const PRODUCT_IMAGE_SUBDIR = 'product-images';
const DEFAULT_QUOTA_BYTES = 100 * 1024 * 1024;
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
const DISK_FREE_ALERT_RATIO = 0.2;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const processLocks = new Map();

const quotaBytes = () => {
    const configured = Number.parseInt(process.env.PRODUCT_IMAGE_QUOTA_BYTES, 10);
    return Number.isSafeInteger(configured) && configured > 0
        ? configured
        : DEFAULT_QUOTA_BYTES;
};

const assertShopId = (shopId) => {
    if (!SAFE_PATH_SEGMENT.test(String(shopId || ''))) {
        throw new AppError('Invalid shop scope for product media', 400, 'VALIDATION_ERROR');
    }
    return String(shopId);
};

const shopMediaDir = (shopId) => path.join(UPLOAD_ROOT, PRODUCT_IMAGE_SUBDIR, assertShopId(shopId));

const publicPathFromValue = (value) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    const raw = value.trim();
    if (raw.startsWith('/uploads/')) return raw.split(/[?#]/, 1)[0];
    try {
        return new URL(raw).pathname;
    } catch (_) {
        return null;
    }
};

/**
 * Return only local product-image paths belonging to the authenticated shop.
 * Remote image URLs and another tenant's paths never participate in quota or
 * cleanup decisions.
 */
const getProductMediaPaths = (images, imageUrl, shopId) => {
    const scope = assertShopId(shopId);
    const prefix = `/uploads/${PRODUCT_IMAGE_SUBDIR}/${scope}/`;
    const values = [
        ...(Array.isArray(images) ? images : []),
        imageUrl,
    ];
    return [...new Set(values
        .map(publicPathFromValue)
        .filter((value) => value && value.startsWith(prefix))
        .filter((value) => !value.includes('..'))
        .map((value) => value.replace(/\\/g, '/'))
        .filter((value) => {
            const relative = value.slice('/uploads/'.length).split('/');
            return relative.length === 3 && relative[0] === PRODUCT_IMAGE_SUBDIR
                && relative[1] === scope && Boolean(relative[2]);
        }))];
};

const absolutePathForPublicPath = (publicPath, shopId) => {
    const paths = getProductMediaPaths([publicPath], null, shopId);
    if (paths.length !== 1) return null;
    const absolute = path.resolve(UPLOAD_ROOT, paths[0].slice('/uploads/'.length));
    if (!absolute.startsWith(`${UPLOAD_ROOT}${path.sep}`)) return null;
    return absolute;
};

const getDirectorySize = async (directory) => {
    let entries;
    try {
        entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return 0;
        throw error;
    }

    let total = 0;
    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) total += await getDirectorySize(entryPath);
        else if (entry.isFile()) total += (await fs.stat(entryPath)).size;
    }
    return total;
};

const withProcessLock = async (shopId, callback) => {
    const previous = processLocks.get(shopId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const lock = previous.then(() => current);
    processLocks.set(shopId, lock);
    await previous;
    try {
        return await callback();
    } finally {
        release();
        if (processLocks.get(shopId) === lock) processLocks.delete(shopId);
    }
};

const lockPostgresShop = async (shopId, transaction) => {
    if (typeof sequelize.query !== 'function' || typeof sequelize.getDialect !== 'function') return;
    if (sequelize.getDialect() !== 'postgres') return;
    await sequelize.query(
        'SELECT pg_advisory_xact_lock(hashtext(:shopId))',
        { replacements: { shopId }, transaction }
    );
};

const logDiskMetric = async (shopId, usedBytes) => {
    const configuredQuota = quotaBytes();
    logger.info('product_media_storage_metric', {
        shopId,
        usedBytes,
        quotaBytes: configuredQuota,
        usageRatio: Number((usedBytes / configuredQuota).toFixed(4)),
    });

    if (typeof fs.statfs !== 'function') return;
    try {
        const stats = await fs.statfs(UPLOAD_ROOT);
        const totalBytes = Number(stats.blocks) * Number(stats.bsize);
        const freeBytes = Number(stats.bavail) * Number(stats.bsize);
        if (totalBytes > 0 && freeBytes / totalBytes < DISK_FREE_ALERT_RATIO) {
            logger.warn('product_media_disk_threshold', {
                freeBytes,
                totalBytes,
                freeRatio: Number((freeBytes / totalBytes).toFixed(4)),
                thresholdRatio: DISK_FREE_ALERT_RATIO,
            });
        }
    } catch (error) {
        logger.warn('product_media_disk_metric_unavailable', { error: error.message });
    }
};

/** Store a product image only after the tenant quota has been checked. */
const storeProductImage = async ({ dataUrl, shopId, maxBytes }) => {
    const scope = assertShopId(shopId);
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
        throw new AppError('Image must be a base64 data URL', 400, 'VALIDATION_ERROR');
    }
    const bytes = parsed.buffer.length;
    return withProcessLock(scope, async () => {
        const transaction = await sequelize.transaction();
        let stored;
        try {
            await lockPostgresShop(scope, transaction);
            const currentBytes = await getDirectorySize(shopMediaDir(scope));
            if (currentBytes + bytes > quotaBytes()) {
                logger.warn('product_media_quota_rejected', {
                    shopId: scope,
                    currentBytes,
                    requestedBytes: bytes,
                    quotaBytes: quotaBytes(),
                });
                throw new AppError(
                    'Product image storage quota exceeded',
                    413,
                    'PRODUCT_IMAGE_QUOTA_EXCEEDED',
                    { quotaBytes: quotaBytes() }
                );
            }

            stored = await saveDataUrlImage({
                dataUrl,
                shopId: scope,
                subdir: PRODUCT_IMAGE_SUBDIR,
                maxBytes,
            });
            await transaction.commit();
            await logDiskMetric(scope, currentBytes + stored.bytes);
            return stored;
        } catch (error) {
            try { await transaction.rollback(); } catch (_) { /* best effort */ }
            if (stored?.absolutePath) {
                try { await fs.rm(stored.absolutePath, { force: true }); } catch (_) { /* cleanup retries later */ }
            }
            throw error;
        }
    });
};

const extractProductPathsFromRow = (row, shopId) => getProductMediaPaths(
    row?.images,
    row?.image_url,
    shopId
);

const findReferencedProductPaths = async (shopId, excludeProductId = null) => {
    const where = { shop_id: shopId };
    const rows = await Product.findAll({
        where,
        attributes: ['id', 'images', 'image_url'],
    });
    const paths = new Set();
    for (const row of rows || []) {
        if (excludeProductId && String(row.id) === String(excludeProductId)) continue;
        for (const item of extractProductPathsFromRow(row, shopId)) paths.add(item);
    }
    return paths;
};

/** Remove local files that are no longer referenced by a live product. */
const removeUnreferencedProductMedia = async ({ shopId, images, imageUrl, excludeProductId = null }) => {
    const scope = assertShopId(shopId);
    const candidates = getProductMediaPaths(images, imageUrl, scope);
    if (candidates.length === 0) return { removed: 0, bytes: 0 };

    let referenced;
    try {
        referenced = await findReferencedProductPaths(scope, excludeProductId);
    } catch (error) {
        logger.warn('product_media_reference_check_failed', { shopId: scope, error: error.message });
        return { removed: 0, bytes: 0, deferred: candidates.length };
    }

    let removed = 0;
    let bytes = 0;
    for (const publicPath of candidates) {
        if (referenced.has(publicPath)) continue;
        const absolutePath = absolutePathForPublicPath(publicPath, scope);
        if (!absolutePath) continue;
        try {
            const stat = await fs.stat(absolutePath);
            await fs.rm(absolutePath, { force: true });
            removed += 1;
            bytes += stat.size;
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.warn('product_media_delete_deferred', { shopId: scope, error: error.message });
            }
        }
    }

    if (removed > 0) {
        const remaining = await getDirectorySize(shopMediaDir(scope));
        logger.info('product_media_cleanup', { shopId: scope, removed, bytes, remainingBytes: remaining });
        await logDiskMetric(scope, remaining);
    }
    return { removed, bytes };
};

const listFiles = async (directory) => {
    let entries;
    try {
        entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    const files = [];
    for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await listFiles(absolute));
        else if (entry.isFile()) files.push(absolute);
    }
    return files;
};

/** Remove abandoned uploads after the grace period; safe to run repeatedly. */
const cleanupProductMediaOrphans = async ({ shopId = null, olderThanMs = ORPHAN_GRACE_MS } = {}) => {
    const scopes = shopId
        ? [assertShopId(shopId)]
        : await fs.readdir(path.join(UPLOAD_ROOT, PRODUCT_IMAGE_SUBDIR), { withFileTypes: true })
            .then((entries) => entries.filter((entry) => entry.isDirectory() && SAFE_PATH_SEGMENT.test(entry.name)).map((entry) => entry.name))
            .catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));

    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    let bytes = 0;
    for (const scope of scopes) {
        const referenced = await findReferencedProductPaths(scope);
        const files = await listFiles(shopMediaDir(scope));
        for (const absolutePath of files) {
            const stat = await fs.stat(absolutePath);
            const relative = path.relative(UPLOAD_ROOT, absolutePath).split(path.sep).join('/');
            const publicPath = `/uploads/${relative}`;
            if (stat.mtimeMs >= cutoff || referenced.has(publicPath)) continue;
            try {
                await fs.rm(absolutePath, { force: true });
                removed += 1;
                bytes += stat.size;
            } catch (error) {
                logger.warn('product_media_orphan_delete_deferred', { shopId: scope, error: error.message });
            }
        }
        await logDiskMetric(scope, await getDirectorySize(shopMediaDir(scope)));
    }
    logger.info('product_media_orphan_sweep', { removed, bytes, scopes: scopes.length });
    return { removed, bytes, scopes: scopes.length };
};

module.exports = {
    DEFAULT_QUOTA_BYTES,
    ORPHAN_GRACE_MS,
    PRODUCT_IMAGE_SUBDIR,
    cleanupProductMediaOrphans,
    getProductMediaPaths,
    getDirectorySize,
    removeUnreferencedProductMedia,
    storeProductImage,
    quotaBytes,
};
