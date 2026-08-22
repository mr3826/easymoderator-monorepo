#!/usr/bin/env node
'use strict';

/**
 * Automated retrieval-quality evaluation for EasyModerator.
 *
 *   node scripts/retrieval-eval/run-eval.js [options]
 *
 *     --pg=<url>        Postgres URL for the SCRATCH eval database.
 *                       Default: postgresql://postgres:postgres@localhost:5432/postgres
 *                       A throwaway database (easymod_retrieval_eval) is created,
 *                       used, and dropped. Never point this at production.
 *     --engines=a,b,c   Subset of: sql_fts, local_vector, production,
 *                       gemini_semantic, hybrid   (default: all available)
 *     --no-gemini       Skip every engine that needs the Gemini embedding API.
 *     --refresh-cache   Ignore the on-disk embedding cache and re-embed.
 *     --out=<dir>       Where to write results (default: docs/ai-cost/evidence)
 *
 * The SQL engine executes the REAL production query: product-search.service.js
 * is loaded with a stubbed database-setup so getSearchSql(), sanitizeTsQuery()
 * and formatProduct() are the shipped implementations, not copies.
 *
 * Writes retrieval-eval.json (machine-readable, every per-query verdict) and
 * prints a summary table.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dataset = require('./dataset');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : dflt;
};
const flag = (name) => argv.includes(`--${name}`);

const ADMIN_PG = arg('pg', 'postgresql://postgres:postgres@localhost:5432/postgres');
const EVAL_DB = 'easymod_retrieval_eval';
const OUT_DIR = path.resolve(__dirname, '../..', arg('out', '../docs/ai-cost/evidence'));
const CACHE_FILE = path.join(__dirname, '.embedding-cache.json');
const TOP_N = 5;

// ---------------------------------------------------------------------------
// Scratch database
// ---------------------------------------------------------------------------

const evalUrl = () => {
    const u = new URL(ADMIN_PG);
    u.pathname = `/${EVAL_DB}`;
    return u.toString();
};

const withClient = async (url, fn) => {
    const c = new Client({ connectionString: url });
    await c.connect();
    try { return await fn(c); } finally { await c.end(); }
};

const CREATE_TABLE = `
    CREATE TABLE products (
        id uuid PRIMARY KEY,
        shop_id uuid NOT NULL,
        name text,
        name_bn text,
        category text,
        price numeric,
        compare_at_price numeric,
        quantity integer,
        in_stock boolean DEFAULT true,
        is_active boolean DEFAULT true,
        variants jsonb,
        images jsonb,
        image_url text,
        tags jsonb,
        brand text,
        description text,
        sku text,
        ai_description text,
        ai_tags jsonb,
        ai_category text,
        ai_color_primary text,
        ai_material text,
        ai_attributes jsonb,
        ai_search_text text,
        deleted_at timestamptz,
        created_at timestamptz DEFAULT now()
    );
`;

const setupDb = async (products) => {
    await withClient(ADMIN_PG, async (c) => {
        await c.query(`DROP DATABASE IF EXISTS ${EVAL_DB}`);
        await c.query(`CREATE DATABASE ${EVAL_DB}`);
    });

    await withClient(evalUrl(), async (c) => {
        await c.query(CREATE_TABLE);
        for (const p of products) {
            await c.query(
                `INSERT INTO products (id, shop_id, name, name_bn, category, price,
                     compare_at_price, quantity, in_stock, is_active, variants, tags,
                     brand, description, sku, ai_description, ai_tags, ai_category,
                     ai_color_primary, ai_material, ai_attributes, ai_search_text)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
                [
                    p.id, p.shop_id, p.name, p.name_bn, p.category, p.price,
                    p.compare_at_price, p.quantity, p.in_stock, p.is_active,
                    JSON.stringify(p.variants || []), JSON.stringify(p.tags || []),
                    p.brand, p.description, p.sku, p.ai_description,
                    JSON.stringify(p.ai_tags || []), p.ai_category,
                    p.ai_color_primary, p.ai_material,
                    JSON.stringify(p.ai_attributes || {}), p.ai_search_text,
                ],
            );
        }
    });
};

const dropDb = async () => {
    await withClient(ADMIN_PG, async (c) => {
        await c.query(`DROP DATABASE IF EXISTS ${EVAL_DB}`);
    }).catch(() => {});
};

// ---------------------------------------------------------------------------
// Load the REAL product-search service against the scratch database.
// Pre-seeding require.cache with a stub database-setup means getSearchSql(),
// buildSearchQuery(), sanitizeTsQuery() and formatProduct() are the shipped code.
// ---------------------------------------------------------------------------

const loadProductSearch = (pgClient) => {
    const dbSetupPath = require.resolve('../../src/utils/database/database-setup');
    const stub = {
        sequelize: {
            // product-search calls sequelize.query(sql, { replacements, type }).
            // Translate :named params to $n positional params for node-postgres.
            query: async (sql, { replacements = {} } = {}) => {
                const order = [];
                const text = sql.replace(/:(\w+)/g, (_, key) => {
                    order.push(replacements[key]);
                    return `$${order.length}`;
                });
                const res = await pgClient.query(text, order);
                return res.rows;
            },
        },
    };
    require.cache[dbSetupPath] = { id: dbSetupPath, filename: dbSetupPath, loaded: true, exports: stub };
    delete require.cache[require.resolve('../../src/modules/product/product-search.service')];
    return require('../../src/modules/product/product-search.service');
};

/**
 * Load a PREVIOUS revision of product-search.service.js so the report can show a
 * true before/after on identical metric definitions. The file is materialised
 * next to the original (so its relative requires still resolve), required
 * through the same stub, then deleted.
 */
