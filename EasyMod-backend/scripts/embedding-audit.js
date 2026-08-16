#!/usr/bin/env node
'use strict';

/**
 * Embedding audit + backfill — answers "is my catalog actually embedded?" and
 * fixes the gaps.
 *
 * For each shop it compares active products in PostgreSQL against the product
 * points present in Qdrant, reports coverage, and (with --backfill) re-embeds
 * the missing ones. It also prints the EFFECTIVE embedding provider plus a live
 * probe, so a silent "running on the non-semantic local fallback" — the #1
 * cause of the chatbot hallucinating — is impossible to miss.
 *
 * Usage (run from EasyMod-backend/, with the same env as the API):
 *   node scripts/embedding-audit.js                    # audit every shop
 *   node scripts/embedding-audit.js --shop=<uuid>      # audit one shop
 *   node scripts/embedding-audit.js --backfill         # re-embed MISSING products
 *   node scripts/embedding-audit.js --all --backfill   # re-embed ALL products
 *   node scripts/embedding-audit.js --limit=500        # per-shop product cap (default 1000)
 *
 * Exit code 0 = clean (or backfill fully succeeded); 1 = backfill had failures.
 */

try { require('dotenv').config(); } catch (_) { /* dotenv optional */ }

const { QueryTypes } = require('sequelize');
const { sequelize } = require('../src/utils/database/database-setup');
require('../src/modules/entities'); // register models + associations
const { getProviderInfo, probe } = require('../src/modules/rag/embedding.service');
const { embedProduct } = require('../src/modules/product/product-embedding.service');

const QDRANT_URL = (process.env.QDRANT_URL || 'http://localhost:6333').replace(/\/$/, '');
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || 'knowledge_documents';
const PER_TENANT = process.env.QDRANT_PER_TENANT === 'true';

const qdrantHeaders = () => {
    const h = { 'Content-Type': 'application/json' };
    if (process.env.QDRANT_API_KEY) h['api-key'] = process.env.QDRANT_API_KEY;
    return h;
};
const collectionFor = (shopId) =>
    (PER_TENANT && shopId) ? `${QDRANT_COLLECTION}_${shopId}` : QDRANT_COLLECTION;

// ── Flags ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);
const getOpt = (name, def) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : def;
};
const ONLY_SHOP = getOpt('shop', null);
const DO_BACKFILL = hasFlag('backfill');
const REINDEX_ALL = hasFlag('all');
const LIMIT = parseInt(getOpt('limit', '1000'), 10);

/**
 * Scroll all product-type points for a shop and collect their product_id payloads.
 * Uses scroll (not point-id lookup) so it works regardless of how point IDs are encoded.
 */
async function embeddedProductIds(shopId) {
    const must = [{ key: 'type', match: { value: 'product' } }];
    if (!PER_TENANT) must.push({ key: 'shopId', match: { value: shopId } });

    const ids = new Set();
    let offset = null;
    /* eslint-disable no-await-in-loop */
    do {
        const res = await fetch(`${QDRANT_URL}/collections/${collectionFor(shopId)}/points/scroll`, {
            method: 'POST',
            headers: qdrantHeaders(),
            body: JSON.stringify({ filter: { must }, with_payload: true, with_vector: false, limit: 256, offset })
        });
        if (!res.ok) {
            return { ids, error: `scroll HTTP ${res.status}` };
        }
        const data = await res.json();
        const points = data?.result?.points || [];
        for (const p of points) {
            const pid = p.payload && p.payload.product_id;
            if (pid) ids.add(String(pid));
        }
        offset = data?.result?.next_page_offset || null;
    } while (offset);
    /* eslint-enable no-await-in-loop */
    return { ids };
}

async function shopsToAudit() {
    if (ONLY_SHOP) return [ONLY_SHOP];
    const rows = await sequelize.query(
        `SELECT DISTINCT shop_id FROM products WHERE is_active = true AND deleted_at IS NULL`,
        { type: QueryTypes.SELECT }
    );
    return rows.map((r) => r.shop_id).filter(Boolean);
}

