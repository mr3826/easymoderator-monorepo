#!/usr/bin/env node
'use strict';

/**
 * Product search-attribute backfill.
 *
 * Populates the ai_* columns (ai_search_text, ai_category, ai_color_primary,
 * ai_material, ai_tags, ai_description) that product-search.service ranks on.
 *
 * WHY THIS EXISTS: processProduct used to bail out for any product without an
 * image, and until the product-image upload endpoint shipped, no product had
 * one. So ai_processed_at is NULL for effectively every product in production,
 * and the full-text search that ranks on those columns has been running on
 * name/name_bn/category alone. Customer-photo matching cannot work at all until
 * this is run once: extracting "red cotton saree" from a photo matches it
 * against an empty attribute set.
 *
 * Attributes are derived from the merchant's own text (name, category, brand,
 * sku, tags, description) — no vision call, no provider cost, no rate-limit
 * exposure — unless AI_VISION_ENABLED=true, which is not the default and is not
 * recommended here. See vision-policy.service.js.
 *
 * Usage (run from EasyMod-backend/, with the same env as the API):
 *   node scripts/backfill-product-attributes.js                 # every shop, pending only
 *   node scripts/backfill-product-attributes.js --shop=<uuid>   # one shop
 *   node scripts/backfill-product-attributes.js --all           # re-derive even if already processed
 *   node scripts/backfill-product-attributes.js --limit=500     # per-shop cap (default 5000)
 *
 * Exit code 0 = every product processed; 1 = at least one failed.
 */

try { require('dotenv').config(); } catch (_) { /* dotenv optional */ }

const { QueryTypes } = require('sequelize');
const { sequelize } = require('../src/utils/database/database-setup');
require('../src/modules/entities'); // register models + associations
const { processProduct } = require('../src/modules/product/product-ai.service');
const { visionEnabled } = require('../src/modules/ai/vision-policy.service');

// ── Flags ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);
const getOpt = (name, def) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : def;
};
const ONLY_SHOP = getOpt('shop', null);
const REDO_ALL = hasFlag('all');
const LIMIT = parseInt(getOpt('limit', '5000'), 10);

// Vision runs one provider call per product and is subject to the Gemini rate
// limit; text derivation is a pure function. Only pace the loop when it costs.
const DELAY_MS = visionEnabled() ? 200 : 0;

async function shopsToProcess() {
    if (ONLY_SHOP) return [ONLY_SHOP];
    const rows = await sequelize.query(
        `SELECT DISTINCT shop_id FROM products WHERE is_active = true AND deleted_at IS NULL`,
        { type: QueryTypes.SELECT }
    );
    return rows.map((r) => r.shop_id).filter(Boolean);
}

async function productIdsFor(shopId) {
    const rows = await sequelize.query(
        `SELECT id FROM products
          WHERE shop_id = :shopId
            AND is_active = true
            AND deleted_at IS NULL
            ${REDO_ALL ? '' : 'AND ai_processed_at IS NULL'}
          ORDER BY created_at DESC
          LIMIT :limit`,
        { type: QueryTypes.SELECT, replacements: { shopId, limit: LIMIT } }
    );
    return rows.map((r) => r.id);
}

(async () => {
    console.log(`\nProduct attribute backfill — source: ${visionEnabled() ? 'VISION (billed per product)' : 'text (free)'}`);
    console.log(`mode: ${REDO_ALL ? 'ALL products' : 'pending only (ai_processed_at IS NULL)'}`);
    console.log('='.repeat(72));

    let totalOk = 0;
    let totalFail = 0;

    const shops = await shopsToProcess();
    if (!shops.length) {
        console.log('No shops with active products found.');
        await sequelize.close();
        process.exit(0);
    }

    for (const shopId of shops) {
        const ids = await productIdsFor(shopId);
        if (!ids.length) {
            console.log(`${shopId}  —  nothing to do`);
            continue;
        }

        let ok = 0;
        let fail = 0;
        for (const id of ids) {
            /* eslint-disable no-await-in-loop */
            try {
                if (await processProduct(id, shopId)) ok++;
                else fail++;
            } catch (err) {
                fail++;
                console.error(`  ${id}: ${err.message}`);
            }
            if (DELAY_MS) await new Promise((r) => setTimeout(r, DELAY_MS));
            /* eslint-enable no-await-in-loop */
        }

        totalOk += ok;
        totalFail += fail;
        console.log(`${shopId}  —  ${ok}/${ids.length} processed${fail ? `, ${fail} FAILED` : ''}`);
    }

    console.log('='.repeat(72));
    console.log(`Done: ${totalOk} processed, ${totalFail} failed.`);
    if (totalFail) {
        console.log('\nA failure here leaves that product unsearchable by attribute — it can');
        console.log('still be found by name. Re-run to retry; the pending filter skips successes.');
    }

    await sequelize.close();
    process.exit(totalFail ? 1 : 0);
})().catch(async (err) => {
    console.error('\nBackfill aborted:', err.message);
    try { await sequelize.close(); } catch (_) { /* already closed */ }
    process.exit(1);
});