const LEGACY_REF = arg('legacy-ref', 'cee9822');
const legacyTmpPath = path.resolve(__dirname, '../../src/modules/product/__legacy_eval_tmp.js');

const loadLegacyProductSearch = (pgClient) => {
    const { execFileSync } = require('child_process');
    const src = execFileSync('git', [
        'show', `${LEGACY_REF}:EasyMod-backend/src/modules/product/product-search.service.js`,
    ], { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8', maxBuffer: 1 << 22 });
    fs.writeFileSync(legacyTmpPath, src);
    try {
        loadProductSearch(pgClient); // seeds the database-setup stub
        delete require.cache[legacyTmpPath];
        return require(legacyTmpPath);
    } finally {
        fs.unlinkSync(legacyTmpPath);
    }
};

/**
 * The intent-router's two product-search gates, sourced from the dependency-free
 * Stage-2 rules module. The router itself pulls in the LLM client, Redis and the
 * BERT client, so the harness imports only the pure predicates.
 */
const loadProductIntent = () => {
    const {
        GREETING_PATTERN: greeting,
        NON_PRODUCT_CHATTER: chatter,
        PRODUCT_INTENT_KEYWORDS: keywords,
        hasProductIntent,
    } = require('../../src/modules/ai/intent/stage2-rules');
    const isPlainGreeting = (msg) => {
        const t = (msg || '').trim();
        return Boolean(t) && !hasProductIntent(t) && greeting.test(t);
    };
    const shouldSearchProducts = (msg) => {
        const t = (msg || '').trim();
        return Boolean(t) && !isPlainGreeting(t) && !chatter.test(t);
    };
    return { keywords, hasProductIntent, shouldSearchProducts };
};

// ---------------------------------------------------------------------------
// Vector engines
// ---------------------------------------------------------------------------

const { localEmbed } = require('../../src/modules/rag/embedding.service');
const { buildEmbeddingText } = require('../../src/modules/product/product-embedding.service');

const cosine = (a, b) => {
    let dot = 0; let na = 0; let nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

const GEMINI_EMBED_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
const GEMINI_DIMS = Number.parseInt(process.env.QDRANT_VECTOR_SIZE || '384', 10);

let cache = {};
try { if (!flag('refresh-cache')) cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (_) { cache = {}; }
let geminiCalls = 0;
let geminiChars = 0;
let gemini429s = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The free Gemini tier rate-limits embedContent per MINUTE, so an unthrottled
// sweep 429s partway through. Spacing calls is what a real ingest job has to do
// as well — the pacing here is evidence for GEMINI_FREE_TIER_CAPACITY.md, not
// just harness plumbing.
const MIN_CALL_GAP_MS = Number.parseInt(arg('embed-gap-ms', '750'), 10);
let lastCallAt = 0;

const geminiEmbed = async (text, taskType) => {
    const key = `${GEMINI_EMBED_MODEL}|${GEMINI_DIMS}|${taskType}|${text}`;
    if (cache[key]) return cache[key];

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set — rerun with --no-gemini');

    let body;
    for (let attempt = 0; ; attempt++) {
        const gap = MIN_CALL_GAP_MS - (Date.now() - lastCallAt);
        if (gap > 0) await sleep(gap);
        lastCallAt = Date.now();

        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:embedContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: { parts: [{ text }] },
                    taskType,
                    outputDimensionality: GEMINI_DIMS,
                }),
            },
        );

        if (res.ok) { body = await res.json(); break; }
        const errText = (await res.text()).slice(0, 200);
        if (res.status === 429 && attempt < 5) {
            gemini429s += 1;
            await sleep(5000 * (attempt + 1));
            continue;
        }
        throw new Error(`Gemini embed ${res.status}: ${errText}`);
    }

    const values = body?.embedding?.values;
    if (!Array.isArray(values)) throw new Error('Gemini embed returned no vector');

    // Normalize provider output before cosine comparison so configured dimensions
    // remain comparable across the evaluation corpus.
    const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0)) || 1;
    const unit = values.map((v) => v / norm);

    geminiCalls += 1;
    geminiChars += text.length;
    cache[key] = unit;
    return unit;
};

