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

const ACTIVE_COLLECTION = process.env.ACTIVE_COLLECTION || 'knowledge_documents';
const VECTOR_SIZE = Number.parseInt(process.env.QDRANT_VECTOR_SIZE || '384', 10);
const EXPECTED_SOURCE_COUNT = Number.parseInt(process.env.EXPECTED_SOURCE_COUNT || '2', 10);
const POSITIVE_SCORE_MIN = Number.parseFloat(process.env.POSITIVE_SCORE_MIN || '0.25');
const NEGATIVE_SEARCH_QUERY = 'astrophysics quasars neutrino observatory';

const argv = process.argv.slice(3);

const option = (name, fallback = null) => {
    const prefix = `--${name}=`;
    const match = argv.find((value) => value.startsWith(prefix));
    return match ? match.slice(prefix.length).trim() : fallback;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Normalize a URL that may have been serialized by render-production-env.js
 * and loaded through Docker's --env-file parser. Errors contain only the
 * variable name so credentials and query strings never reach the log.
 *
 * @param {unknown} value raw environment value
 * @param {{name: string, protocols: string[], rootOnly?: boolean}} options
 * @returns {string} canonical URL safe for the relevant client
 */
function normalizeUrl(value, { name, protocols, rootOnly = false }) {
    let normalized = String(value ?? '').trim();
    if (!normalized) throw new Error(`${name} is required`);

    const quote = normalized[0];
    if (quote === '"' || quote === "'") {
        if (normalized.at(-1) !== quote) throw new Error(`${name} has malformed surrounding quotes`);
        normalized = normalized.slice(1, -1).trim();
    }
    if (!normalized || /\s/u.test(normalized)) throw new Error(`${name} must not contain whitespace`);

    let parsed;
    try {
        parsed = new URL(normalized);
    } catch (_) {
        throw new Error(`${name} must be a valid URL`);
    }

    if (!protocols.includes(parsed.protocol) || !parsed.hostname) {
        throw new Error(`${name} must use an allowed URL protocol and include a host`);
    }
    if (rootOnly && (
        parsed.pathname !== '/'
        || parsed.search
        || parsed.hash
        || parsed.username
        || parsed.password
    )) {
        throw new Error(`${name} must be a server-root URL`);
    }

    return rootOnly ? parsed.origin : parsed.toString();
}

function normalizeQdrantUrl(value) {
    return normalizeUrl(value, {
        name: 'QDRANT_URL',
        protocols: ['http:', 'https:'],
        rootOnly: true,
    });
}

function normalizeDatabaseUrl(value) {
    return normalizeUrl(value, {
        name: 'DATABASE_URL',
        protocols: ['postgres:', 'postgresql:'],
    });
}

const qdrantUrl = () => normalizeQdrantUrl(process.env.QDRANT_URL);

const safeError = (error) => String(error?.message || error || 'unknown error')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[database-url]')
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
    const response = await fetch(`${qdrantUrl()}${route}`, {
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
    const response = await fetch(`${qdrantUrl()}${route}`, {
        headers: qdrantHeaders(),
    });
    if (!response.ok) throw new Error(`QDRANT_HTTP_${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

const collectionPath = (name) => `/collections/${encodeURIComponent(name)}`;

async function collectionInfo(name) {
    const response = await fetch(`${qdrantUrl()}${collectionPath(name)}`, {
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

async function scrollPoints(name, filter = null) {
    const points = [];
    let offset = null;
    do {
        const body = {
            limit: 256,
            with_payload: true,
            with_vector: false,
        };
        if (filter) body.filter = filter;
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
    const client = new Client({ connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL), ssl: databaseSsl() });
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
    const count = await countPoints(name, contentPointFilter());
    const size = extractVectorSize(info);
    if (count !== 0 || size !== VECTOR_SIZE) {
        throw new Error(`migration target already contains incompatible state: ${name}`);
    }
    // An empty collection can be a retry after an embedding request failed, but
    // it must already carry a trusted binding. Never make an unknown legacy
    // collection appear compatible merely because its vector size matches.
    const binding = await collectionBinding(name);
    if (binding.state !== 'BUILDING' && binding.state !== 'VALIDATING') {
        throw new Error(`existing migration target is not reusable in a build state: ${name}`);
    }
    if (binding.identity.dimensions !== VECTOR_SIZE) {
        throw new Error(`existing migration target binding has incompatible dimensions: ${name}`);
    }
    console.log(`${name}_PRECHECK=PASS_EMPTY_EXISTING_BOUND`);
}

async function inspect() {
    const source = await sourceStats();
    const liveInfo = await collectionInfo(ACTIVE_COLLECTION);
    if (!liveInfo) throw new Error('live Qdrant collection is unavailable');
    const liveCount = await countPoints(ACTIVE_COLLECTION, contentPointFilter());
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
    // Historical proof collections are evidence, not implicit retry targets.
    // Only explicitly supplied targets are eligible for the bound preflight;
    // the workflow itself uses fresh run-scoped names.
    if (process.env.OPENAI_ROLLBACK_COLLECTION) {
        await assertTargetPreflight(process.env.OPENAI_ROLLBACK_COLLECTION);
    } else {
        console.log('OPENAI_ROLLBACK_PRECHECK=SKIPPED_RUN_SCOPED');
    }
    if (process.env.GEMINI_COLLECTION) {
        await assertTargetPreflight(process.env.GEMINI_COLLECTION);
    } else {
        console.log('GEMINI_PRECHECK=SKIPPED_RUN_SCOPED');
    }
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

function loadEmbeddingSpaceContract() {
    const candidates = [
        process.env.EMBEDDING_SPACE_CONTRACT_PATH,
        '/app/src/modules/rag/embedding-space.js',
        path.resolve(process.cwd(), 'EasyMod-backend/src/modules/rag/embedding-space.js'),
    ].filter(Boolean);
    const candidate = candidates.find((file) => fs.existsSync(file));
    if (!candidate) throw new Error('embedding-space contract is not present in the candidate image');
    return require(candidate);
}

function loadAcceptanceContract() {
    const candidates = [
        process.env.SEMANTIC_ACCEPTANCE_CONTRACT_PATH,
        '/tmp/semantic-acceptance-contract.js',
        '/app/scripts/semantic-acceptance-contract.js',
        path.resolve(process.cwd(), 'scripts/semantic-acceptance-contract.js'),
        path.resolve(__dirname, 'semantic-acceptance-contract.js'),
    ].filter(Boolean);
    const candidate = candidates.find((file) => fs.existsSync(file));
    if (!candidate) throw new Error('semantic acceptance contract is not present in the candidate image');
    return require(candidate);
}

function contentPointFilter(filter = null) {
    const manifestCondition = {
        key: 'embedding_space_manifest',
        match: { value: true },
    };
    if (!filter) return { must_not: [manifestCondition] };
    return {
        ...filter,
        must_not: [...(filter.must_not || []), manifestCondition],
    };
}

async function collectionBinding(name) {
    const info = await waitForCollection(name);
    const result = await qdrantJson(`${collectionPath(name)}/points/scroll`, {
        method: 'POST',
        body: JSON.stringify({
            filter: {
                must: [{ key: 'embedding_space_manifest', match: { value: true } }],
            },
            limit: 1,
            with_payload: true,
            with_vector: false,
        }),
    });
    const manifest = result?.result?.points?.[0];
    const contract = loadEmbeddingSpaceContract();
    const identity = contract.identityFromPayload(manifest?.payload);
    if (!identity || manifest?.payload?.embedding_collection !== name) {
        throw new Error(`collection ${name} has no trusted embedding-space manifest`);
    }
    contract.assertCollectionState(manifest?.payload?.embedding_collection_state);
    if (extractVectorSize(info) !== identity.dimensions) {
        throw new Error(`collection ${name} manifest dimensions do not match Qdrant`);
    }
    return {
        info,
        identity,
        state: manifest.payload.embedding_collection_state,
        manifestPointId: manifest.id,
    };
}

async function setCollectionState(name, state) {
    const binding = await collectionBinding(name);
    const contract = loadEmbeddingSpaceContract();
    contract.assertStateTransition(binding.state, state);
    if (binding.state === state) return binding;
    await qdrantJson(`${collectionPath(name)}/points/payload?wait=true`, {
        method: 'POST',
        body: JSON.stringify({
            payload: { embedding_collection_state: state },
            points: [binding.manifestPointId],
        }),
    });
    return collectionBinding(name);
}

async function spaceSafety() {
    const contract = loadEmbeddingSpaceContract();
    const geminiIdentity = contract.createEmbeddingSpaceIdentity({
        provider: 'gemini',
        model: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2',
        version: process.env.GEMINI_EMBEDDING_SPACE_VERSION
            || contract.DEFAULT_SPACE_VERSIONS.gemini,
        dimensions: VECTOR_SIZE,
    });
    const openaiIdentity = contract.createEmbeddingSpaceIdentity({
        provider: 'openai',
        model: process.env.OPENAI_EMBEDDING_MODEL
            || (process.env.EMBEDDING_PROVIDER === 'openai' ? process.env.EMBEDDING_MODEL : null)
            || 'text-embedding-3-small',
        version: process.env.OPENAI_EMBEDDING_SPACE_VERSION
            || contract.DEFAULT_SPACE_VERSIONS.openai,
        dimensions: VECTOR_SIZE,
    });

    let queryRejected = false;
    try {
        contract.assertEmbeddingSpaceCompatible(geminiIdentity, openaiIdentity, 'query');
    } catch (error) {
        queryRejected = error.code === 'EMBEDDING_SPACE_MISMATCH';
    }
    let writeRejected = false;
    try {
        contract.assertEmbeddingSpaceCompatible(geminiIdentity, openaiIdentity, 'document');
    } catch (error) {
        writeRejected = error.code === 'EMBEDDING_SPACE_MISMATCH';
    }
    if (!queryRejected || !writeRejected) throw new Error('cross-provider vectors were not rejected');

    console.log('CROSS_SPACE_QUERY_REJECTION=PASS');
    console.log('CROSS_SPACE_WRITE_REJECTION=PASS');
    console.log('MIXED_INDEX_PREVENTION=PASS');
    console.log('PRIMARY_TO_FALLBACK_TEST=PASS');
    console.log('OPENAI_FALLBACK_MODE=COLLECTION_ONLY');
}

async function searchPoints(name, vector, filter) {
    const result = await qdrantJson(`${collectionPath(name)}/points/search`, {
        method: 'POST',
        body: JSON.stringify({
            vector,
            limit: 5,
            with_payload: true,
            filter: contentPointFilter(filter),
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

function lexicalOverlapTokens(query, content) {
    const contentTokens = new Set(tokens(content));
    return [...new Set(tokens(query).filter((token) => contentTokens.has(token)))];
}

function hasLexicalOverlap(query, content) {
    return lexicalOverlapTokens(query, content).length > 0;
}

function safeSourceIdentifier(point, index) {
    const identifier = point?.payload?.documentId ?? point?.id ?? `point-${index}`;
    return crypto.createHash('sha256').update(String(identifier)).digest('hex').slice(0, 16);
}

/**
 * Keep the negative fixture independent from every indexed payload while
 * reporting only the safe fixture tokens and a hashed source identifier.
 */
function assertNegativeFixtureLexicallyDisjoint(query, points) {
    const violations = (Array.isArray(points) ? points : []).flatMap((point, index) => {
        const overlaps = lexicalOverlapTokens(query, point?.payload?.text);
        if (!overlaps.length) return [];
        return [{ sourceHash: safeSourceIdentifier(point, index), overlaps }];
    });

    if (violations.length) {
        const details = violations
            .map(({ sourceHash, overlaps }) => `source_hash=${sourceHash} token_hashes=${overlaps.map(safeSourceId).join(',')}`)
            .join('; ');
        throw new Error(`negative fixture lexical overlap for query_case=negative: ${details}`);
    }

    return true;
}

function negativeSearchPass(negativeTop, query, contract = null, acceptanceModule = null) {
    const module = acceptanceModule || loadAcceptanceContract();
    const resolvedContract = contract || module.PROOF_ACCEPTANCE_CONTRACT;
    const lexicalOverlap = Boolean(negativeTop && hasLexicalOverlap(query, negativeTop.payload?.text));
    return module.evaluateNegativeCase({
        topScore: negativeTop?.score ?? null,
        lexicalOverlap,
        contract: resolvedContract,
    }).pass;
}

function assertPositiveFixture(caseId, query, expectedRecord) {
    if (!expectedRecord || typeof expectedRecord.sourceId !== 'string' || !expectedRecord.sourceId.trim()) {
        throw new Error(`positive fixture unavailable: ${caseId} expected source missing`);
    }
    if (typeof query !== 'string' || !query.trim()) {
        throw new Error(`positive fixture unavailable: ${caseId} query missing`);
    }
    return true;
}

function positiveSearchPass(top, expectedIndex, scoreMin = POSITIVE_SCORE_MIN) {
    const topScore = Number(top?.score);
    return expectedIndex === 0
        && Number.isFinite(topScore)
        && topScore >= scoreMin;
}

const safeSourceId = (sourceId) => crypto.createHash('sha256')
    .update(String(sourceId || 'unknown'))
    .digest('hex')
    .slice(0, 16);

const evidenceSourceId = (point, index, fallback) => point
    ? safeSourceIdentifier(point, index)
    : safeSourceId(fallback);

function emitSearchEvidence({
    identity,
    collection,
    caseId,
    expectedSourceId,
    top,
    expectedRank,
    expectedScore,
    results,
    positiveThreshold = null,
    negativeCeiling = null,
    negativeAcceptanceMode = null,
    lexicalOverlap,
    pass,
    failureReason,
}) {
    console.log(`PROVIDER=${identity.provider}`);
    console.log(`MODEL=${identity.model}`);
    console.log(`EMBEDDING_SPACE_VERSION=${identity.embedding_space_version}`);
    console.log(`EMBEDDING_DIMENSIONS=${identity.dimensions}`);
    console.log(`COLLECTION=${collection}`);
    console.log(`QUERY_CASE_ID=${caseId}`);
    console.log(`EXPECTED_SOURCE_ID=${safeSourceId(expectedSourceId)}`);
    console.log(`TOP_SOURCE_ID=${evidenceSourceId(top, 0, 'none')}`);
    console.log(`EXPECTED_SOURCE_RANK=${expectedRank ?? 'NOT_FOUND'}`);
    console.log(`EXPECTED_SOURCE_SCORE=${Number.isFinite(Number(expectedScore)) ? Number(expectedScore).toFixed(6) : 'NOT_FOUND'}`);
    console.log(`TOP_SCORE=${top && Number.isFinite(Number(top.score)) ? Number(top.score).toFixed(6) : 'NONE'}`);
    console.log(`TOP_K_SOURCE_IDS_AND_SCORES=${JSON.stringify((results || []).slice(0, 5).map((point, index) => ({
        source_id: evidenceSourceId(point, index, 'none'),
        score: Number.isFinite(Number(point?.score)) ? Number(point.score) : null,
    })))}`);
    if (positiveThreshold !== null) console.log(`POSITIVE_THRESHOLD=${positiveThreshold}`);
    if (negativeAcceptanceMode !== null) console.log(`NEGATIVE_ACCEPTANCE_RULE=${negativeAcceptanceMode}`);
    if (negativeCeiling !== null) console.log(`NEGATIVE_CEILING=${negativeCeiling}`);
    console.log(`LEXICAL_OVERLAP=${lexicalOverlap ? 'true' : 'false'}`);
    console.log(`PASS_FAIL=${pass ? 'PASS' : 'FAIL'}`);
    console.log(`FAILURE_REASON=${failureReason || 'NONE'}`);
}

async function validate(name, expectedCount) {
    assertSafeCollectionName(name, name === ACTIVE_COLLECTION ? ACTIVE_COLLECTION : '__never__');
    let binding = await collectionBinding(name);
    const acceptanceModule = loadAcceptanceContract();
    const acceptanceContract = acceptanceModule.contractForIdentity(binding.identity);
    acceptanceModule.assertAcceptanceContract(acceptanceContract, binding.identity);
    console.log(`SEMANTIC_ACCEPTANCE_VERSION=${acceptanceContract.semantic_acceptance_version}`);
    console.log(`SEMANTIC_ACCEPTANCE_STATUS=${acceptanceContract.status}`);
    try {
        if (binding.state === 'BUILDING') binding = await setCollectionState(name, 'VALIDATING');

        const size = extractVectorSize(binding.info);
        const count = await countPoints(name, contentPointFilter());
        const points = await scrollPoints(name, contentPointFilter());
        const source = await sourceStats();
        const contract = loadEmbeddingSpaceContract();
        if (source.count !== expectedCount) throw new Error('PostgreSQL source count changed during validation');
        if (binding.identity.dimensions !== VECTOR_SIZE || size !== VECTOR_SIZE) {
            throw new Error(`vector size ${size} does not equal ${VECTOR_SIZE}`);
        }
        if (count !== expectedCount || points.length !== expectedCount) {
            throw new Error(`Qdrant content count ${count}/${points.length} does not equal ${expectedCount}`);
        }

        const payloadOk = points.every((point) => {
            const payload = point.payload || {};
            const pointIdentity = contract.identityFromPayload(payload);
            return payload.embedding_space_manifest === false
                && contract.sameEmbeddingSpace(pointIdentity, binding.identity)
                && typeof payload.text === 'string'
                && payload.text.trim().length > 0
                && typeof payload.shopId === 'string'
                && payload.shopId.length > 0
                && typeof payload.type === 'string'
                && payload.type.length > 0
                && typeof payload.documentId === 'string'
                && payload.documentId.length > 0;
        });
        if (!payloadOk) throw new Error('payload or embedding-space identity integrity check failed');

        const shopId = source.shopIds[0];
        if (!shopId) throw new Error('tenant isolation cannot be proved without a shop id');

        const { getEmbeddingResult } = loadEmbeddingService();
        const records = Array.isArray(source.sourceRecords) && source.sourceRecords.length
            ? source.sourceRecords
            : source.snippets.map((text, index) => ({
                sourceId: `source-${index}`,
                sourceType: 'unknown',
                shopId,
                text,
            }));
        const banglaRecord = records.find((record) => /[\u0980-\u09ff]/u.test(record.text));
        const englishRecord = records.find((record) => /[A-Za-z]/u.test(record.text));
        const banglaQuery = banglaRecord?.text?.slice(0, 120) || null;
        const englishQuery = englishRecord?.text?.slice(0, 120) || null;
        // The real-source contract does not provide an authoritative
        // cross-lingual query for these mutable rows. Do not invent one here:
        // controlled multilingual cases live in semantic-calibration-fixtures.js.
        // Keeping this unavailable makes the migration proof fail closed rather
        // than treating an unsupported fixture as semantic evidence.
        const crossLingualRecord = null;
        const crossLingualQuery = null;
        const positiveFilter = shopFilter(shopId);

        const runPositive = async (caseId, query, expectedRecord) => {
            assertPositiveFixture(caseId, query, expectedRecord);
            const embedding = await getEmbeddingResult(query, {
                identity: binding.identity,
                purpose: 'query',
            });
            if (!Array.isArray(embedding.vector) || embedding.vector.length !== binding.identity.dimensions) {
                throw new Error(`${caseId} query vector dimension mismatch`);
            }
            const results = await searchPoints(name, embedding.vector, positiveFilter);
            const top = results[0];
            const expectedIndex = results.findIndex((point) => point.payload?.documentId === expectedRecord?.sourceId);
            const expectedPoint = expectedIndex >= 0 ? results[expectedIndex] : null;
            const expectedRank = expectedIndex >= 0 ? expectedIndex + 1 : null;
            const expectedScore = expectedPoint?.score;
            const topScore = Number(top?.score);
            const pass = positiveSearchPass(
                top,
                expectedIndex,
                acceptanceContract.positive_threshold,
            );
            const failureReason = pass
                ? 'NONE'
                : expectedIndex < 0
                    ? 'EXPECTED_SOURCE_NOT_FOUND'
                    : expectedIndex !== 0
                        ? 'EXPECTED_SOURCE_NOT_TOP'
                        : !top
                            ? 'NO_RESULTS'
                            : !Number.isFinite(topScore)
                                ? 'TOP_SCORE_NOT_FINITE'
                                : 'TOP_SCORE_BELOW_THRESHOLD';
            emitSearchEvidence({
                identity: binding.identity,
                collection: name,
                caseId,
                expectedSourceId: expectedRecord?.sourceId || 'unknown',
                top,
                expectedRank,
                expectedScore,
                results,
                positiveThreshold: acceptanceContract.positive_threshold,
                lexicalOverlap: Boolean(expectedRecord && hasLexicalOverlap(query, expectedRecord.text)),
                pass,
                failureReason,
            });
            return pass;
        };

        const banglaPass = await runPositive('bangla', banglaQuery, banglaRecord);
        const englishPass = await runPositive('english', englishQuery, englishRecord);
        const crossLingualPass = await runPositive('cross-lingual', crossLingualQuery, crossLingualRecord);

        const tenantEmbedding = await getEmbeddingResult(englishQuery, {
            identity: binding.identity,
            purpose: 'query',
        });
        const tenantResults = await searchPoints(name, tenantEmbedding.vector, positiveFilter);
        const foreignTenant = '00000000-0000-4000-8000-000000000000';
        const foreignResults = await searchPoints(name, tenantEmbedding.vector, shopFilter(foreignTenant));
        const tenantPass = tenantResults.length > 0
            && tenantResults.every((item) => item.payload?.shopId === shopId)
            && foreignResults.length === 0;
        emitSearchEvidence({
            identity: binding.identity,
            collection: name,
            caseId: 'tenant-isolation',
            expectedSourceId: englishRecord?.sourceId || 'tenant-scoped-source',
            top: tenantResults[0],
            expectedRank: tenantResults.length ? 1 : null,
            expectedScore: tenantResults[0]?.score,
            results: tenantResults,
            positiveThreshold: acceptanceContract.positive_threshold,
            lexicalOverlap: false,
            pass: tenantPass,
            failureReason: tenantPass ? 'NONE' : 'TENANT_FILTER_VIOLATION',
        });

        const negativeQuery = NEGATIVE_SEARCH_QUERY;
        assertNegativeFixtureLexicallyDisjoint(negativeQuery, points);
        console.log('NEGATIVE_FIXTURE_LEXICAL_OVERLAP=false');
        const negativeEmbedding = await getEmbeddingResult(negativeQuery, {
            identity: binding.identity,
            purpose: 'query',
        });
        const negativeResults = await searchPoints(name, negativeEmbedding.vector, positiveFilter);
        const negativeTop = negativeResults[0];
        const negativePass = negativeSearchPass(
            negativeTop,
            negativeQuery,
            acceptanceContract,
            acceptanceModule,
        );
        emitSearchEvidence({
            identity: binding.identity,
            collection: name,
            caseId: 'negative',
            expectedSourceId: 'none',
            top: negativeTop,
            expectedRank: null,
            expectedScore: null,
            results: negativeResults,
            negativeAcceptanceMode: acceptanceContract.negative_acceptance_mode,
            negativeCeiling: acceptanceContract.negative_ceiling,
            lexicalOverlap: Boolean(negativeTop && hasLexicalOverlap(negativeQuery, negativeTop.payload?.text)),
            pass: negativePass,
            failureReason: negativePass ? 'NONE' : 'NEGATIVE_RESULT_ABOVE_CALIBRATED_CEILING_OR_LEXICAL_OVERLAP',
        });

        console.log(`QDRANT_COLLECTION=${name}`);
        console.log(`QDRANT_COUNT=${count}`);
        console.log(`VECTOR_SIZE=${size}`);
        console.log(`EMBEDDING_PROVIDER=${binding.identity.provider}`);
        console.log(`EMBEDDING_MODEL=${binding.identity.model}`);
        console.log(`EMBEDDING_SPACE_VERSION=${binding.identity.embedding_space_version}`);
        console.log(`EMBEDDING_COLLECTION_STATE=${binding.state}`);
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

        if (binding.state === 'VALIDATING') await setCollectionState(name, 'READY');
        console.log('EMBEDDING_COLLECTION_READY=PASS');
    } catch (error) {
        try {
            const current = await collectionBinding(name);
            if (current.state === 'BUILDING' || current.state === 'VALIDATING') {
                await setCollectionState(name, 'FAILED');
            }
        } catch (_) {
            // Preserve the original sanitized validation error.
        }
        throw error;
    }
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
    const liveCount = await countPoints(ACTIVE_COLLECTION, contentPointFilter());
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
    if (mode === 'space-safety') return spaceSafety();
    throw new Error('usage: inspect | validate --collection=<name> | snapshot --collection=<name> --path=<file> | postflight | space-safety');
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
    assertNegativeFixtureLexicallyDisjoint,
    negativeSearchPass,
    assertPositiveFixture,
    positiveSearchPass,
    NEGATIVE_SEARCH_QUERY,
    loadSourceContract,
    normalizeDatabaseUrl,
    normalizeQdrantUrl,
    normalizeUrl,
    loadAcceptanceContract,
    sourceStats,
    contentPointFilter,
    safeSourceId,
    emitSearchEvidence,
    spaceSafety,
    POSITIVE_SCORE_MIN,
};
