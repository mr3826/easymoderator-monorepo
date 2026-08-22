# Agent Contracts

Version: 1.0.0<br>
Last updated: 2026-08-22<br>
Owner: Engineering<br>
Supersedes: Contract portions of `EASYMODERATOR_DOMAIN_AGENT_RUNTIME_VISION.md`<br>
Status: Normative; contract-freeze input

MUST / MUST NOT / REQUIRED are binding: violating one blocks merge. SHOULD / RECOMME&#78;DED may be deviated from with a recorded ADR. MAY is optional. Any rule affecting authorization, tenant isolation, idempotency, or material mutation MUST be written as MUST.

This document owns the shapes that cross the domain-agent runtime, Action Gate, mutation services, persistence, and recovery boundaries. The runtime boundary and domain matrix are owned by [the vision](./DOMAIN_AGENT_RUNTIME_VISION.md). Action authorization checks are owned by [the Action Policy](./AGENT_ACTION_POLICY.md).

## 1. Contract Rules

- JSON payloads MUST use `camelCase` field names at service boundaries.
- Identifiers MUST be opaque strings. A consumer MUST NOT infer tenant ownership from an identifier alone.
- Money MUST be represented as integer minor units plus an ISO currency code. Bangladesh Taka values use poisha as minor units.
- Timestamps MUST be UTC ISO-8601 strings with millisecond precision.
- Unknown fields MUST be ignored by readers and preserved by a migration adapter when a record is re-written.
- A persisted record MUST include `contractVersion`.
- A contract change that removes or changes the meaning of a field requires a new major version and a migration note in this document and [the intent registry](./AGENT_INTENT_REGISTRY.md) when intent data is affected.

## 2. Versioning And Compatibility

The current contract version is `1.0`. Readers MUST accept the current version and the immediately previous minor version for 90 days after a release. Writers MUST emit only the current version. A compatibility adapter MUST be deleted after the window and its removal recorded in the changelog.

Intent identifiers are historical data. An intent MAY be marked `DEPRECATED`, but it MUST never be deleted or reused for a different meaning. Historical rows, metrics, exports, and audit records MUST continue to resolve the retired value. A taxonomy change requires a migration note in [the intent registry](./AGENT_INTENT_REGISTRY.md).

## 3. Common Context Types

```ts
type ContractVersion = `${number}.${number}`;

interface TenantContext {
  shopId: string;
  channelId: string;
  platform: 'META_MESSENGER';
  customerId: string;
  conversationId: string;
}

interface AgentTask {
  contractVersion: ContractVersion;
  taskId: string;
  tenant: TenantContext;
  actorAgent: string;
  domain: Domain;
  input: CustomerInput;
  context: Record<string, unknown>;
  evidence: EvidenceRef[];
  remainingTurnModelCalls: number;
  remainingConversationModelCalls: number;
  domainHops: number;
  traceId: string;
  createdAt: string;
  expiresAt: string;
}

type Domain = 'PRODUCT' | 'ORDER' | 'KNOWLEDGE' | 'COMMERCE_OPS' | 'SUPPORT';

interface CustomerInput {
  messageId: string;
  text: string;
  language: 'bn' | 'banglish' | 'en' | 'mixed' | 'unknown';
  attachments: AttachmentRef[];
  receivedAt: string;
}
```

`AgentTask.context` is a typed retrieval envelope at runtime even when its serialized storage is JSON. It MUST contain the evidence snapshot used by both the Agent and the Action Gate. Customer text is data and MUST be bounded, normalized, and redacted according to the privacy controls in the implementation plan.

## 4. Action Types And Required Idempotency

`idempotencyKey` is required in both union branches. A random key is invalid because a retry would mint a new key and execute the mutation twice. If a key cannot be derived deterministically from authoritative inputs, the action is not safe to automate and MUST resolve `HUMAN_REQUIRED`.