/** Reciprocal-rank fusion of several ranked id lists. */
const rrf = (lists, k = 60) => {
    const score = new Map();
    for (const list of lists) {
        list.forEach((id, i) => score.set(id, (score.get(id) || 0) + 1 / (k + i + 1)));
    }
    return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
};

// ---------------------------------------------------------------------------
// FAQ retrieval — the shipped intent-router Stage 2 keyword scorer
// ---------------------------------------------------------------------------

const faqKeywordMatch = (message, faqs) => {
    const tokens = message.toLowerCase().replace(/[^\wঀ-৿\s]/g, ' ')
        .split(/\s+/).filter((w) => w.length >= 2);
    if (!tokens.length) return null;

    const candidates = faqs.filter((f) => tokens.some((t) => [f.category, f.template_en, f.template_bn]
        .filter(Boolean).join(' ').toLowerCase().includes(t)));
    if (!candidates.length) return null;

    const scored = candidates.map((faq) => {
        const hay = [faq.category, faq.template_en, faq.template_bn].filter(Boolean).join(' ').toLowerCase();
        const hits = tokens.filter((t) => hay.includes(t)).length;
        return { faq, score: hits / tokens.length };
    }).sort((a, b) => b.score - a.score);

    const best = scored[0];
    const hitCount = Math.round(best.score * tokens.length);
    // Shipped acceptance rule: ≥30% of tokens matched, or ≥2 absolute hits.
    return (best.score >= 0.3 || hitCount >= 2) ? best : null;
};

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

// "Clear product query" = the customer named the product, category, price, size,
// colour or stock in words that appear in the catalogue. These are the queries the
// brief's acceptance thresholds (top-3 ≥95%, top-1 ≥85%) apply to.
// The hard slice — phonetic-only Bengali, typos, synonyms, indirect descriptions —
// is reported separately because no lexical engine can be expected to clear 95%
// there, and hiding it inside one average would flatter every engine equally.
const CLEAR_TRAITS = new Set([
    'direct', 'price', 'stock', 'category', 'size', 'color', 'overlap', 'twin', 'shortname',
]);
const isClear = (q) => CLEAR_TRAITS.has(q.trait);

const pct = (xs, p) => {
    if (!xs.length) return null;
    const sorted = [...xs].sort((a, b) => a - b);
    return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] * 100) / 100;
};