(async () => {
    console.log(`\nEmbedding audit — ${QDRANT_URL} / collection=${QDRANT_COLLECTION}${PER_TENANT ? ' (per-tenant)' : ''}`);
    console.log('='.repeat(72));

    // Provider self-check — surfaces the silent local-fallback failure mode.
    const info = getProviderInfo();
    const pr = await probe();
    console.log(`Embedding provider: configured=${info.configured} effective=${info.effective} `
        + `semantic=${info.semantic} keyPresent=${info.keyPresent} vectorSize=${info.vectorSize}`);
    console.log(`Probe: ok=${pr.ok} dims=${pr.dimensions}${pr.error ? ` error=${pr.error}` : ''}`);
    if (!info.semantic) {
        console.log('⚠️  NON-SEMANTIC embeddings in effect — retrieval will be near-random and the AI will hallucinate.');
        console.log('    Set EMBEDDING_PROVIDER=gemini (+GEMINI_API_KEY), =openai (+OPENAI_API_KEY), or =gcp/http (+EMBEDDING_API_URL), then re-run with --all --backfill.');
    }
    console.log('-'.repeat(72));

    await sequelize.authenticate();

    const shops = await shopsToAudit();
    if (!shops.length) {
        console.log('No shops with active products found.');
        await sequelize.close().catch(() => {});
        process.exit(0);
    }

    let totalProducts = 0, totalEmbedded = 0, totalMissing = 0;
    let totalBackfilled = 0, totalBackfillFailed = 0;

    for (const shopId of shops) {
        const products = await sequelize.query(
            `SELECT id FROM products
             WHERE shop_id = :shopId AND is_active = true AND deleted_at IS NULL
             ORDER BY created_at DESC LIMIT :limit`,
            { replacements: { shopId, limit: LIMIT }, type: QueryTypes.SELECT }
        );
        const dbIds = products.map((p) => String(p.id));
        const { ids: embedded, error } = await embeddedProductIds(shopId);

        const missingIds = dbIds.filter((id) => !embedded.has(id));
        const presentCount = dbIds.length - missingIds.length;
        const cov = dbIds.length ? Math.round((presentCount / dbIds.length) * 100) : 100;

        totalProducts += dbIds.length;
        totalEmbedded += presentCount;
        totalMissing += missingIds.length;

        console.log(`shop ${shopId}: ${presentCount}/${dbIds.length} embedded (${cov}%)`
            + `${error ? `  [qdrant: ${error}]` : ''}${missingIds.length ? `  missing=${missingIds.length}` : ''}`);

        if (DO_BACKFILL) {
            const targets = REINDEX_ALL ? dbIds : missingIds;
            let ok = 0, fail = 0;
            for (const id of targets) {
                const done = await embedProduct(id, shopId).catch(() => false);
                if (done) ok++; else fail++;
            }
            totalBackfilled += ok;
            totalBackfillFailed += fail;
            if (targets.length) {
                console.log(`   backfill: re-embedded ${ok}/${targets.length}${fail ? `, ${fail} failed` : ''}`);
            }
        }
    }

    console.log('-'.repeat(72));
    console.log(`TOTAL: ${totalEmbedded}/${totalProducts} embedded, ${totalMissing} missing across ${shops.length} shop(s).`);
    if (DO_BACKFILL) {
        console.log(`Backfill: ${totalBackfilled} re-embedded${totalBackfillFailed ? `, ${totalBackfillFailed} FAILED` : ''}.`);
    } else if (totalMissing) {
        console.log(`Run with --backfill to embed the ${totalMissing} missing product(s).`);
    }

    await sequelize.close().catch(() => {});
    process.exit(totalBackfillFailed > 0 ? 1 : 0);
})().catch((err) => {
    console.error('Embedding audit failed:', err.message);
    process.exit(1);
});
