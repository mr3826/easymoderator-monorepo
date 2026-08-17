# Semantic embedding calibration

`semantic-calibration.js` evaluates a controlled, non-production fixture corpus
with Gemini `gemini-embedding-2`. It uses the same retrieval input formatting
as the application, requests the configured `outputDimensionality`, and
calculates cosine scores, ranks, margins, and negative-query distributions in
memory.

The runner does not import PostgreSQL, Qdrant, Redis, Docker, SSH, or deployment
code. It does not write to a database or collection. The manual
`semantic-embedding-calibration.yml` workflow receives only the existing
`GOOGLE_GEMINI_API_KEY` secret and is not triggered by pushes or merges.

The authoritative calibration dimension remains `384`. Passing `768` is an
optional diagnostic comparison; it does not change production configuration.
The proof constants remain `0.25` for positive retrieval and `0.5` for the
negative maximum. A calibration artifact is evidence for a later decision, not
an automatic threshold or model change.

Run locally only when an authorized Gemini key is already present in the
environment; do not paste or commit the key:

```powershell
node scripts/semantic-calibration.js --dimensions=384,768 --output=semantic-calibration.json
```

The JSON artifact contains explicit expected fixture IDs, full score matrices,
top-1 ranks, expected scores, top-1 margins, negative top scores, and summary
classification. The corpus contains fictional EasyModerator/Bangladesh
commerce facts and no customer or merchant records.