/** Grade one engine's ranked id list against one labelled query. Pure. */
const scoreQuery = (q, ranked) => {
    if (q.kind === 'none') return { returned: ranked.length, clean: ranked.length === 0 };
    if (q.kind === 'faq') return {};

    const top3 = ranked.slice(0, 3);
    const expect = new Set(q.expect);
    return {
        hit1: Boolean(ranked[0] && expect.has(ranked[0])),
        hit3: top3.some((id) => expect.has(id)),
        returned: ranked.length,
        top3Size: top3.length,
        top3Relevant: top3.filter((id) => expect.has(id)).length,
    };
};

/** Aggregate finalised metrics for one engine over a subset of the query rows. */
const aggregate = (rows, engine, filter = () => true) => {
    const products = rows.filter((r) => r.kind === 'product' && filter(r) && r.engines[engine]);
    const absent = rows.filter((r) => r.kind === 'none' && r.engines[engine]);
    const lat = rows.map((r) => r.engines[engine]?.latencyMs).filter((v) => typeof v === 'number');

    const n = products.length;
    const sum = (f) => products.reduce((a, r) => a + f(r.engines[engine]), 0);
    const top3Size = sum((e) => e.top3Size || 0);

    return {
        productQueries: n,
        top1Accuracy: n ? sum((e) => (e.hit1 ? 1 : 0)) / n : null,
        top3Accuracy: n ? sum((e) => (e.hit3 ? 1 : 0)) / n : null,
        missedProductRate: n ? sum((e) => (e.hit3 ? 0 : 1)) / n : null,
        // A wrong product at rank 1 is what the LLM grounds on — the costly failure.
        wrongProductRate: n ? sum((e) => (e.returned && !e.hit1 ? 1 : 0)) / n : null,
        irrelevantRetrievalRate: top3Size ? 1 - sum((e) => e.top3Relevant || 0) / top3Size : null,
        absentQueries: absent.length,
        falsePositiveRateOnAbsent: absent.length
            ? 1 - absent.filter((r) => r.engines[engine].clean).length / absent.length
            : null,
        latencyP50Ms: pct(lat, 50),
        latencyP95Ms: pct(lat, 95),
    };
};

// ---------------------------------------------------------------------------
// Engine runners
// ---------------------------------------------------------------------------

const buildVectorIndex = async (products, embedFn, taskType) => {
    const docs = [];
    for (const p of products) {
        docs.push({ id: p.id, kind: 'product', vector: await embedFn(buildEmbeddingText(p), taskType) });
    }
    return docs;
};

const scoreAll = (index, qVector) => index
    .map((d) => ({ id: d.id, score: cosine(d.vector, qVector) }))
    .sort((a, b) => b.score - a.score);

const applyThreshold = (scored, minScore, limit = TOP_N) => scored
    .filter((d) => d.score > minScore).slice(0, limit).map((d) => d.id);

const round4 = (v) => Math.round(v * 10000) / 10000;

/**
 * Cosine similarity is not comparable across embedding spaces: the n-gram hash
 * and Gemini's 384-dim vectors sit at completely different baselines. Comparing
 * them at the single hard-coded 0.5 the RAG tier uses would flatter one and
 * penalise the other, so each vector engine gets its threshold swept and the
 * report states the operating point it was graded at.
 */
const GEMINI_MIN_SCORE = Number.parseFloat(arg('gemini-min-score', '0.72'));

