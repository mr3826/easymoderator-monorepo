# ADR-0004: Inbox Message Delivery Truth

Status: Accepted
Date: 2026-09-04
Owners: Engineering + Product

## Context

The Inbox stored AI candidates as `messages` rows, but the same row shape was
projected as a normal outbound transcript message before Meta acknowledged a
send. Draft approval then created a second message row, while dismiss was only
local UI state. This made provider delivery, merchant approval, and suggestion
visibility indistinguishable.

## Decision

Retain one `Message` row for each AI candidate and add explicit delivery fields:
`delivery_state`, `provider_message_id`, `delivery_source`, and
`send_idempotency_key`. The canonical transcript contains inbound messages,
merchant messages, and provider-confirmed AI messages only. Unsent candidates
are exposed as review projections and are never inferred to be sent from their
sender or content.

Draft approval locks the candidate under the shop/conversation owner, changes
the same row to `SEND_PENDING`, sends the approved text once, and changes it to
`SENT` only after provider acknowledgement. Dismiss persists `DISMISSED`.

## Alternatives Rejected

- **Separate Draft entity:** rejected because it duplicates candidate content,
  complicates SSE/echo reconciliation, and creates two local records for one
  logical response.
- **Frontend-only filtering:** rejected because API consumers and other Inbox
  clients would still receive an ambiguous sent-looking candidate.
- **Global provider-MID uniqueness:** rejected because a provider MID is not a
  tenant-independent authorization key; deduplication is scoped through the
  owning shop/Page conversation.

## Consequences

- One row remains auditable from generation through approval, send, failure, or
  dismissal.
- A provider timeout leaves `SEND_PENDING` and requires reconciliation rather
  than a second blind send.
- Existing legacy metadata rows are backfilled; the old Page mode fields remain
  storage-only compatibility data and do not influence this lifecycle.
