'use strict';

/**
 * Canonical identity for a Qdrant embedding space.
 *
 * Vector length is only one part of compatibility. Provider, model, input
 * contract version, and dimensions must all match before vectors are compared
 * or persisted together.
 */
const EMBEDDING_SPACE_STATES = Object.freeze({
    BUILDING: 'BUILDING',
    VALIDATING: 'VALIDATING',
    READY: 'READY',
    ACTIVE: 'ACTIVE',
    FAILED: 'FAILED',
});

const QUERYABLE_STATES = new Set([
    EMBEDDING_SPACE_STATES.READY,
    EMBEDDING_SPACE_STATES.ACTIVE,
]);

const WRITABLE_STATES = new Set([
    EMBEDDING_SPACE_STATES.BUILDING,
    EMBEDDING_SPACE_STATES.VALIDATING,
    EMBEDDING_SPACE_STATES.READY,
    EMBEDDING_SPACE_STATES.ACTIVE,
]);

const EMBEDDING_SPACE_MANIFEST_FIELD = 'embedding_space_manifest';
const EMBEDDING_SPACE_MANIFEST_POINT_ID = '00000000-0000-4000-8000-000000000001';

const DEFAULT_SPACE_VERSIONS = Object.freeze({
    gemini: 'gemini-embedding-2-search-v1',
    openai: 'openai-text-embedding-3-small-v1',
    gcp: 'gcp-embedding-v1',
    local: 'local-ngram-v1',
});

const normalizeStringField = (value, field) => {
    const normalized = String(value ?? '').trim();
    if (!normalized || /[\u0000-\u001f\u007f]/u.test(normalized)) {
        throw new Error(`embedding space ${field} is invalid`);
    }
    return normalized;
};

const createEmbeddingSpaceIdentity = ({ provider, model, version, dimensions }) => {
    const normalizedDimensions = Number(dimensions);
    if (!Number.isInteger(normalizedDimensions) || normalizedDimensions <= 0) {
        throw new Error('embedding space dimensions must be a positive integer');
    }

    return Object.freeze({
        provider: normalizeStringField(provider, 'provider').toLowerCase(),
        model: normalizeStringField(model, 'model'),
        embedding_space_version: normalizeStringField(version, 'version'),
        dimensions: normalizedDimensions,
    });
};

const identityToPayload = (identity) => ({
    embedding_provider: identity.provider,
    embedding_model: identity.model,
    embedding_space_version: identity.embedding_space_version,
    embedding_dimensions: identity.dimensions,
});

const identityFromPayload = (payload = {}) => {
    if (!payload.embedding_provider || !payload.embedding_model
        || !payload.embedding_space_version || !payload.embedding_dimensions) return null;

    return createEmbeddingSpaceIdentity({
        provider: payload.embedding_provider,
        model: payload.embedding_model,
        version: payload.embedding_space_version,
        dimensions: payload.embedding_dimensions,
    });
};

const sameEmbeddingSpace = (left, right) => Boolean(
    left
    && right
    && left.provider === right.provider
    && left.model === right.model
    && left.embedding_space_version === right.embedding_space_version
    && Number(left.dimensions) === Number(right.dimensions)
);

const describeIdentity = (identity) => identity
    ? `${identity.provider}/${identity.model}/${identity.embedding_space_version}/${identity.dimensions}`
    : 'unknown';

const assertEmbeddingSpaceCompatible = (collectionIdentity, vectorIdentity, context = 'vector') => {
    if (sameEmbeddingSpace(collectionIdentity, vectorIdentity)) return true;

    const error = new Error(
        `${context} embedding space does not match collection binding: `
        + `collection=${describeIdentity(collectionIdentity)} `
        + `vector=${describeIdentity(vectorIdentity)}`,
    );
    error.name = 'EmbeddingSpaceMismatchError';
    error.code = 'EMBEDDING_SPACE_MISMATCH';
    error.collectionIdentity = collectionIdentity;
    error.vectorIdentity = vectorIdentity;
    throw error;
};

const assertCollectionState = (state) => {
    if (!Object.values(EMBEDDING_SPACE_STATES).includes(state)) {
        throw new Error(`unknown embedding collection state: ${state}`);
    }
    return state;
};

const assertStateTransition = (from, to) => {
    assertCollectionState(from);
    assertCollectionState(to);
    if (from === to) return true;

    const allowed = {
        BUILDING: new Set(['VALIDATING', 'FAILED']),
        VALIDATING: new Set(['READY', 'FAILED']),
        READY: new Set(['ACTIVE', 'FAILED']),
        ACTIVE: new Set(['READY', 'FAILED']),
        FAILED: new Set(),
    };

    if (!allowed[from]?.has(to)) {
        throw new Error(`invalid embedding collection state transition: ${from} -> ${to}`);
    }
    return true;
};

const isQueryableState = (state) => QUERYABLE_STATES.has(state);
const isWritableState = (state) => WRITABLE_STATES.has(state);

const createManifestPayload = ({ collection, identity, state }) => {
    assertCollectionState(state);
    return {
        [EMBEDDING_SPACE_MANIFEST_FIELD]: true,
        embedding_collection: normalizeStringField(collection, 'collection'),
        ...identityToPayload(identity),
        embedding_collection_state: state,
        embedding_manifest_version: 1,
    };
};

const createManifestVector = (dimensions) => {
    const vector = new Array(Number(dimensions)).fill(0);
    vector[0] = 1;
    return vector;
};

module.exports = {
    DEFAULT_SPACE_VERSIONS,
    EMBEDDING_SPACE_MANIFEST_FIELD,
    EMBEDDING_SPACE_MANIFEST_POINT_ID,
    EMBEDDING_SPACE_STATES,
    createEmbeddingSpaceIdentity,
    createManifestPayload,
    createManifestVector,
    identityFromPayload,
    identityToPayload,
    sameEmbeddingSpace,
    assertEmbeddingSpaceCompatible,
    assertCollectionState,
    assertStateTransition,
    isQueryableState,
    isWritableState,
};