const thresholdSweep = (rows) => {
    const out = {};
    for (const [engine, field] of [['local_vector', 'localScores'], ['gemini_semantic', 'geminiScored']]) {
        const usable = rows.filter((r) => r[field]);
        if (!usable.length) continue;
        out[engine] = [];
        for (let t = 0.3; t <= 0.95; t += 0.05) {
            const th = Math.round(t * 100) / 100;
            let clearTop3 = 0; let clearN = 0; let absentClean = 0; let absentN = 0;
            for (const r of rows) {
                const scored = field === 'geminiScored'
                    ? r.geminiScored
                    : (r.localScores || []).map((s, i) => ({ id: `#${i}`, score: s }));
                if (!scored) continue;
                const kept = scored.filter((d) => d.score > th);
                if (r.kind === 'none') { absentN += 1; if (!kept.length) absentClean += 1; continue; }
                if (r.kind !== 'product' || !r.clear) continue;
                clearN += 1;
                // Only the Gemini rows carry ids, so recall is measurable there only.
                if (field === 'geminiScored') {
                    const expect = new Set(dataset.queries.find((q) => q.id === r.id).expect);
                    if (kept.slice(0, 3).some((d) => expect.has(d.id))) clearTop3 += 1;
                }
            }
            out[engine].push({
                threshold: th,
                clearTop3Accuracy: clearN && field === 'geminiScored' ? clearTop3 / clearN : null,
                falsePositiveRateOnAbsent: absentN ? 1 - absentClean / absentN : null,
            });
        }
    }
    return out;
};

