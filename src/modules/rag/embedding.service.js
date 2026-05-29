const vectorSize = Number.parseInt(process.env.QDRANT_VECTOR_SIZE || '384', 10);
const EMBEDDING_HTTP_MAX_RETRIES = Number.parseInt(process.env.EMBEDDING_HTTP_MAX_RETRIES || '3', 10);
const EMBEDDING_RETRY_BACKOFF_MS = Number.parseInt(process.env.EMBEDDING_RETRY_BACKOFF_MS || '1200', 10);

const normalizeText = (text) => (text || '').toString().trim();

// ── Local embedding ───────────────────────────────────────────────────────────
// Character n-gram hash fallback — NOT semantically meaningful.
// Use EMBEDDING_PROVIDER=openai or EMBEDDING_PROVIDER=gcp in production.
// ─────────────────────────────────────────────────────────────────────────────
const localEmbed = (text) => {
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '⚠️  WARNING: Using local (non-semantic) embedding in production. ' +
      'Set EMBEDDING_PROVIDER=openai (with OPENAI_API_KEY) or EMBEDDING_PROVIDER=gcp (with EMBEDDING_API_URL) for real semantic search.'
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetryStatus = (status) => [408, 429, 500, 502, 503, 504].includes(status);

const fetchWithRetries = async (url, requestInit, retries = EMBEDDING_HTTP_MAX_RETRIES) => {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, requestInit);

      if (response.ok) {
        return response;
      }

      const body = await response.text();
      const error = new Error(`HTTP ${response.status}: ${body}`);
      error.status = response.status;

      if (attempt < retries && shouldRetryStatus(response.status)) {
        await sleep(EMBEDDING_RETRY_BACKOFF_MS * (attempt + 1));
        continue;
      }

      throw error;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(EMBEDDING_RETRY_BACKOFF_MS * (attempt + 1));
        continue;
      }
    }
  }

  throw lastError || new Error('Embedding request failed');
};

const buildEmbeddingCandidateUrls = (rawUrl) => {
  const url = (rawUrl || '').trim();
  if (!url) return [];

  const candidates = [url];

  try {
    const parsed = new URL(url);
    const origin = parsed.origin;
    candidates.push(`${origin}/embed`);
    candidates.push(`${origin}/embeddings`);
    candidates.push(`${origin}/v1/embeddings`);

    if (/\/embed$/i.test(parsed.pathname)) {
      candidates.push(url.replace(/\/embed$/i, '/embeddings'));
      candidates.push(url.replace(/\/embed$/i, '/v1/embeddings'));
    }
  } catch (_) {
    // Non-URL values are ignored; caller will fail with original URL attempt.
  }

  return [...new Set(candidates.filter(Boolean))];
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

const getGcpEmbedding = async (text) => {
  const apiUrl = process.env.EMBEDDING_API_URL;
  if (!apiUrl) {
    throw new Error('EMBEDDING_API_URL is not set for GCP provider');
  }

  const candidateUrls = buildEmbeddingCandidateUrls(apiUrl);

  const apiKey = process.env.EMBEDDING_API_KEY;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const errors = [];
  let data;
  for (const url of candidateUrls) {
    const isOpenAiCompat = /\/v1\/embeddings$/i.test(url);
    const payload = isOpenAiCompat
      ? { model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small', input: text }
      : { inputs: text };

    try {
      const response = await fetchWithRetries(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      data = await response.json();
      break;
    } catch (error) {
      errors.push(`${url} -> ${error.message}`);
    }
  }

  if (!data) {
    throw new Error(`GCP TEI embeddings failed across endpoints: ${errors.join(' | ')}`);
  }

  // TEI response shape varies by version/deployment.
  // Supported:
  // - [number, ...]
  // - [[number, ...]]
  // - [{ embedding: [number, ...] }]
  // - { embedding: [number, ...] }
  // - { embeddings: [[number, ...]] }
  let vector;
  if (Array.isArray(data)) {
    if (data.length > 0 && typeof data[0] === 'number') {
      vector = data;
    } else if (data.length > 0 && Array.isArray(data[0])) {
      vector = data[0];
    } else if (data.length > 0 && Array.isArray(data[0]?.embedding)) {
      vector = data[0].embedding;
    }
  } else if (Array.isArray(data?.embedding)) {
    vector = data.embedding;
  } else if (Array.isArray(data?.embeddings?.[0])) {
    vector = data.embeddings[0];
  }

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

  if (provider === 'gcp') {
    return getGcpEmbedding(content);
  }

  // 'anthropic' provider removed — Claude is a generative LLM, not an embedding
  // model; it has no embeddings API. Fall through to local with a clear warning.
  if (provider === 'anthropic') {
    console.error(
      '❌ EMBEDDING_PROVIDER=anthropic is not supported. ' +
      'Claude does not have an embeddings API. Falling back to local (non-semantic). ' +
      'Switch to EMBEDDING_PROVIDER=openai or gcp.'
    );
  }

  return localEmbed(content);
};

module.exports = {
  getEmbedding,
  localEmbed
};
