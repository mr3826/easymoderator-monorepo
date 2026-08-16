'use strict';

const { buildEmbeddingText } = require('../product/product-embedding-text');

// These are PostgreSQL source relations. The Qdrant collection name is
// deliberately absent: a vector-store identifier is not a database table.
const SOURCE_TABLES = Object.freeze(['shops', 'faq_responses', 'products']);

const SOURCE_COUNT_RULE =
    'one row per non-empty business-info source, active FAQ, or active product selected by reindex:qdrant; products are capped at 200 per shop';

// Keep the selection SQL in one place. The reindex job and the proof runner
// both consume this module so the source-count contract cannot drift.
const SOURCE_QUERIES = Object.freeze({
    requiredRelations: `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
        ORDER BY table_name
    `,
    activeShops: `
        SELECT id, settings
        FROM shops
        WHERE is_active = true OR is_active IS NULL
        ORDER BY id
    `,
    shopById: `
        SELECT id, settings
        FROM shops
        WHERE id = $1
    `,
    activeFaqs: `
        SELECT id, shop_id, category, template_bn, template_en
        FROM faq_responses
        WHERE shop_id = $1 AND is_active = true
        ORDER BY priority DESC, id
    `,
    activeProducts: `
        SELECT id, shop_id, name, name_bn, category, description, variants, tags,
               ai_description, ai_tags, ai_category, ai_color_primary,
               ai_material, ai_attributes, image_url, sku
        FROM products
        WHERE shop_id = $1 AND is_active = true
        ORDER BY id
        LIMIT 200
    `,
});

const readRows = async (query, sql, values = []) => {
    const result = await query(sql, values);
    if (Array.isArray(result)) return result[0] || [];
    if (Array.isArray(result?.rows)) return result.rows;
    throw new Error('PostgreSQL source query returned no row set');
};

const objectValue = (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_) {
            return {};
        }
    }
    return {};
};

const buildBusinessInfoIndexText = (businessInfo = {}) => [
    businessInfo.shopName && `Shop name: ${businessInfo.shopName}`,
    businessInfo.description && `Description: ${businessInfo.description}`,
    businessInfo.address && `Address: ${businessInfo.address}`,
    businessInfo.phone && `Phone: ${businessInfo.phone}`,
    (businessInfo.openingHours || businessInfo.businessHours)
        && `Business hours: ${businessInfo.openingHours || businessInfo.businessHours}`,
    businessInfo.additionalInfo && `Additional shop owner info: ${businessInfo.additionalInfo}`,
    ...Object.entries(objectValue(businessInfo.socialLinks))
        .filter(([, value]) => typeof value === 'string' && value.trim())
        .map(([key, value]) => `${key}: ${value.trim()}`),
    businessInfo.returnPolicy && `Return policy: ${businessInfo.returnPolicy}`,
    businessInfo.deliveryPolicy && `Delivery policy: ${businessInfo.deliveryPolicy}`,
].filter(Boolean).join('\n');

const buildFaqIndexText = (faq = {}) => [
    faq.category && `Q: ${faq.category}`,
    faq.template_bn && `A (BN): ${faq.template_bn}`,
    faq.template_en && `A (EN): ${faq.template_en}`,
].filter(Boolean).join('\n');

const assertRequiredSourceRelations = async (query) => {
    const rows = await readRows(query, SOURCE_QUERIES.requiredRelations, [SOURCE_TABLES]);
    const present = new Set(rows.map((row) => row.table_name));
    const missing = SOURCE_TABLES.filter((table) => !present.has(table));
    if (missing.length) {
        throw new Error(`missing PostgreSQL source relation(s): ${missing.join(', ')}`);
    }
    return true;
};

const getActiveShopRows = (query) => readRows(query, SOURCE_QUERIES.activeShops);

const collectShopSources = async (query, shopId, existingShop = null) => {
    const shop = existingShop || (await readRows(query, SOURCE_QUERIES.shopById, [shopId]))[0];
    const sources = [];

    const businessInfo = objectValue(shop?.settings)?.businessInfo;
    const businessText = buildBusinessInfoIndexText(objectValue(businessInfo));
    if (businessText.trim().length >= 5) {
        sources.push({
            kind: 'business_info',
            id: shopId,
            shopId,
            text: businessText,
            metadata: { type: 'business_info', documentId: `biz-${shopId}` },
        });
    }

    const faqs = await readRows(query, SOURCE_QUERIES.activeFaqs, [shopId]);
    for (const faq of faqs) {
        const text = buildFaqIndexText(faq);
        if (text.trim().length < 5) continue;
        sources.push({
            kind: 'faq',
            id: faq.id,
            shopId,
            text,
            metadata: { type: 'faq', documentId: `faq-${faq.id}`, faq_id: faq.id },
        });
    }

    const products = await readRows(query, SOURCE_QUERIES.activeProducts, [shopId]);
    for (const product of products) {
        const text = buildEmbeddingText(product);
        if (text.trim().length < 5) continue;
        sources.push({
            kind: 'product',
            id: product.id,
            shopId,
            text,
            metadata: {
                type: 'product',
                documentId: `product:${product.id}`,
                product_id: product.id,
                product_name: product.name,
                image_url: product.image_url || null,
                stock_key: `stock:${shopId}:${product.id}`,
            },
        });
    }

    // Custom document writes persist only metadata in shops.settings.documents;
    // their text is not reconstructible by the bulk reindex path. Do not use the
    // Qdrant collection name as a fallback PostgreSQL table.
    return sources;
};

const collectSourceStats = async (query) => {
    await assertRequiredSourceRelations(query);
    const shops = await getActiveShopRows(query);
    const sources = [];
    for (const shop of shops) {
        sources.push(...await collectShopSources(query, shop.id, shop));
    }
    if (!sources.length) throw new Error('no indexable PostgreSQL sources found');

    return {
        count: sources.length,
        shopIds: [...new Set(sources.map((source) => String(source.shopId)).filter(Boolean))],
        snippets: sources.map((source) => source.text).filter((text) => text && text.trim()),
    };
};

module.exports = {
    SOURCE_TABLES,
    SOURCE_COUNT_RULE,
    SOURCE_QUERIES,
    assertRequiredSourceRelations,
    getActiveShopRows,
    collectShopSources,
    collectSourceStats,
    buildBusinessInfoIndexText,
    buildFaqIndexText,
};
