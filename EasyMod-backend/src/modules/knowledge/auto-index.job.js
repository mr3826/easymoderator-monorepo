'use strict';

/**
 * Knowledge Auto-Index Job
 *
 * Watches for knowledge base changes and re-indexes into the vector DB (Qdrant).
 * Should run daily or be triggered after knowledge base updates.
 *
 * Indexed sources (all non-analytics):
 *   - Shop business info (name, description, address, hours, policies)
 *   - Product catalogue (name, description, price, variants)
 *   - FAQ responses
 *   - Delivery info (zones, timing, courier details)
 *   - Payment methods (available options, instructions)
 *   - Custom knowledge documents are not part of the deterministic bulk
 *     reindex contract because their request text is not persisted in Postgres.
 *
 * Analytics (order counts, revenue, etc.) are NOT indexed — they're fetched live from DB.
 */

const { ingestData } = require('../rag/rag.service');
const { createLogger } = require('../../utils/structured-logger');
const { sequelize } = require('../../utils/database/database-setup');
const {
    assertRequiredSourceRelations,
    getActiveShopRows,
    collectShopSources,
} = require('./index-source.contract');

const logger = createLogger('KnowledgeAutoIndex');

const queryRows = async (sql, bind = []) => {
    const [rows] = await sequelize.query(sql, { bind });
    return { rows };
};

/**
 * Re-index all knowledge for a single shop.
 * @param {string} shopId
 * @returns {{ indexed: number, errors: number, sourceCount: number }}
 */
const indexShop = async (shopId, { existingShop = null, skipRelationCheck = false } = {}) => {
    if (!skipRelationCheck) await assertRequiredSourceRelations(queryRows);
    let indexed = 0;
    let errors = 0;
    let sources = [];

    const ingest = async (text, metadata) => {
        if (!text || text.trim().length < 5) return;
        try {
            // ingestData swallows vector-store failures and returns { success:false }
            // (so an incremental FAQ/product write never breaks on a Qdrant blip).
            // For a reindex we must treat that as an error, not a silent success.
            const res = await ingestData({ text, metadata: { shopId, ...metadata } });
            if (res && res.success) {
                indexed++;
            } else {
                logger.warn('Ingestion reported failure', { shopId, docType: metadata.type, reason: res && res.message });
                errors++;
            }
        } catch (err) {
            logger.warn('Ingestion failed', { shopId, docType: metadata.type, err: err.message });
            errors++;
        }
    };

    try {
        sources = await collectShopSources(queryRows, shopId, existingShop);
        const { embedProduct } = require('../product/product-embedding.service');
        for (const source of sources) {
            if (source.kind === 'product') {
                try {
                    const ok = await embedProduct(source.id, shopId);
                    if (ok) { indexed++; } else { errors++; }
                } catch (err) {
                    logger.warn('Product embedding failed', { shopId, productId: source.id, err: err.message });
                    errors++;
                }
                continue;
            }
            await ingest(source.text, source.metadata);
        }

        logger.info('Shop knowledge indexed', { shopId, indexed, errors });
    } catch (err) {
        logger.error('Shop index failed', { shopId, err: err.message });
        errors++;
    }

    return { indexed, errors, sourceCount: sources?.length || 0 };
};

/**
 * Re-index knowledge for all active shops.
 */
const run = async () => {
    logger.info('Starting knowledge auto-index job');

    await assertRequiredSourceRelations(queryRows);
    const shops = await getActiveShopRows(queryRows);

    let total = 0;
    let totalErrors = 0;
    let totalSources = 0;

    for (const shop of shops) {
        const { indexed, errors, sourceCount } = await indexShop(shop.id, {
            existingShop: shop,
            skipRelationCheck: true,
        });
        total += indexed;
        totalErrors += errors;
        totalSources += sourceCount;
    }

    if (totalSources === 0) throw new Error('no indexable PostgreSQL sources found');

    logger.info('Knowledge auto-index complete', { shops: shops.length, documents: total, errors: totalErrors });
    return { shops: shops.length, documents: total, errors: totalErrors };
};

module.exports = { run, indexShop };
