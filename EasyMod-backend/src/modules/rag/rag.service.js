const crypto = require('crypto');
const { getEmbedding } = require('./embedding.service');

const config = require('../../config/config');

// Vector store: Qdrant only (Pinecone removed 2026-05-31 — one vector store).
// Qdrant REST API uses paths without a /v1/ prefix (both old and current versions).
// Always pin QDRANT_URL to the server root, e.g. http://qdrant:6333
const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
const qdrantCollection = process.env.QDRANT_COLLECTION || 'knowledge_documents';
const vectorSize = Number.parseInt(process.env.QDRANT_VECTOR_SIZE || '384', 10);
const qdrantApiKey = process.env.QDRANT_API_KEY;
// When true, each shop gets its own Qdrant collection for strict data isolation
const perTenantMode = process.env.QDRANT_PER_TENANT === 'true';

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

const getQdrantHeaders = () => {
    const headers = { 'Content-Type': 'application/json' };
    if (qdrantApiKey) {
        headers['api-key'] = qdrantApiKey;
    }
    return headers;
};

const ensureCollection = async (shopId) => {
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
        provider: 'qdrant',
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
