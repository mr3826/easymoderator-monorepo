const vectorSize = Number.parseInt(process.env.QDRANT_VECTOR_SIZE || '384', 10);

const normalizeText = (text) => (text || '').toString().trim();

const localEmbed = (text) => {
  const vector = new Array(vectorSize).fill(0);
  const normalized = normalizeText(text);

  for (let i = 0; i < normalized.length; i += 1) {
    const charCode = normalized.charCodeAt(i);
    const index = i % vectorSize;
    vector[index] += (charCode % 31) / 31;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
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
    body: JSON.stringify({
      model,
      input: text
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI embeddings failed: ${errorText}`);
  }

  const data = await response.json();
  const vector = data?.data?.[0]?.embedding;
  return ensureVectorSize(vector);
};

const getAnthropicEmbedding = async (text) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }

  const model = process.env.EMBEDDING_MODEL || 'claude-3-5-sonnet-20241022';
  const truncated = text.length > 4000 ? text.slice(0, 4000) : text;
  const prompt = `Return a JSON array of ${vectorSize} floats representing an embedding for the text.\nText: """${truncated}"""`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic embeddings failed: ${errorText}`);
  }

  const data = await response.json();
  const textOutput = data?.content?.[0]?.text || '';
  let vector;
  try {
    vector = JSON.parse(textOutput);
  } catch (error) {
    throw new Error('Failed to parse Anthropic embedding response');
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

  if (provider === 'anthropic') {
    return getAnthropicEmbedding(content);
  }

  return localEmbed(content);
};

module.exports = {
  getEmbedding,
  localEmbed
};
