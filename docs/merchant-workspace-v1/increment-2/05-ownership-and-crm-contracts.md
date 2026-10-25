# 05 — Ownership & CRM Lite Contracts (backend authority)

## Conversation ownership (canonical; closes D1-D4, commit `21ebf39f`)

**PATCH `/api/conversation/:id`** (authenticate + verifyShopAccess, JWT-only shopId)
body (≥1 key): `{ hitl?:bool, status?:'active'|'closed'|'archived', assignee_id?:uuid|null,
resolution_note?:str≤1000|null, last_seen_message_id?:uuid|null, force?:bool }`

Server semantics (conversation.service.js `updateConversation`, row-locked):
- claim = `hitl:true` with no explicit assignee → `assignee_id := actor` (takeover == claim)
- explicit `assignee_id` → MUST be active UserShop member (else 400 `INVALID_ASSIGNEE`;
  503 fail-closed if the check itself is unavailable) — NEW (D2)
- non-privileged actor over another's open handoff → 409 `HUMAN_TAKEOVER_CONFLICT`;
  resolving over it → 409 `HANDOFF_RESOLUTION_CONFLICT`; `force` honored only for
  owner/admin (staff value is inert) — force now HTTP-reachable (D1)
- close fence: `last_seen_message_id` CAS vs newer customer inbound → refuses silently-
  closing, reports `resolution_outcome: 'kept_open_newer_customer_message'`
- reopen: `status:'active'` (+ optional hitl) — unchanged, audited now
- every ownership/workflow delta writes audit `CONVERSATION_OWNERSHIP_UPDATE`
  (`resource_type conversation_ownership`, before/after {assignee_id,hitl,status},
  forced flag, idempotency-keyed, non-fatal) — NEW (D4a)
- every successful mutation that CHANGED ownership emits ONE SSE `hitl_changed`
  from the service, payload now including `assignee_id` + `assignee{id,name}` — NEW (D4b/D3)
  (controller's ownership-blind duplicate emits removed; system handoff path in
  human-handoff.service keeps its own emit + holding message)

**Reads:** list + detail + PATCH responses carry `assignee_id`, `assignee{id,name}`
(batched single User query per page — no N+1), `resolution_note`, `resolved_at`.
`GET /api/shop/agents` (JWT-scoped) is the assignment picker source — first real
consumer added in this increment.

### Lifecycle map (Pilot+ §8.3 preserved)
customer request → `escalateToHuman` (hitl:true, handoff_reason metadata, merchant
notice, holding message via delivery lock) → queue bucket-1 item (`owner:assignee_id`)
→ staff claim (PATCH hitl:true = takeover==claim; 409 on conflict) → human resolution
(PATCH status:closed + note; fence vs newer inbound) → authorized AI resume (resume
boundary metadata; NOT triggered by notification read). No automated follow-up after
Meta eligibility expiry anywhere in this path.

## Customer notes (MINIMAL_NEW, customer bounded context)

Migration `2026XXXX_00x_customer_notes`: table `customer_notes`
- `id uuid pk`, `shop_id uuid fk CASCADE`, `customer_id uuid fk CASCADE`
- `body text` (app-enforced ≤ 2000), `author_id uuid` (users), `author_name` snapshot
- `created_at`, `updated_at`, `deleted_at` (soft delete for retention/erasure hooks)
- index `(shop_id, customer_id, created_at DESC)`

Routes (customer module pattern: authenticate + service-level membership verify,
audit-logged):
- `GET    /api/customer/:id/notes?limit&before` → newest-first page `{data,total}`
- `POST   /api/customer/:id/notes { body }` → 201; author = JWT user; validated length;
  `logOperation CREATE CUSTOMER_NOTE` (metadata stores note id only — NEVER body text
  in audit payloads)
- `PATCH  /api/customer/:id/notes/:noteId { body }` → author-or-privileged only,
  optimistic concurrency via `If-Match`-style `updated_at` echo? — kept simple: last
  write wins + audit from/to? NO raw bodies in audit: lengths only. (BazarLens: small
  teams edit rarely; row-level guard + audit > CAS ceremony for v1)
- `DELETE /api/customer/:id/notes/:noteId` → author soft-delete; owner/admin hard-erase
  path for GDPR (customer destroy cascades via FK)

Hard contracts: notes are NOT in any AI prompt/grounding context source
(customer-memory.service untouched); NOT in outbound message assembly; NEVER in SSE
payloads (client refetches after write); no cross-shop reads (every query carries
shop_id + customer belongs to shop checks).

## Merchant tags (MINIMAL_NEW, small controlled vocabulary)

Migration `2026XXXX_00y_customer_tags`: `customer_tags` (`id, shop_id, name
(≤30 chars, trimmed, case-insensitive unique per shop via functional index),
created_by, created_at`) + `customer_tag_assignments` (`tag_id fk CASCADE,
customer_id fk CASCADE, created_by, created_at; UNIQUE(tag_id, customer_id)` =
idempotent add).

Routes: `GET /api/customer/tags` (vocab+usage counts), `POST /api/customer/tags`,
`PATCH /api/customer/tags/:id`, `DELETE /api/customer/tags/:id`,
`PUT /api/customer/:id/tags { tag_ids: [] }` — replace-set semantics (idempotent,
deterministic, one audit line per change-set summary). Limits: ≤ 40 tags/shop,
≤ 15 tags/customer. Name blocklist: reserved derived-state words are REJECTED
("repeat buyer", "at risk", "fraud", "rto", "interested") — derived statuses can
never become mutable manual tags (mission §10.1). No inference: tags are
merchant-entered only; nothing reads customer messages to create them.

Both note/tag tables carry shop_id + FK cascade + soft-delete only on notes, so a
customer destroy (existing beforeDestroy PII nulled-flow) cascades CRM rows with it.

## Work views (EXTEND of the queue read model — no new store)

`GET /api/inbox/actions` response gains `counts: { by_bucket: {1..6}, total, by_view }`
computed SERVER-side from the same scan authority (never from the loaded page), and
an optional `view` param: `attention|unassigned|handoff|recovery|opportunities|review`
→ maps to existing bucket subsets + owner filters. `partial` fail-closed semantics
unchanged. The thread-list tabs consume the same counts endpoint (no new module).
