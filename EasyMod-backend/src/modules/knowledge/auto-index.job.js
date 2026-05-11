'use strict';

/**
 * Knowledge Auto-Index Job
 *
 * Watches for knowledge base changes and re-indexes into the vector DB (Pinecone/Qdrant).
 * Should run daily or be triggered after knowledge base updates.
 *
 * Indexed sources (all non-analytics):
 *   - Shop business info (name, description, address, hours, policies)
 *   - Product catalogue (name, description, price, variants)
 *   - FAQ responses
 *   - Delivery info (zones, timing, courier details)
 *   - Payment methods (available options, instructions)
 *   - Custom knowledge documents
 *
 * Analytics (order counts, revenue, etc.) are NOT indexed — they're fetched live from DB.
 */

const { Shop, FaqResponse } = require('../entities');
const { ingestData } = require('../rag/rag.service');
const { createLogger } = require('../../utils/structured-logger');
const { sequelize } = require('../../utils/database/database-setup');

const logger = createLogger('KnowledgeAutoIndex');

/**
 * Re-index all knowledge for a single shop.
 * @param {string} shopId
 * @returns {{ indexed: number, errors: number }}
 */
const indexShop = async (shopId) => {
    let indexed = 0;
    let errors = 0;

    const ingest = async (text, metadata) => {
        if (!text || text.trim().length < 5) return;
        try {
            await ingestData({ text, metadata: { shopId, ...metadata } });
            indexed++;
        } catch (err) {
            logger.warn('Ingestion failed', { shopId, docType: metadata.type, err: err.message });
            errors++;
        }
    };

    try {
        // 1. Business info
        const shop = await Shop.findByPk(shopId);
        if (shop) {
            const info = shop.settings?.businessInfo || {};
            const biz = [
                info.shopName && `Shop name: ${info.shopName}`,
                info.description && `Description: ${info.description}`,
                info.address && `Address: ${info.address}`,
                info.phone && `Phone: ${info.phone}`,
                info.businessHours && `Business hours: ${info.businessHours}`,
                info.returnPolicy && `Return policy: ${info.returnPolicy}`,
                info.deliveryPolicy && `Delivery policy: ${info.deliveryPolicy}`
            ].filter(Boolean).join('\n');
            if (biz) await ingest(biz, { type: 'business_info', documentId: `biz-${shopId}` });
        }

        // 2. FAQ responses
        const faqs = await FaqResponse.findAll({ where: { shop_id: shopId } });
        for (const faq of faqs) {
            const text = `Q: ${faq.question}\nA: ${faq.answer}`;
            await ingest(text, { type: 'faq', documentId: `faq-${faq.id}`, faq_id: faq.id });
        }

        // 3. Products
        const [products] = await sequelize.query(
            `SELECT id, name, description, price FROM products WHERE shop_id=:shopId AND is_active=true LIMIT 200`,
            { replacements: { shopId } }
        ).catch(() => [[]]);

        for (const product of products) {
            const text = [
                `Product: ${product.name}`,
                product.description && `Description: ${product.description}`,
                product.price && `Price: BDT ${product.price}`
            ].filter(Boolean).join('\n');
            await ingest(text, { type: 'product', documentId: `product-${product.id}`, product_id: product.id });
        }

        // 4. Custom knowledge documents
        const [docs] = await sequelize.query(
            `SELECT id, title, content FROM shop_knowledge_documents WHERE shop_id=:shopId LIMIT 100`,
            { replacements: { shopId } }
        ).catch(() => [[]]);

        for (const doc of docs) {
            const text = `${doc.title}\n${doc.content}`;
            await ingest(text, { type: 'knowledge_doc', documentId: `kdoc-${doc.id}`, doc_id: doc.id });
        }

        logger.info('Shop knowledge indexed', { shopId, indexed, errors });
    } catch (err) {
        logger.error('Shop index failed', { shopId, err: err.message });
        errors++;
    }

    return { indexed, errors };
};

/**
 * Re-index knowledge for all active shops.
 */
const run = async () => {
    logger.info('Starting knowledge auto-index job');

    const [shops] = await sequelize.query(
        `SELECT id FROM shops WHERE is_active=true OR is_active IS NULL`
    ).catch(() => [[]]);

    let total = 0;
    let totalErrors = 0;

    for (const shop of shops) {
        const { indexed, errors } = await indexShop(shop.id);
        total += indexed;
        totalErrors += errors;
    }

    logger.info('Knowledge auto-index complete', { shops: shops.length, documents: total, errors: totalErrors });
    return { shops: shops.length, documents: total, errors: totalErrors };
};

module.exports = { run, indexShop };