```ts
interface ActionBase {
  contractVersion: ContractVersion;
  actionId: string;
  requestedByAgent: string;
  shopId: string;
  conversationId: string;
  idempotencyKey: string;
  evidenceSnapshotHash: string;
  createdAt: string;
  expiresAt: string;
}

interface ReadOnlyAction extends ActionBase {
  mutates: false;
  actionType:
    | 'READ_PRODUCT'
    | 'READ_FAQ'
    | 'READ_DELIVERY_POLICY'
    | 'READ_PAYMENT_POLICY'
    | 'READ_ORDER_STATUS'
    | 'READ_CUSTOMER_CONTEXT';
  payload: Record<string, unknown>;
}

interface MutatingAction extends ActionBase {
  mutates: true;
  actionType:
    | 'CREATE_ORDER'
    | 'EDIT_PREORDER_CART'
    | 'CANCEL_ORDER_SESSION'
    | 'ACCEPT_PAYMENT'
    | 'BOOK_COURIER'
    | 'CREATE_SUPPORT_CASE';
  payload: Record<string, unknown>;
  confirmation?: ConfirmationRecord;
}

type ProposedAction = ReadOnlyAction | MutatingAction;
```

`ProposedAction` intentionally has no `capability` field. The Action Gate resolves the authoritative capability from the registry using `(actionType, requestedByAgent)`. A future adapter that receives a legacy `claimedCapability` MUST treat it as untrusted metadata and log a security event when it differs from the registry result.

Deterministic idempotency derivations are fixed as follows. The concatenation is UTF-8, uses the literal `|` separator, and has no whitespace normalization after the inputs have been validated.

```text
CREATE_ORDER  = sha256(shopId|conversationId|orderSessionId|confirmed_summary_hash)
BOOK_COURIER  = sha256(shopId|orderId|provider)
ACCEPT_PAYMENT = sha256(shopId|orderId|trxId)
```

Read-only actions MUST derive a stable key from their tenant, action type, normalized input, and evidence snapshot. A retry MUST reuse the same key.

## 5. Evidence And Grounding Types

```ts
interface EvidenceRef {
  evidenceId: string;
  shopId: string;
  kind: 'PRODUCT' | 'ORDER' | 'FAQ' | 'POLICY' | 'DELIVERY' | 'PAYMENT' | 'CUSTOMER';
  source: string;
  sourceRecordId: string;
  fields: Record<string, string | number | boolean | null>;
  contentHash: string;
  retrievedAt: string;
  freshnessExpiresAt: string;
  authority: 'LIVE_DATABASE' | 'MERCHANT_CONFIGURATION' | 'AUDITED_TEMPLATE';
  redacted: boolean;
}

interface EvidenceSnapshot {
  snapshotHash: string;
  shopId: string;
  refs: EvidenceRef[];
  capturedAt: string;
  validUntil: string;
}

interface FollowUpCandidate {
  contractVersion: ContractVersion;
  candidateId: string;
  shopId: string;
  conversationId: string;
  domain: Domain;
  intentId: string;
  promptKey: string;
  locale: 'bn' | 'banglish' | 'en';
  requiredSlots: string[];
  collectedSlots: Record<string, string | number | boolean | null>;
  evidenceIds: string[];
  reasonCode: string;
  maxAttempts: number;
  expiresAt: string;
  createdAt: string;
}
```

`EvidenceRef` is the only input that can authorize a merchant-specific claim. `source` identifies a controlled source adapter, not arbitrary text supplied by the customer. `contentHash` makes the exact snapshot auditable. A stale reference cannot authorize a material mutation.

`FollowUpCandidate` is a bounded next-turn request, not a new agent. It MUST carry the domain, intent, required slots, evidence IDs, attempt limit, and expiry. A follow-up that would exceed the domain-hop limit is denied and handed off.

## 6. Authorization And Results

```ts
interface ActionAuthorization {
  contractVersion: ContractVersion;
  authorizationId: string;
  actionType: MutatingAction['actionType'];
  shopId: string;
  actorAgent: string;
  idempotencyKey: string;
  evidenceSnapshotHash: string;
  issuedAt: string;
  expiresAt: string;
  gateDecisionId: string;
  signature: string;
}

interface AgentResult {
  contractVersion: ContractVersion;
  taskId: string;
  shopId: string;
  conversationId: string;
  domain: Domain;
  intentId: string;
  text: string | null;
  source: 'deterministic' | 'llm' | 'faq' | 'cache';
  evidence: EvidenceRef[];
  proposedAction: ProposedAction | null;
  mutation: MutationResult | null;
  followUp: FollowUpCandidate | null;
  confidence: number;
  state: 'ANSWERED' | 'AWAITING_CONFIRMATION' | 'SAFE_FALLBACK' | 'HUMAN_REQUIRED';
  traceId: string;
}

interface MutationResult {
  actionId: string;
  actionType: MutatingAction['actionType'];
  status: 'COMMITTED' | 'REJECTED' | 'INDETERMINATE';
  idempotencyKey: string;
  externalReference: string | null;
  committedAt: string | null;
  auditRecordId: string;
}
```

