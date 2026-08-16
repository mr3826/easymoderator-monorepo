# Qdrant migration proof

`qdrant-migration.yml` is a manually invoked, non-deploying operational gate for
the embedding-provider migration. It is intentionally separate from the normal
release workflow.

## Scope and safety boundary

The workflow:

- reads the production PostgreSQL and Qdrant services through the existing
  production network;
- creates or reuses only these isolated, fixed-name targets after proving they
  are absent or empty:
  - `knowledge_documents_openai_rollback_20260816`
  - `knowledge_documents_gemini_20260816`
- reindexes active source data into each target with vector size `384`;
- validates payload integrity, Bangla, English, cross-lingual, negative-query,
  semantic, and tenant-filter behavior;
- snapshots the OpenAI rollback collection, records its SHA-256, and restores
  that snapshot into a separate pinned Qdrant container for validation;
- captures the currently running immutable backend and frontend image digests
  as the application rollback plan; and
- proves a candidate backend image can be pulled with the workflow
  `GITHUB_TOKEN`.

It does not change `QDRANT_COLLECTION`, restart production containers, run
compose deployment commands, delete collections or points, or enable
production deployment. The existing `knowledge_documents` collection is
checked before and after the proof and must remain at the supplied baseline.

The PostgreSQL source contract is shared by `reindex:qdrant` and this proof:

- active `shops` rows contribute one business-info source when the indexed text
  is non-empty;
- active `faq_responses` rows contribute one bilingual FAQ source; and
- active `products` rows contribute one canonical product source, capped at 200
  products per shop.

`knowledge_documents` is the live Qdrant collection identifier, not a source
table in this contract. Custom document writes retain metadata under
`shops.settings.documents` but do not persist the request text needed for a
deterministic bulk reindex, so they are not counted as reconstructible sources.

Qdrant collection snapshots include collection configuration, points, and
payloads. The isolated restore uses the same pinned Qdrant image as production;
Qdrant documents that a snapshot restore must use a compatible Qdrant minor
version. See the [Qdrant snapshot documentation](https://qdrant.tech/documentation/snapshots/).

## Invocation

1. Confirm `PRODUCTION_DEPLOY_ENABLED` is not `true`.
2. Confirm the candidate commit already has an immutable GHCR backend image.
3. Run the workflow from the branch containing this file:

   ```text
   candidate_commit=372f7c3c9b519de1bb266b03bbf9f544e1125303
   confirmation=QDRANT-MIGRATION-ONLY
   ```

4. Retain the workflow log and the host evidence directory
   `/opt/easymod/qdrant-migration/<run-id>/`.

The workflow fails closed if a required source relation is missing, PostgreSQL
reports no indexable source rows or not exactly two sources for this migration,
the live collection does not report one point with vector size 384, GHCR access
fails, either reindex is incomplete, the snapshot checksum changes, the
isolated restore fails, or any validation gate fails.

If a provider reindex command fails, the workflow emits only this sanitized
diagnostic contract; the raw host log remains outside the GitHub log:

```text
REINDEX_PROVIDER=
REINDEX_STAGE=
REINDEX_ERROR_TYPE=
REINDEX_ERROR_SUMMARY=
REINDEX_EXIT_CODE=
```

## Cutover boundary

`QDRANT_MIGRATION_READY_FOR_CUTOVER` means the rollback collection, snapshot,
isolated restore, Gemini target, and rollback evidence are ready for an
independently approved change. It does not authorize cutover.

The separately approved cutover plan is:

1. set `QDRANT_COLLECTION` to
   `knowledge_documents_openai_rollback_20260816` when rolling back the
   provider;
2. restore the captured immutable backend and frontend image digests if an
   application rollback is also required;
3. deploy only through the normal release approval path; and
4. verify live health, tenant-scoped retrieval, and application flows after the
   change.

Do not delete either migration collection or the snapshot as part of this
proof. Preserve the evidence until the independent reviewer accepts the
result.
