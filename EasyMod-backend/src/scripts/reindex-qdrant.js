'use strict';

/**
 * Qdrant reindex CLI
 * ------------------
 * Rebuilds the Qdrant vector store from the current database state by running
 * the knowledge auto-index job (business info + FAQs + products + knowledge
 * docs) for every active shop, or a single shop with --shop=<id>.
 *
 * Why this exists: the auto-index job (src/modules/knowledge/auto-index.job.js)
 * had no entry point, so after standardizing on Qdrant (Pinecone removed
 * 2026-05-31) and seeding starter FAQs there was no way to (re)populate the
 * collection. This gives ops a single idempotent command.
 *
 * Idempotent: every document is upserted under a deterministic id
 * (faq-<id>, product-<id>, kdoc-<id>, biz-<shopId>), so re-running overwrites
 * rather than duplicating. It does NOT delete vectors for removed entities
 * (those are pruned at write time via deletePoint).
 *
 * Usage (on the droplet, inside the api/worker container):
 *   npm run reindex:qdrant                # all active shops
 *   npm run reindex:qdrant -- --shop=<id> # one shop
 *
 * Requires (production): DATABASE_URL, QDRANT_URL, QDRANT_API_KEY,
 * QDRANT_COLLECTION, and an embedding key (GOOGLE_GEMINI_API_KEY / GEMINI_API_KEY).
 * Exit code: 0 on success, 1 if any ingestion errored or bootstrap failed.
 */

require('module-alias/register');
require('dotenv').config();

const env = process.env.NODE_ENV || 'development';

// Force file-based SQLite in development only (mirrors seed-admin.js).
if (!process.env.DATABASE_URL && env !== 'production') {
    process.env.DATABASE_URL = 'sqlite:./database.sqlite';
}

// Load all models before touching the DB.
require('../modules/entities');
const { sequelize } = require('../utils/database/database-setup');
const { run, indexShop } = require('../modules/knowledge/auto-index.job');

function parseShopArg() {
    const arg = process.argv.find((a) => a.startsWith('--shop='));
    return arg ? arg.slice('--shop='.length).trim() : null;
}

async function main() {
    const shopId = parseShopArg();

    console.log('── Qdrant reindex ───────────────────────────────');
    console.log(`  env:        ${env}`);
    console.log(`  qdrantUrl:  ${process.env.QDRANT_URL || 'http://localhost:6333 (default)'}`);
    console.log(`  collection: ${process.env.QDRANT_COLLECTION || 'knowledge_documents (default)'}`);
    console.log(`  perTenant:  ${process.env.QDRANT_PER_TENANT === 'true'}`);
    console.log(`  scope:      ${shopId ? `single shop ${shopId}` : 'all active shops'}`);
    console.log('─────────────────────────────────────────────────');

    if (!process.env.QDRANT_URL) {
        console.warn('⚠️  QDRANT_URL is not set — defaulting to http://localhost:6333. '
            + 'Set it to the production Qdrant before running against prod.');
    }
    if (!process.env.GOOGLE_GEMINI_API_KEY && !process.env.GEMINI_API_KEY) {
        console.warn('⚠️  No embedding key found (GOOGLE_GEMINI_API_KEY / GEMINI_API_KEY). '
            + 'Embeddings will fail and every document will be skipped.');
    }

    try {
        await sequelize.authenticate();
    } catch (dbErr) {
        const detail = dbErr.original ? `${dbErr.original.code || ''} ${dbErr.original.message || ''}`.trim() : '';
        throw new Error(`database connection failed: ${dbErr.message || detail || 'unknown error'}${detail ? ` (${detail})` : ''}`);
    }

    const started = Date.now();
    let result;
    if (shopId) {
        const { indexed, errors } = await indexShop(shopId);
        result = { shops: 1, documents: indexed, errors };
    } else {
        result = await run();
    }

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log('─────────────────────────────────────────────────');
    console.log(`  shops:     ${result.shops}`);
    console.log(`  indexed:   ${result.documents} documents`);
    console.log(`  errors:    ${result.errors}`);
    console.log(`  duration:  ${secs}s`);
    console.log('─────────────────────────────────────────────────');

    return result.errors > 0 ? 1 : 0;
}

main()
    .then(async (code) => {
        await sequelize.close().catch(() => {});
        console.log(code === 0 ? '✅ Reindex complete.' : '⚠️  Reindex finished with errors (see above).');
        process.exit(code);
    })
    .catch(async (err) => {
        console.error('❌ Reindex failed:', err.message || err.code || String(err));
        if (process.env.DEBUG) console.error(err.stack);
        await sequelize.close().catch(() => {});
        process.exit(1);
    });
