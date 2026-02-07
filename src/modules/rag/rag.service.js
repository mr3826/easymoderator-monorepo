const crypto = require('crypto');
const { getEmbedding } = require('./embedding.service');

const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
const qdrantCollection = process.env.QDRANT_COLLECTION || 'knowledge_documents';
const vectorSize = Number.parseInt(process.env.QDRANT_VECTOR_SIZE || '384', 10);
const qdrantApiKey = process.env.QDRANT_API_KEY;

const normalizeText = (text) => (text || '').toString().trim();

const getQdrantHeaders = () => {
    const headers = { 'Content-Type': 'application/json' };
    if (qdrantApiKey) {
        headers['api-key'] = qdrantApiKey;
    }
    return headers;
};

const ensureCollection = async () => {
    const collectionResponse = await fetch(`${qdrantUrl}/collections/${qdrantCollection}`, {
        headers: getQdrantHeaders()
    });
    if (collectionResponse.ok) return;

    if (collectionResponse.status !== 404) {
        const errorText = await collectionResponse.text();
        throw new Error(`Qdrant collection check failed: ${errorText}`);
    }

    const createResponse = await fetch(`${qdrantUrl}/collections/${qdrantCollection}`, {
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

const upsertPoint = async ({ id, vector, payload }) => {
    const response = await fetch(`${qdrantUrl}/collections/${qdrantCollection}/points?wait=true`, {
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

const searchPoints = async ({ vector, limit = 5, filter }) => {
    const response = await fetch(`${qdrantUrl}/collections/${qdrantCollection}/points/search`, {
        method: 'POST',
        headers: getQdrantHeaders(),
        body: JSON.stringify({
            vector,
            limit,
            filter
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Qdrant search failed: ${errorText}`);
    }

    const result = await response.json();
    return result.result || [];
};

const deletePoint = async (id) => {
    const response = await fetch(`${qdrantUrl}/collections/${qdrantCollection}/points/delete?wait=true`, {
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

    await ensureCollection();

    const pointId = metadata.documentId || crypto.randomUUID();
    const vector = await getEmbedding(content);

    await upsertPoint({
        id: pointId,
        vector,
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
};

const queryData = async ({ query, limit = 5, filters, shopId }) => {
    const content = normalizeText(query);
    if (!content) {
        throw new Error('Query text is required');
    }

    await ensureCollection();

    const vector = await getEmbedding(content);
    const results = await searchPoints({
        vector,
        limit,
        filter: buildShopFilter(shopId, filters)
    });

    return {
        success: true,
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