const run = async () => {
    const state = arg('state', 'both');
    const requested = (arg('engines', '') || '').split(',').filter(Boolean);
    const useGemini = !flag('no-gemini') && Boolean(process.env.GEMINI_API_KEY);

    const allEngines = [
        'sql_fts_legacy', 'sql_fts', 'local_vector', 'production_legacy',
        'production', 'production_fixed', 'production_target', 'gemini_semantic', 'hybrid',
    ];
    let engines = requested.length ? requested : allEngines;
    if (!useGemini) engines = engines.filter((e) => !['gemini_semantic', 'hybrid'].includes(e));

    const { keywords, hasProductIntent, shouldSearchProducts } = loadProductIntent();
    const results = { meta: {}, states: {} };

    const states = state === 'both' ? ['asShipped', 'enriched'] : [state];

    for (const stateName of states) {
        const products = dataset[stateName]();
        process.stdout.write(`\n[${stateName}] loading ${products.length} products into ${EVAL_DB}…\n`);
        await setupDb(products);

        const perEngine = {};
        const perQuery = [];

        await withClient(evalUrl(), async (pg) => {
            const legacySearch = engines.includes('sql_fts_legacy') ? loadLegacyProductSearch(pg) : null;
            const productSearch = loadProductSearch(pg);

            // Vector indexes (embedding text is state-dependent: ai_* feed into it)
            const localIndex = await buildVectorIndex(products, async (t) => localEmbed(t));
            const geminiIndex = engines.some((e) => ['gemini_semantic', 'hybrid'].includes(e))
                ? await buildVectorIndex(products, geminiEmbed, 'RETRIEVAL_DOCUMENT')
                : null;

            const indexBytes = {
                local: localIndex.length * GEMINI_DIMS * 4,
                gemini: geminiIndex ? geminiIndex.length * GEMINI_DIMS * 4 : null,
            };

            let faqQueries = 0;
            let faqCorrect = 0;

            for (const q of dataset.queries) {
                const row = {
                    id: q.id, query: q.query, kind: q.kind, lang: q.lang, trait: q.trait,
                    clear: isClear(q), engines: {},
                };

                // ── FAQ path (shipped Stage-2 keyword scorer) ─────────────────
                if (q.kind === 'faq') {
                    faqQueries += 1;
                    const hit = faqKeywordMatch(q.query, dataset.faqs);
                    const ok = Boolean(hit && hit.faq.category === q.expectFaq);
                    if (ok) faqCorrect += 1;
                    row.faq = { matched: hit ? hit.faq.category : null, expected: q.expectFaq, correct: ok };
                }

                // ── sql_fts (shipped Postgres full-text search) ──────────────
                let sqlRanked = [];
                if (engines.some((e) => ['sql_fts', 'production', 'production_fixed', 'production_target', 'hybrid'].includes(e))) {
                    const t0 = performance.now();
                    const rows = await productSearch
                        .searchByAttributes({ shopId: dataset.SHOP_ID, query: q.query, limit: TOP_N })
                        .catch(() => []);
                    const ms = performance.now() - t0;
                    sqlRanked = rows.map((r) => r.id);
                    if (engines.includes('sql_fts')) {
                        row.engines.sql_fts = { ...scoreQuery(q, sqlRanked), latencyMs: ms };
                    }
                }

                // ── sql_fts_legacy (same service at --legacy-ref) ────────────
                let legacyRanked = [];
                if (legacySearch) {
                    const t0 = performance.now();
                    const rows = await legacySearch
                        .searchByAttributes({ shopId: dataset.SHOP_ID, query: q.query, limit: TOP_N })
                        .catch(() => []);
                    legacyRanked = rows.map((r) => r.id);
                    row.engines.sql_fts_legacy = {
                        ...scoreQuery(q, legacyRanked), latencyMs: performance.now() - t0,
                    };
                }

                // ── local_vector (the n-gram hash currently in production) ────
                let localRanked = [];
                let localScored = [];
                if (engines.includes('local_vector') || engines.includes('production')) {
                    const t0 = performance.now();
                    const qv = localEmbed(q.query);
                    localScored = scoreAll(localIndex, qv);
                    localRanked = applyThreshold(localScored, 0.5, TOP_N);
                    const ms = performance.now() - t0;
                    if (engines.includes('local_vector')) {
                        row.engines.local_vector = { ...scoreQuery(q, localRanked), latencyMs: ms };
                        row.localScores = localScored.slice(0, 8).map((d) => round4(d.score));
                    }
                }

                // ── production composite (what a customer message really hits) ─
                const gated = hasProductIntent(q.query);

                // production_legacy = the pipeline exactly as deployed today:
                // intent gate → tautological SQL → local n-gram vector top-up.
                if (engines.includes('production_legacy') && legacySearch) {
                    const composite = gated ? [...legacyRanked] : [];
                    for (const id of localRanked) if (!composite.includes(id)) composite.push(id);
                    row.engines.production_legacy = { ...scoreQuery(q, composite), intentGated: gated };
                }

                if (engines.includes('production')) {
                    const composite = gated ? [...sqlRanked] : [];
                    // RAG tier tops up with vector hits the SQL tier missed.
                    for (const id of localRanked) if (!composite.includes(id)) composite.push(id);
                    row.engines.production = { ...scoreQuery(q, composite), intentGated: gated };
                }

                // ── production_fixed: SQL guard applied, but the OLD keyword gate
                // still in place and the RAG product tier removed. Isolates the
                // interaction: the vector tier was masking the gate's misses, so
                // removing it alone makes things worse.
                if (engines.includes('production_fixed')) {
                    row.engines.production_fixed = {
                        ...scoreQuery(q, gated ? sqlRanked : []), intentGated: gated,
                    };
                }

                // ── production_target: all three corrections together — guarded
                // SQL, closed-set chatter gate, no non-semantic product grounding.
                if (engines.includes('production_target')) {
                    const open = shouldSearchProducts(q.query);
                    row.engines.production_target = {
                        ...scoreQuery(q, open ? sqlRanked : []), intentGated: open,
                    };
                }

                // ── gemini_semantic ──────────────────────────────────────────
                let gemRanked = [];
                let gemScored = [];
                if (geminiIndex && engines.some((e) => ['gemini_semantic', 'hybrid'].includes(e))) {
                    const t0 = performance.now();
                    const qv = await geminiEmbed(q.query, 'RETRIEVAL_QUERY');
                    gemScored = scoreAll(geminiIndex, qv);
                    gemRanked = applyThreshold(gemScored, GEMINI_MIN_SCORE, TOP_N);
                    const ms = performance.now() - t0;
                    if (engines.includes('gemini_semantic')) {
                        row.engines.gemini_semantic = { ...scoreQuery(q, gemRanked), latencyMs: ms };
                    }
                    row.geminiScored = gemScored.slice(0, 8).map((d) => ({ id: d.id, score: round4(d.score) }));
                }

                // ── hybrid (RRF: lexical SQL + Gemini semantic) ──────────────
                if (engines.includes('hybrid')) {
                    // Fuse only when the semantic tier actually cleared its own
                    // threshold; otherwise hybrid inherits the lexical answer.
                    const fused = rrf([sqlRanked, gemRanked]).slice(0, TOP_N);
                    row.engines.hybrid = scoreQuery(q, fused);
                }

                perQuery.push(row);
            }

            for (const e of engines) {
                perEngine[e] = {
                    all: aggregate(perQuery, e),
                    clearOnly: aggregate(perQuery, e, (r) => r.clear),
                    hardOnly: aggregate(perQuery, e, (r) => !r.clear),
                };
            }

            results.states[stateName] = {
                indexBytes,
                faq: { faqQueries, faqCorrect, faqCorrectRate: faqQueries ? faqCorrect / faqQueries : null },
                engines: perEngine,
                thresholdSweep: thresholdSweep(perQuery),
                bySlice: sliceBreakdown(perQuery, engines),
                perQuery,
            };
        });
    }

    results.meta = {
        generatedBy: 'scripts/retrieval-eval/run-eval.js',
        engines,
        topN: TOP_N,
        queryCount: dataset.queries.length,
        productCount: dataset.allProducts.length,
        geminiEmbeddingModel: useGemini ? GEMINI_EMBED_MODEL : null,
        geminiDimensions: useGemini ? GEMINI_DIMS : null,
        geminiApiCallsThisRun: geminiCalls,
        geminiCharsEmbeddedThisRun: geminiChars,
        geminiRateLimit429sThisRun: gemini429s,
        geminiCallGapMs: MIN_CALL_GAP_MS,
        postgres: 'scratch database, dropped after the run',
    };

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'retrieval-eval.json'), `${JSON.stringify(results, null, 2)}\n`);
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
    await dropDb();

    printSummary(results);
    process.stdout.write(`\nWrote ${path.join(OUT_DIR, 'retrieval-eval.json')}\n`);
    return results;
};

