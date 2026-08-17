# Provider-bound Qdrant embedding spaces

EasyModerator treats provider, model, input-contract version, and dimensions as
one embedding-space identity. A Qdrant collection used for retrieval is valid
only when its durable manifest matches the vector being written or searched:

```text
provider + model + embedding_space_version + dimensions
```

The manifest is stored as a reserved point in the collection with state
`BUILDING`, `VALIDATING`, `READY`, `ACTIVE`, or `FAILED`. Content points repeat
the identity fields so payload validation can detect drift. A collection with
no trusted manifest is legacy/unknown and is not used for new writes or
retrieval; it is never retroactively tagged by the application.

Gemini is the primary knowledge provider. Gemini Embedding 2 document and query
inputs are intentionally asymmetric and are versioned as part of the Gemini
space. OpenAI is a fallback embedding space, not a fallback vector. It can be
searched only through `QDRANT_FALLBACK_COLLECTION` after a complete OpenAI
reindex has produced a bound collection in `READY` or `ACTIVE` state. This is a
cold fallback: the application does not maintain a second index continuously.

Provider/model/input-contract transitions require a new collection and full
source reindex, followed by count, dimensions, payload, semantic, and tenant
validation. The current live collection and aliases are not changed by the
indexer or proof runner; a production switch requires separate authorization.

The delivery RAG collections are a separate local hash embedding space with
their own manifest binding. They must not be compared with knowledge Gemini or
OpenAI vectors.
