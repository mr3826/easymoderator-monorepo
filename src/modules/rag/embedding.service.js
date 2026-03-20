const vectorSize = Number.parseInt(process.env.QDRANT_VECTOR_SIZE || '384', 10);

const normalizeText = (text) => (text || '').toString().trim();

// ── Local embedding ───────────────────────────────────────────────────────────
// Character n-gram hash fallback — NOT semantically meaningful.
// Use EMBEDDING_PROVIDER=openai with a real model in production.
// ─────────────────────────────────────────────────────────────────────────────
const localEmbed = (text) => {
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '⚠️  WARNING: Using local (non-semantic) embedding in production. ' +
      'Set EMBEDDING_PROVIDER=openai and OPENAI_API_KEY for real semantic search.'
    );
  }

  const vector = new Array(vectorSize).fill(0);
  const normalized = normalizeText(text);

  // Bigram overlap — captures some token co-occurrence, still not semantic
  for (let i = 0; i < normalized.length - 1; i++) {
    const bigram = normalized.charCodeAt(i) * 31 + normalized.charCodeAt(i + 1);
    const index = bigram % vectorSize;
    vector[index] += 1;
  }
  // Single chars too
  for (let i = 0; i < normalized.length; i++) {
    vector[normalized.charCodeAt(i) % vectorSize] += 0.5;
  }

  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
};

const ensureVectorSize = (vector) => {
  if (!Array.isArray(vector)) {
    throw new Error('Embedding vector is not an array');
  }
  if (vector.length !== vectorSize) {
    throw new Error(
      `Embedding vector length (${vector.length}) does not match QDRANT_VECTOR_SIZE (${vectorSize}).`
    );
  }
  return vector;
};

const getOpenAiEmbedding = async (text) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    // text-embedding-3-* supports a `dimensions` param to truncate output.
    // Always pass it so the vector size matches the Pinecone index (512).
    body: JSON.stringify({ model, input: text, dimensions: vectorSize })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI embeddings failed: ${errorText}`);
  }

  const data = await response.json();
  const vector = data?.data?.[0]?.embedding;
  return ensureVectorSize(vector);
};

const getEmbedding = async (text) => {
  const provider = (process.env.EMBEDDING_PROVIDER || 'local').toLowerCase();
  const content = normalizeText(text);
  if (!content) {
    throw new Error('Text is required for embedding');
  }

  if (provider === 'openai') {
    return getOpenAiEmbedding(content);
  }

  // 'anthropic' provider removed — Claude is a generative LLM, not an embedding
  // model; it has no embeddings API. Fall through to local with a clear warning.
  if (provider === 'anthropic') {
    console.error(
      '❌ EMBEDDING_PROVIDER=anthropic is not supported. ' +
      'Claude does not have an embeddings API. Falling back to local (non-semantic). ' +
      'Switch to EMBEDDING_PROVIDER=openai.'
    );
  }

  return localEmbed(content);
};

module.exports = {
  getEmbedding,
  localEmbed
};