const sliceBreakdown = (perQuery, engines) => {
    const out = {};
    for (const dim of ['lang', 'trait']) {
        out[dim] = {};
        for (const q of perQuery) {
            if (q.kind !== 'product') continue;
            const key = q[dim];
            out[dim][key] = out[dim][key] || {};
            for (const e of engines) {
                const r = q.engines[e];
                if (!r || r.hit1 === undefined) continue;
                const cell = out[dim][key][e] = out[dim][key][e] || { n: 0, top1: 0, top3: 0 };
                cell.n += 1;
                if (r.hit1) cell.top1 += 1;
                if (r.hit3) cell.top3 += 1;
            }
        }
    }
    return out;
};

const fmtPct = (v) => (v == null ? '   —' : `${(v * 100).toFixed(1)}%`);

const printSummary = (results) => {
    for (const [stateName, s] of Object.entries(results.states)) {
        for (const slice of ['clearOnly', 'all']) {
            process.stdout.write(`\n=== ${stateName} / ${slice} ${'='.repeat(34 - slice.length)}\n`);
            process.stdout.write('engine            top1    top3   missed  wrong  irrel  absentFP  p95ms\n');
            for (const [engine, buckets] of Object.entries(s.engines)) {
                const m = buckets[slice];
                process.stdout.write(
                    `${engine.padEnd(17)}${fmtPct(m.top1Accuracy).padStart(6)}  ${fmtPct(m.top3Accuracy).padStart(6)}  `
                    + `${fmtPct(m.missedProductRate).padStart(6)} ${fmtPct(m.wrongProductRate).padStart(6)} `
                    + `${fmtPct(m.irrelevantRetrievalRate).padStart(6)} ${fmtPct(m.falsePositiveRateOnAbsent).padStart(9)}  `
                    + `${m.latencyP95Ms == null ? '—' : m.latencyP95Ms}\n`,
                );
            }
        }
        process.stdout.write(`FAQ keyword match: ${fmtPct(s.faq.faqCorrectRate)} of ${s.faq.faqQueries}\n`);
    }
};

if (require.main === module) {
    run().catch(async (err) => {
        console.error(`\nEval failed: ${err.message}`);
        await dropDb();
        process.exitCode = 1;
    });
}

module.exports = { run, faqKeywordMatch, rrf, cosine };
