# 06 — Security, Privacy & Meta Posture (Increment 2)

FlowGuard pass over `3d1bc0eb..HEAD` (this branch). Every claim cites the
implementing commit/test; nothing here is inferred from intent.

## Tenant + role boundaries
- New surfaces derive shop identity from the **JWT only** (`req.user.shopId`):
  notes (`79ac85ae`), tags (`1913c813`), queue views (`1913c813`), order
  association (`2dc0563a`). Every query is `{ shop_id: <jwt>, … }` first.
- `customer_id`/`tag_id`/`assignee_id` values are **verified against the shop**
  before any write: assignee membership (D2, `21ebf39f`), tag ownership batch
  check, customer association (`CUSTOMER_NOT_FOUND` inside shop), and the
  ported create-time order guard (`57c5ada3` upstream work, adopted).
- Route param ids are uuid-validated before reaching services (non-uuid →
  400, asserted in `customer-notes.routes.test.js` + validator suites).
- Author-or-privileged mutation rules enforced server-side; client affordances
  are UX mirrors only (repo iron law).

## Data exposure deltas
- **Reduced**: name-based chat lookup was showing the shop's most-recent
  ACTIVE conversation to whoever opened ANY order (Increment 1 fixed;
  rehearsal-confirmed). Inbox context panel now returns narrower, correct data.
- **New PII paths (notes/tags)**: note bodies exist ONLY in `customer_notes`;
  audits carry lengths/ids, never bodies (test-pinned `79ac85ae`); serialize
  key whitelist test proves no PII beyond ids/author name; notes are NOT in
  AI prompt context (customer-memory untouched), NOT in SSE payloads, NOT
  outbound; delete is soft (retention-visible) with FK CASCADE for erasure.
- Tags: blocklist keeps derived/risk vocabulary out of manual knobs; nothing
  is inferred from message content (service reads no messages at all).
- Owner names in `assignee` field: shop-members only (assignee_id was
  membership-gated at write time); list/detail batch lookup is display-only.

## Meta policy posture (unchanged + improved)
- No new outbound surface anywhere in this increment (all writes are internal
  state: notes/tags/ownership). Every human-initiated send still traverses the
  full policy chain (unchanged suites green: 313/313).
- Policy-blocked candidates no longer offer a misleading re-send (1e35d6cb) —
  fewer doomed provider attempts = strictly better §28 behavior.
- No window/eligibility claim invented in UI; contactability shown only where
  the existing authoritative banner shows it.
- Zero live Meta calls, zero paid AI calls in any verification run here.

## Storefront boundary (mission §11.3)
- Every CRM/customer-context read+write is keyed by shop-scoped internal ids
  and is channel-neutral; `channel`/Page appear as ATTRIBUTES, never identity.
- `customer_notes`/`customer_tag_*` FKs are `customers.id` — the same anchor a
  future storefront identity link table would resolve INTO; no Meta PSID is
  stored in any new table.
- Future adapter requirements (documented, NOT built): explicit verified
  linking table storefront_account→customer_id, consent-scoped session events
  reusing the same authorities; nothing added here preempts or conflicts.

## Threat notes considered
- IDOR on notes/tags: blocked by (shop_id, id) compound scoping + membership
  checks; cross-tenant probe tested in route suite (`NOTE_NOT_FOUND` for
  foreign shop).
- XSS: notes render as plain text (`whitespace-pre-line`, React-escaped);
  tag names uuid-validated ids for data-testid, names render escaped.
- CSRF/auth: existing cookie+CSRF middleware chain untouched; no new unauthed
  route added.
- Rate/size: notes ≤ 2000 chars, tags ≤ 30/40/15 bounds, queues capped,
  list pages bounded 100 — no unbounded scan introduced.
