---
name: em-architect-skill
description: "EasyModerator architecture skill. Use for modular monolith decisions, new backend module design, DB schema changes, BullMQ queue topology, RAG pipeline expansions, or reviewing service boundaries across 35 backend modules."
---

# Architect Skill — EasyModerator System Architect

## ROLE
Senior System Architect for EasyModerator — Node.js/Express modular monolith with event-driven async processing, multi-tenant SaaS, BD f-commerce domain.

## STACK
- Runtime: Node.js 18+ + Express.js
- Database: PostgreSQL 15 + Sequelize ORM
- Cache / Queue: Redis (ioredis) + BullMQ
- AI: OpenAI + Google Gemini + Pinecone/Qdrant
- Frontend: React 18 + TypeScript + Vite
- Deployment: Docker + DigitalOcean

---

## ARCHITECTURE OVERVIEW

EasyModerator uses a **modular monolith** pattern — all business logic lives in `EasyMod-backend/src/modules/`, organized by domain. There are no microservices; all modules share the same process, DB connection, and Redis instance.

**Module count:** 35 modules
**Shared entities barrel:** `src/modules/entities.js` — re-exports all Sequelize models
**Multi-tenancy model:** `shop_id` FK on every tenant-scoped entity. All tenant queries MUST include `{ where: { shop_id } }`.

### Module Dependency Direction
```
routes → controller → service → entity (Sequelize model)
                ↓
         other services (cross-module imports allowed, no circular)
                ↓
         shared utils: AppError, createLogger, cacheRedis, entities
```

---

## MODULE BOUNDARY RULES

**Create a new module when:**
- The domain is distinct with its own lifecycle (e.g., `rto-shield`, `delivery`, `reconciliation`)
- It has its own entities, service methods, and routes
- It won't create circular dependencies

**Extend an existing module when:**
- The behavior is a natural extension of the existing domain
- No new primary entities are needed

**Cross-module import rules:**
- Services can import other services (e.g., `ai.service` imports `conversation.service`)
- Controllers NEVER import from other controllers
- Circular dependencies are NEVER allowed
- All Sequelize models accessed via `entities.js` barrel (no direct cross-module model imports)

---

## DATABASE DESIGN STANDARDS

### Entity Conventions
```js
// Primary key: always UUID
id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true }

// Tenant scoping: every tenant entity needs this
shop_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'shops', key: 'id' } }

// Soft deletes for business entities (orders, customers, products)
paranoid: true

// Timestamps: always
timestamps: true
```

### Index Strategy
- Every `shop_id` FK must be indexed: `shop_id` queries are the most frequent
- Composite indexes for common filter patterns: `[shop_id, status]`, `[shop_id, created_at]`
- Unique constraints: `[shop_id, external_id]` for idempotency guards

### Migration Naming
```
YYYYMMDDHHMMSS-{action}-{entity}.js
20260516120000-add-rto-risk-flag-to-orders.js
20260516120000-create-conversation-locks-table.js
```

---

## BULLMQ QUEUE TOPOLOGY

### Current Queues
- `message-processing` — Meta webhook message processing (primary queue)
- `invoice-generation` — Monthly/daily invoice jobs
- `email-queue` — Transactional emails via Resend
- `auto-index` — Knowledge base embedding indexing

### Fair-Queueing Pattern (Critical)
Every job that processes per-shop data MUST use BullMQ's group fair-queueing:
```js
await queue.add(jobName, payload, {
  group: { id: shopId },   // fair-queueing: one shop can't starve others
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: 100,
  removeOnFail: 200
})
```

### Idempotency Pattern
```js
// Before processing, set NX key with 24h TTL
const lockKey = `job:idempotency:${jobName}:${messageId}:${shopId}`
const acquired = await cacheRedis.set(lockKey, '1', { NX: true, EX: 86400 })
if (!acquired) return // duplicate job — skip silently
```

### Queue Naming Convention
- `kebab-case`
- Job names: descriptive verb-noun (`process-message`, `generate-invoice`, `index-knowledge`)

---

## SERVICE BOUNDARY DECISION MATRIX

| Task | Module | Service File |
|------|--------|-------------|
| Send Meta DM | webhooks / ai | `meta-send.service.js` |
| AI intent routing | ai | `intent-router.service.js` |
| LLM call (Gemini/OpenAI) | ai | `llm.service.js` |
| RAG product retrieval | rag | `rag.service.js` |
| Guardrail chain | ai | `guardrail.service.js` |
| Order creation | order | `order.service.js` |
| Order session (DM checkout) | order | `order-session.service.js` |
| BKash payment link | payment | `bkash-merchant.service.js` |
| Delivery booking | delivery | `delivery.service.js` via `provider.registry.js` |
| Delivery tracking | delivery | `order-tracking.service.js` |
| Subscription check | subscription | `subscription.service.js` |
| Conversation limit check | subscription | `subscription.service.js` |
| Shop settings | shop | `shop.service.js` |
| Channel OAuth | channel | `channel.oauth.service.js` |
| Customer memory | customer | `customer.service.js` |
| RTO fraud check | rto-shield | `rto-shield.service.js` |
| Knowledge indexing | knowledge | `knowledge.service.js` |
| Notification push | notification | `owner-notification.service.js` |

---

## ADR TEMPLATE FOR EASYMOD

```markdown
## ADR-{number}: {Title}
**Date:** {YYYY-MM-DD}
**Status:** Proposed / Accepted / Superseded

### Context
{What situation prompted this decision?}

### Decision
{What was decided?}

### Meta Policy Impact
{Does this affect Meta API usage? Rate limits? Consent flows? — or N/A}

### BD Commerce Impact
{Does this affect BD seller workflows, BKash, delivery, or order flows? — or N/A}

### Consequences
{What changes as a result? What becomes easier or harder?}

### Migration Notes
{Any DB migrations, queue topology changes, or env var changes required?}

### Rollback
{How to revert this decision if it causes problems?}
```

---

## SCALABILITY CHECKPOINTS

Before shipping any feature, validate:

- [ ] All tenant queries include `{ where: { shop_id } }` — no cross-tenant data leakage
- [ ] BullMQ jobs use `group.id = shopId` for fair-queueing
- [ ] All BullMQ jobs have idempotency key guard
- [ ] All Redis keys scoped by `shopId` (prevent key collisions between tenants)
- [ ] Semantic score threshold `SEMANTIC_SCORE_THRESHOLD=0.82` not changed without RAG performance test
- [ ] N+1 queries prevented with Sequelize `include` for associations
- [ ] Circuit breaker state checked before any external API call (Gemini, OpenAI, couriers)
- [ ] New external service uses `circuit-breaker.service.js` pattern

## ALWAYS

- Design for tenant isolation first — assume every query could leak data if not scoped by `shop_id`
- Use existing services before creating new ones (check `src/modules/entities.js` and service files)
- Document every architectural decision in `.easymod/memory/architecture-decisions.md`
- BullMQ is the async boundary — anything that could be slow goes in a queue

## NEVER

- Place business logic in controllers or routes
- Create circular dependencies between modules
- Bypass the `entities.js` barrel with direct cross-module model imports
- Skip fair-queueing (`group.id`) on BullMQ jobs that process per-shop data
- Implement a new queue without idempotency guard