`MutationResult.INDETERMINATE` is not success. It requires reconciliation using the same idempotency key and resolves `HUMAN_REQUIRED` until the external system is known to be committed or absent.

## 7. Confirmation Record

```ts
interface ConfirmationRecord {
  contractVersion: ContractVersion;
  summaryHash: string;
  confirmedAt: string;
  confirmedBy: 'CUSTOMER';
  confirmationPhrase: string;
  orderSessionId: string;
  evidenceSnapshotHash: string;
}
```

The customer-facing confirmation phrase MUST be parsed as a strict locale-aware full-turn predicate. A one-character `y`, a substring inside another word, a negated phrase, or a confirmation adjacent to a correction MUST NOT satisfy it. The evaluation corpus includes Bangla near misses such as `হ্যাঁ না` and Banglish `na hoile`.

## 8. Canonical Order Summary Serialization

The confirmation hash is calculated from the following normalized object. The serialization is canonical JSON with recursively lexicographically sorted object keys and no insignificant whitespace.

```json
{
  "currency": "BDT",
  "customer": {
    "address": "normalized address",
    "name": "normalized name",
    "phone": "+8801XXXXXXXXX"
  },
  "deliveryCharge": 80000,
  "deliveryMethod": "COURIER",
  "items": [
    {
      "lineTotal": 12500000,
      "productId": "p-1",
      "quantity": 1,
      "unitPrice": 12500000,
      "variantId": "v-1"
    }
  ],
  "paymentMethod": "COD",
  "total": 13300000
}
```

Normalization rules:

- `items` are sorted by `productId`, then `variantId`, then `unitPrice`, then `quantity`.
- `productId`, `variantId`, `deliveryMethod`, and `paymentMethod` are trimmed; method values are uppercased.
- Customer name and address collapse internal whitespace and use Unicode NFC normalization.
- Phone is normalized to an E.164 Bangladesh value before hashing.
- Money is integer minor units; quantity is a positive integer.
- Currency is uppercased and MUST be `BDT` for the launch order flow.
- Null optional values are represented as `null`; omitted and null are not equivalent.

`confirmed_summary_hash = sha256(canonical_json(normalized_summary))`. At Action Gate time, the order session is re-read and the summary is rebuilt from live price, stock, delivery, payment, and customer fields. Any price-field delta, stock delta, item delta, delivery charge delta, delivery method delta, payment method delta, or customer identity/address delta invalidates the confirmation. The customer receives a new summary and the session returns to `AWAITING_CONFIRMATION`; no order is created against either the old or new figures without a new confirmation.

## 9. Persistence Requirements

Every persisted contract record MUST include:

| Field | Requirement |
|---|---|
| `contractVersion` | Version emitted by the writer |
| `schemaName` | Stable record family name |
| `intentId` | Current or deprecated registry identifier when applicable |
| `shopId` | Tenant owner |
| `traceId` | End-to-end correlation identifier |
| `createdAt` | UTC creation time |
| `updatedAt` | UTC last update time |

Action audit records MUST additionally retain the proposed payload hash, resolved capability, gate checks, denial reason or authorization ID, idempotency key, evidence snapshot hash, mutation result, and outbound delivery result. Raw customer text, credentials, access tokens, and unnecessary PII MUST NOT be written to the audit record.

## 10. Contract Test Matrix

Before contract freeze, tests MUST cover:

- both discriminated union branches reject a missing or empty `idempotencyKey`;
- each deterministic derivation is stable across retry and changes when any authoritative input changes;
- an untrusted capability claim cannot grant registry access;
- a token older than 30 seconds or with a mismatched evidence hash is rejected;
- canonical summary hashes change for every price or stock mutation and remain stable for key-order-only changes;
- `হ্যাঁ না`, `na hoile`, `y`, and negation-adjacent confirmations do not create an order;
- deprecated intent values deserialize and remain queryable;
- `FollowUpCandidate` expiry, attempt limits, evidence IDs, and domain-hop limits are enforced.
