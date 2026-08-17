# Semantic embedding calibration

`scripts/semantic-calibration.js` evaluates a controlled, non-production
semantic corpus with Gemini `gemini-embedding-2`. It uses the same retrieval
input formatting as the application, requests the configured
`outputDimensionality`, and calculates cosine scores, ranks, margins, and
negative-query distributions in memory.

The runner imports only pure formatting, fixture, and acceptance helpers. It
does not import PostgreSQL, Qdrant, Redis, Docker, SSH, or deployment code. It
does not write to a database or collection. The manual
`semantic-embedding-calibration.yml` workflow receives only the existing
`GOOGLE_GEMINI_API_KEY` secret and is not triggered by pushes or merges.

The authoritative production dimension remains `384`. Passing `768` is an
optional diagnostic comparison; it does not change production configuration.
The positive proof floor remains `0.25`. The former negative `<0.5` gate is not
treated as calibrated evidence.

The migration proof now uses a versioned, provider-bound
`HYBRID_SEPARATION_BAND` contract. It requires authoritative positive rank
correctness and a calibrated negative ceiling with a positive-score safety gap.
The checked-in contract is intentionally `PENDING_RECALIBRATION` until a fresh
384-dimensional artifact for the current fixture version proves the minimum
corpus sizes, lexical-disjoint negative fixtures, positive rank/score, and
separation requirements. This fail-closed state prevents replacing `0.5` with a
number selected from a small sample.

Calibration artifacts bind the provider, model, dimensions, embedding-space
version, deterministic fixture hash, semantic acceptance version, commit SHA,
workflow run ID, generation time, counts, and threshold derivation. A model,
space, dimensions, or fixture change therefore requires a new reviewed
calibration rather than silently inheriting an old ceiling.

The current reviewed 384-dimensional calibration is pinned in
`scripts/semantic-acceptance-contract.js`: negative ceiling `0.652`, positive
P05 `0.7561462741171905`, negative maximum `0.6014600529160323`, explicit
`0.05` safety margin, and minimum positive-to-ceiling safety gap `0.10`.
It was produced by workflow run `32046390673` at merged-main commit
`4080b8b32d482b80dfc321ca366175d4f51b051f` for the current deterministic
fixture version. The contract remains proof-only; production retrieval
thresholds and runtime behavior are unchanged.

An active proof contract must also carry calibration run ID, commit SHA,
workflow run ID, timestamp, and the derivation values that produced its ceiling
and positive P05. `createCalibratedContract` validates and binds those fields;
the checked-in contract is now active only for the exact pinned provider/model/
space/dimensions/fixture identity.

Run locally only when an authorized Gemini key is already present in the
environment; do not paste or commit the key:

```powershell
node scripts/semantic-calibration.js --dimensions=384 --output=semantic-calibration.json
```

The JSON artifact contains explicit expected fixture IDs, full score matrices,
top-1 ranks, expected scores, top-1 margins, negative top scores, candidate
acceptance derivation, provenance metadata, and summary classification. The
controlled corpus contains fictional EasyModerator/Bangladesh commerce facts
and no customer or merchant records.
