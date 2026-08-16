'use strict';

/**
 * Non-deploying Qdrant migration proof runner.
 *
 * This file is copied into the candidate backend container by the manual
 * qdrant-migration workflow. It deliberately has no delete or collection
 * switch operation. The workflow is the only caller that creates the two
 * migration collections, takes the rollback snapshot, and starts the
 * isolated restore container.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const QDRANT_URL = (process.env.QDRANT_URL || 'http://localhost:6333').replace(/\/$/, '');
const ACTIVE_COLLECTION = process.env.ACTIVE_COLLECTION || 'knowledge_documents';
const VECTOR_SIZE = Number.parseInt(process.env.QDRANT_VECTOR_SIZE || '384', 10);
const EXPECTED_SOURCE_COUNT = Number.parseInt(process.env.EXPECTED_SOURCE_COUNT || '2', 10);
const NEGATIVE_SCORE_MAX = Number.parseFloat(process.env.NEGATIVE_SCORE_MAX || '0.5');

const argv = process.argv.slice(3);

const option = (name, fallback = null) => {
    const prefix = `--${name}=`;
    const match = argv.find((value) => value.startsWith(prefix));
    return match ? match.slice(prefix.length).trim() : fallback;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const safeError = (error) => String(error?.message || error || 'unknown error')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/([?&](?:key|token|api-key|apikey)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 240);

function assertSafeCollectionName(name, activeCollection = ACTIVE_COLLECTION) {
    if (!name || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,126}$/.test(name)) {
        throw new Error('unsafe Qdrant collection name');
    }
    if (name === activeCollection) {
        throw new Error('refusing to use the live Qdrant collection as a migration target');
    }
    if (name.includes('..') || /:latest\b/i.test(name)) {
        throw new Error('unsafe mutable migration target');
    }
    return name;
}

function extractVectorSize(info) {
    const vectors = info?.config?.params?.vectors;
    if (Number.isInteger(vectors?.size)) return vectors.size;
    if (Number.isInteger(vectors?.default?.size)) return vectors.default.size;
    if (vectors && typeof vectors === 'object') {
        const first = Object.values(vectors).find((value) => Number.isInteger(value?.size));
        if (first) return first.size;
    }
    return null;
}

function qdrantHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.QDRANT_API_KEY) headers['api-key'] = process.env.QDRANT_API_KEY;
    return headers;
}

async function qdrantJson(route, init = {}) {
    const response = await fetch(`${QDRANT_URL}${route}`, {
        ...init,
        headers: { ...qdrantHeaders(), ...(init.headers || {}) },
    });
    if (!response.ok) {
        // Never include a Qdrant response body: an upstream proxy can echo
        // credentials or internal request details in an error response.
        throw new Error(`QDRANT_HTTP_${response.status}`);
    }
    return response.json();
}

async function qdrantBinary(route) {
    const response = await fetch(`${QDRANT_URL}${route}`, {
        headers: qdrantHeaders(),
    });
    if (!response.ok) throw new Error(`QDRANT_HTTP_${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

const collectionPath = (name) => `/collections/${encodeURIComponent(name)}`;

async function collectionInfo(name) {
    const response = await fetch(`${QDRANT_URL}${collectionPath(name)}`, {
        headers: qdrantHeaders(),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`QDRANT_HTTP_${response.status}`);
    const body = await response.json();
    return body.result || null;
}

async function waitForCollection(name) {
    let lastError;
    for (let attempt = 0; attempt < 36; attempt += 1) {
        try {
            const info = await collectionInfo(name);
            if (info) return info;
        } catch (error) {
            lastError = error;
        }
        await sleep(2000);
    }
    throw lastError || new Error(`collection ${name} did not become available`);
}

async function countPoints(name, filter) {
    const body = { exact: true };
    if (filter) body.filter = filter;
    const result = await qdrantJson(`${collectionPath(name)}/points/count`, {
        method: 'POST',
        body: JSON.stringify(body),
    });
    return Number(result?.result?.count || 0);
}

async function scrollPoints(name) {
    const points = [];
    let offset = null;
    do {
        const body = {
            limit: 256,
            with_payload: true,
            with_vector: false,
        };
        if (offset !== null) body.offset = offset;
        const result = await qdrantJson(`${collectionPath(name)}/points/scroll`, {
            method: 'POST',
            body: JSON.stringify(body),
        });
        points.push(...(result?.result?.points || []));
        offset = result?.result?.next_page_offset ?? null;
    } while (offset !== null);
    return points;
}

function databaseSsl() {
    if (!['true', '1'].includes(String(process.env.DB_SSL || '').toLowerCase())) return false;
    return {
        rejectUnauthorized: String(process.env.ALLOW_SELF_SIGNED_TLS || '').toLowerCase() !== 'true',
    };
}

function loadSourceContract() {
    const candidates = [
        process.env.SOURCE_CONTRACT_PATH,
        '/app/src/modules/knowledge/index-source.contract.js',
        path.resolve(process.cwd(), 'src/modules/knowledge/index-source.contract.js'),
        path.resolve(process.cwd(), 'EasyMod-backend/src/modules/knowledge/index-source.contract.js'),
    ].filter(Boolean);
    const candidate = candidates.find((file) => fs.existsSync(file));
    if (!candidate) throw new Error('authoritative PostgreSQL source contract is not present in the candidate image');
    return require(candidate);
}

async function sourceStats({ sourceContract } = {}) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    const contract = sourceContract || loadSourceContract();
    const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: databaseSsl() });
    try {
        await client.connect();
        return await contract.collectSourceStats((sql, values) => client.query(sql, values));
    } finally {
        await client.end().catch(() => {});
    }
}

async function assertTargetPreflight(name) {
    assertSafeCollectionName(name);
    const info = await collectionInfo(name);
    if (!info) {
        console.log(`${name}_PRECHECK=PASS_ABSENT`);
        return;
    }
    const count = await countPoints(name);
    const size = extractVectorSize(info);
    if (count !== 0 || size !== VECTOR_SIZE) {
        throw new Error(`migration target already contains incompatible state: ${name}`);
    }
    // An empty collection can be a retry after an embedding request failed.
    // It is safe to reuse without deleting or mutating any existing point.
    console.log(`${name}_PRECHECK=PASS_EMPTY_EXISTING`);
}

async function inspect() {
    const source = await sourceStats();
    const liveInfo = await collectionInfo(ACTIVE_COLLECTION);
    if (!liveInfo) throw new Error('live Qdrant collection is unavailable');
    const liveCount = await countPoints(ACTIVE_COLLECTION);
    if (process.env.EXPECTED_LIVE_COUNT && liveCount !== Number(process.env.EXPECTED_LIVE_COUNT)) {
        throw new Error('live Qdrant count differs from the supplied read-only baseline');
    }
    if (source.count !== EXPECTED_SOURCE_COUNT) {
        throw new Error(`PostgreSQL source count is ${source.count}, expected ${EXPECTED_SOURCE_COUNT}`);
    }
    const liveVectorSize = extractVectorSize(liveInfo);
    if (liveVectorSize !== VECTOR_SIZE) {
        throw new Error(`live Qdrant vector size ${liveVectorSize} does not equal ${VECTOR_SIZE}`);
    }

    console.log(`POSTGRES_SOURCE_COUNT=${source.count}`);
    console.log(`LIVE_COLLECTION=${ACTIVE_COLLECTION}`);
    console.log(`LIVE_COUNT=${liveCount}`);
    console.log(`LIVE_VECTOR_SIZE=${liveVectorSize}`);
    await assertTargetPreflight(process.env.OPENAI_ROLLBACK_COLLECTION || 'knowledge_documents_openai_rollback_20260816');
    await assertTargetPreflight(process.env.GEMINI_COLLECTION || 'knowledge_documents_gemini_20260816');
}

function loadEmbeddingService() {
    const candidates = [
        process.env.EMBEDDING_SERVICE_PATH,
        '/app/src/modules/rag/embedding.service.js',
        path.resolve(process.cwd(), 'EasyMod-backend/src/modules/rag/embedding.service.js'),
    ].filter(Boolean);
    const candidate = candidates.find((file) => fs.existsSync(file));
    if (!candidate) throw new Error('embedding service is not present in the candidate image');
    return require(candidate);
}

async function searchPoints(name, vector, filter) {
    const result = await qdrantJson(`${collectionPath(name)}/points/search`, {
        method: 'POST',
        body: JSON.stringify({
            vector,
            limit: 5,
            with_payload: true,
            ...(filter ? { filter } : {}),
        }),
    });
    return result?.result || [];
}

function shopFilter(shopId) {
    return { must: [{ key: 'shopId', match: { value: shopId } }] };
}

function tokens(value) {
    return String(value || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
}

function hasLexicalOverlap(query, content) {
    const contentTokens = new Set(tokens(content));
    return tokens(query).some((token) => contentTokens.has(token));
}

async function validate(name, expectedCount) {
    assertSafeCollectionName(name, name === ACTIVE_COLLECTION ? ACTIVE_COLLECTION : '__never__');
    const info = await waitForCollection(name);
    const size = extractVectorSize(info);
    const count = await countPoints(name);
    const points = await scrollPoints(name);
    const source = await sourceStats();
    if (source.count !== expectedCount) throw new Error('PostgreSQL source count changed during validation');
    if (size !== VECTOR_SIZE) throw new Error(`vector size ${size} does not equal ${VECTOR_SIZE}`);
    if (count !== expectedCount || points.length !== expectedCount) {
        throw new Error(`Qdrant count ${count}/${points.length} does not equal ${expectedCount}`);
    }

    const payloadOk = points.every((point) => {
        const payload = point.payload || {};
        return typeof payload.text === 'string'
            && payload.text.trim().length > 0
            && typeof payload.shopId === 'string'
            && payload.shopId.length > 0
            && typeof payload.type === 'string'
            && payload.type.length > 0
            && typeof payload.documentId === 'string'
            && payload.documentId.length > 0;
    });
    if (!payloadOk) throw new Error('payload integrity check failed');

    const shopId = source.shopIds[0];
    if (!shopId) throw new Error('tenant isolation cannot be proved without a shop id');

    const { getEmbedding } = loadEmbeddingService();
    const banglaSource = source.snippets.find((value) => /[\u0980-\u09ff]/u.test(value));
    const englishSource = source.snippets.find((value) => /[A-Za-z]/u.test(value));
    const banglaQuery = banglaSource ? banglaSource.slice(0, 120) : 'ডেলিভারি তথ্য';
    const englishQuery = englishSource ? englishSource.slice(0, 120) : 'product information';
    const crossLingualQuery = 'ডেলিভারি information';
    const positiveFilter = shopFilter(shopId);

    const runPositive = async (query) => {
        const vector = await getEmbedding(query);
        if (!Array.isArray(vector) || vector.length !== VECTOR_SIZE) return false;
        const results = await searchPoints(name, vector, positiveFilter);
        const top = results[0];
        return Boolean(top && Number.isFinite(Number(top.score)) && Number(top.score) >= 0.25);
    };

    const banglaPass = await runPositive(banglaQuery);
    const englishPass = await runPositive(englishQuery);
    const crossLingualPass = await runPositive(crossLingualQuery);

    const tenantVector = await getEmbedding(englishQuery);
    const tenantResults = await searchPoints(name, tenantVector, positiveFilter);
    const foreignTenant = '00000000-0000-4000-8000-000000000000';
    const foreignResults = await searchPoints(name, tenantVector, shopFilter(foreignTenant));
    const tenantPass = tenantResults.length > 0
        && tenantResults.every((item) => item.payload?.shopId === shopId)
        && foreignResults.length === 0;

    const negativeQuery = 'quantum physics black hole laboratory';
    const negativeVector = await getEmbedding(negativeQuery);
    const negativeResults = await searchPoints(name, negativeVector, positiveFilter);
    const negativeTop = negativeResults[0];
    const negativePass = !negativeTop
        || (Number(negativeTop.score) < NEGATIVE_SCORE_MAX
            && !hasLexicalOverlap(negativeQuery, negativeTop.payload?.text));

    console.log(`QDRANT_COLLECTION=${name}`);
    console.log(`QDRANT_COUNT=${count}`);
    console.log(`VECTOR_SIZE=${size}`);
    console.log('PAYLOAD_INTEGRITY=PASS');
    console.log(`BANGLA_SEARCH=${banglaPass ? 'PASS' : 'FAIL'}`);
    console.log(`ENGLISH_SEARCH=${englishPass ? 'PASS' : 'FAIL'}`);
    console.log(`CROSS_LINGUAL_SEARCH=${crossLingualPass ? 'PASS' : 'FAIL'}`);
    console.log(`NEGATIVE_SEARCH=${negativePass ? 'PASS' : 'FAIL'}`);
    console.log(`TENANT_ISOLATION=${tenantPass ? 'PASS' : 'FAIL'}`);
    if (negativeTop) console.log(`NEGATIVE_TOP_SCORE=${Number(negativeTop.score).toFixed(4)}`);

    const semanticPass = banglaPass && englishPass && crossLingualPass && negativePass;
    console.log(`SEMANTIC_SEARCH=${semanticPass ? 'PASS' : 'FAIL'}`);
    if (!semanticPass || !tenantPass) throw new Error('Qdrant validation gate failed');
}

async function createSnapshot(collection, snapshotPath) {
    assertSafeCollectionName(collection);
    if (!snapshotPath || path.basename(snapshotPath) !== snapshotPath) {
        throw new Error('snapshot path must be a single file name in the mounted evidence directory');
    }
    const snapshotDir = path.resolve(process.env.SNAPSHOT_DIR || process.cwd());
    const outputPath = path.resolve(snapshotDir, snapshotPath);
    if (!outputPath.startsWith(`${snapshotDir}${path.sep}`)) {
        throw new Error('snapshot path escaped the mounted evidence directory');
    }
    const created = await qdrantJson(`${collectionPath(collection)}/snapshots`, {
        method: 'POST',
    });
    const snapshotName = created?.result?.name || created?.result?.snapshot?.name;
    if (!snapshotName) throw new Error('Qdrant did not return a snapshot name');
    const bytes = await qdrantBinary(`${collectionPath(collection)}/snapshots/${encodeURIComponent(snapshotName)}`);
    if (!bytes.length) throw new Error('downloaded Qdrant snapshot is empty');
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(outputPath, bytes, { mode: 0o600, flag: 'wx' });
    const reread = fs.readFileSync(outputPath);
    const rereadChecksum = crypto.createHash('sha256').update(reread).digest('hex');
    if (checksum !== rereadChecksum) throw new Error('snapshot checksum changed after write');
    console.log(`SNAPSHOT_NAME=${snapshotName}`);
    console.log(`SNAPSHOT_SHA256=${checksum}`);
    console.log(`SNAPSHOT_BYTES=${bytes.length}`);
    console.log(`SNAPSHOT_PATH=${outputPath}`);
}

async function postflight() {
    const liveInfo = await collectionInfo(ACTIVE_COLLECTION);
    if (!liveInfo) throw new Error('live Qdrant collection disappeared');
    const liveCount = await countPoints(ACTIVE_COLLECTION);
    const expectedLiveCount = Number(process.env.EXPECTED_LIVE_COUNT);
    if (Number.isInteger(expectedLiveCount) && liveCount !== expectedLiveCount) {
        throw new Error('live Qdrant count changed during the proof run');
    }
    if (extractVectorSize(liveInfo) !== VECTOR_SIZE) {
        throw new Error('live Qdrant vector configuration changed during the proof run');
    }
    console.log(`LIVE_COLLECTION=${ACTIVE_COLLECTION}`);
    console.log(`LIVE_COUNT=${liveCount}`);
    console.log('LIVE_COLLECTION_UNTOUCHED=PASS');
}

async function main() {
    const mode = process.argv[2];
    if (mode === 'inspect') return inspect();
    if (mode === 'validate') return validate(option('collection'), Number(option('expected-count', EXPECTED_SOURCE_COUNT)));
    if (mode === 'snapshot') return createSnapshot(option('collection'), option('path'));
    if (mode === 'postflight') return postflight();
    throw new Error('usage: inspect | validate --collection=<name> | snapshot --collection=<name> --path=<file> | postflight');
}

if (require.main === module) {
    main().catch((error) => {
        console.error(`QDRANT_PROOF_FAILED=${safeError(error)}`);
        process.exitCode = 1;
    });
}

module.exports = {
    assertSafeCollectionName,
    extractVectorSize,
    hasLexicalOverlap,
    loadSourceContract,
    sourceStats,
};
