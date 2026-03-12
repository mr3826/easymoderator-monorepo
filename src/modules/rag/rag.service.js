const crypto = require('crypto');
const { getEmbedding } = require('./embedding.service');

const config = require('../../config/config');
let Pinecone = null;
try {
    ({ Pinecone } = require('@pinecone-database/pinecone'));
} catch (_) {
    Pinecone = null;
}

const pineconeApiKey = process.env.PINECONE_API_KEY;
const pineconeIndexName = process.env.PINECONE_INDEX;
const pineconeNamespace = process.env.PINECONE_NAMESPACE || process.env.QDRANT_COLLECTION || 'knowledge_documents';
const usePinecone = Boolean(Pinecone && pineconeApiKey && pineconeIndexName);

const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
const qdrantCollection = process.env.QDRANT_COLLECTION || 'knowledge_documents';
const vectorSize = Number.parseInt(process.env.QDRANT_VECTOR_SIZE || '384', 10);
const qdrantApiKey = process.env.QDRANT_API_KEY;
// When true, each shop gets its own Qdrant collection / Pinecone namespace for strict data isolation
const perTenantMode = process.env.QDRANT_PER_TENANT === 'true';
let pineconeNamespaceClient = null;

// P1-5: Require API key when Qdrant is used in production (VPC-only; rotate leaked keys)
if ((config.env === 'production' || config.env === 'staging') && qdrantUrl && qdrantUrl.includes('6333') && !qdrantApiKey) {
    console.warn('⚠️  QDRANT_API_KEY should be set when using Qdrant in production. Run Qdrant on VPC-internal IP only.');
}

const normalizeText = (text) => (text || '').toString().trim();

const resolveCollectionName = (shopId) => {
    if (perTenantMode && shopId) {
        return `${qdrantCollection}_${shopId}`;
    }
    return qdrantCollection;
};

const getPineconeNamespace = async (shopId) => {
    if (!usePinecone) {
        throw new Error('Pinecone is not configured');
    }

    const ns = perTenantMode && shopId ? shopId : pineconeNamespace;
    if (ns === pineconeNamespace && pineconeNamespaceClient) return pineconeNamespaceClient;

    const pc = new Pinecone({ apiKey: pineconeApiKey });
    const client = pc.index(pineconeIndexName).namespace(ns);
    if (ns === pineconeNamespace) pineconeNamespaceClient = client;
    return client;
};

const getQdrantHeaders = () => {
    const headers = { 'Content-Type': 'application/json' };
    if (qdrantApiKey) {
        headers['api-key'] = qdrantApiKey;
    }
    return headers;
};

const ensureCollection = async (shopId) => {
    if (usePinecone) {
        await getPineconeNamespace(shopId);
        return;
    }

    const collection = resolveCollectionName(shopId);
    const collectionResponse = await fetch(`${qdrantUrl}/collections/${collection}`, {
        headers: getQdrantHeaders()
    });
    if (collectionResponse.ok) return;

    if (collectionResponse.status !== 404) {
        const errorText = await collectionResponse.text();
        throw new Error(`Qdrant collection check failed: ${errorText}`);
    }

    const createResponse = await fetch(`${qdrantUrl}/collections/${collection}`, {
        method: 'PUT',
        headers: getQdrantHeaders(),
        body: JSON.stringify({
            vectors: {
                size: vectorSize,
                distance: 'Cosine'
            }
        })
    });

    if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(`Failed to create Qdrant collection: ${errorText}`);
    }
};

const upsertPoint = async ({ id, vector, payload, shopId }) => {
    if (usePinecone) {
        const ns = await getPineconeNamespace(shopId);
        await ns.upsert([
            {
                id: String(id),
                values: vector,
                metadata: payload
            }
        ]);
        return;
    }

    const collection = resolveCollectionName(shopId);
    const response = await fetch(`${qdrantUrl}/collections/${collection}/points?wait=true`, {
        method: 'PUT',
        headers: getQdrantHeaders(),
        body: JSON.stringify({
            points: [
                {
                    id,
                    vector,
                    payload
                }
            ]
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Qdrant upsert failed: ${errorText}`);
    }
};

const searchPoints = async ({ vector, limit = 5, filter, shopId }) => {
    if (usePinecone) {
        const ns = await getPineconeNamespace(shopId);
        // In per-tenant mode, no shopId filter needed (namespace already isolates)
        const pineconeFilter = perTenantMode ? buildPineconeFilter(filter) : buildPineconeFilter(filter);
        const result = await ns.query({
            vector,
            topK: limit,
            includeMetadata: true,
            filter: pineconeFilter
        });

        return (result.matches || []).map((item) => ({
            score: item.score,
            payload: item.metadata || {}
        }));
    }

    const collection = resolveCollectionName(shopId);
    // In per-tenant mode, no shopId filter needed (collection already isolates)
    const searchFilter = perTenantMode ? (filter && !filter.must ? filter : undefined) : filter;
    const response = await fetch(`${qdrantUrl}/collections/${collection}/points/search`, {
        method: 'POST',
        headers: getQdrantHeaders(),
        body: JSON.stringify({
            vector,
            limit,
            filter: searchFilter
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Qdrant search failed: ${errorText}`);
    }

    const result = await response.json();
    return result.result || [];
};

const deletePoint = async (id, shopId) => {
    if (usePinecone) {
        const ns = await getPineconeNamespace(shopId);
        await ns.deleteOne(String(id));
        return;
    }

    const collection = resolveCollectionName(shopId);
    const response = await fetch(`${qdrantUrl}/collections/${collection}/points/delete?wait=true`, {
        method: 'POST',
        headers: getQdrantHeaders(),
        body: JSON.stringify({ points: [id] })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Qdrant delete failed: ${errorText}`);
    }
};

const buildPineconeFilter = (qdrantFilter) => {
    if (!qdrantFilter || !qdrantFilter.must) return undefined;

    const andConditions = qdrantFilter.must
        .filter((item) => item && item.key && item.match && item.match.value !== undefined)
        .map((item) => ({ [item.key]: { '$eq': item.match.value } }));

    if (!andConditions.length) return undefined;
    if (andConditions.length === 1) return andConditions[0];
    return { '$and': andConditions };
};

const buildShopFilter = (shopId, extraFilters) => {
    if (!shopId) return extraFilters;

    const shopFilter = {
        must: [
            {
                key: 'shopId',
                match: { value: shopId }
            }
        ]
    };

    if (!extraFilters) return shopFilter;
    if (extraFilters.must || extraFilters.should || extraFilters.must_not) {
        return {
            ...extraFilters,
            must: [...(extraFilters.must || []), ...shopFilter.must]
        };
    }

    return {
        must: [shopFilter, extraFilters]
    };
};

const ingestData = async ({ text, metadata = {} }) => {
    const content = normalizeText(text);
    if (!content) {
        throw new Error('No text provided for ingestion');
    }

    const shopId = metadata.shopId || null;

    try {
        await ensureCollection(shopId);

        const pointId = metadata.documentId || crypto.randomUUID();
        const vector = await getEmbedding(content);

        await upsertPoint({
            id: pointId,
            vector,
            shopId,
            payload: {
                text: content,
                ...metadata
            }
        });

        return {
            success: true,
            message: 'Data ingested successfully',
            ingestionId: pointId
        };
    } catch (error) {
        console.warn('RAG ingestion skipped (service unavailable):', error.message);
        return { success: false, message: 'RAG service unavailable', ingestionId: null };
    }
};

const queryData = async ({ query, limit = 5, filters, shopId }) => {
    const content = normalizeText(query);
    if (!content) {
        throw new Error('Query text is required');
    }

    await ensureCollection(shopId);

    const vector = await getEmbedding(content);
    // In per-tenant mode the collection already isolates by shop; skip the shopId filter
    const searchFilter = perTenantMode ? filters : buildShopFilter(shopId, filters);
    const results = await searchPoints({
        vector,
        limit,
        filter: searchFilter,
        shopId
    });

    return {
        success: true,
        provider: usePinecone ? 'pinecone' : 'qdrant',
        results: results.map((item) => ({
            content: item.payload?.text || '',
            score: item.score,
            metadata: item.payload || {}
        }))
    };
};

module.exports = {
    ingestData,
    queryData,
    deletePoint
};
