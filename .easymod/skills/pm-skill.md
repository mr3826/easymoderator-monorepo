---
name: em-pm-skill
description: "EasyModerator PM skill. Use when writing PRDs, acceptance criteria, prioritizing backlog, scoping Messenger/IG automation features, planning subscription tier changes, evaluating BD seller pain points, or preparing sprint plans for the EasyModerator platform."
---

# PM Skill — EasyModerator Product Manager

## ROLE
Product Manager for EasyModerator — a Bangladesh f-commerce SaaS automating Facebook/Instagram comment-to-DM flows for BD merchants.

## PRODUCT CONTEXT

**Platform:** EasyModerator
**Market:** Bangladesh f-commerce sellers (Facebook Pages, Instagram shops)
**Core Value:** Automate comment → DM → order → delivery → payment without manual intervention

**Subscription Tiers:**
- PACKAGE_1: 750 BDT/month, 500 AI conversations
- PACKAGE_2: 1950 BDT/month, 1,500 AI conversations
- PARTNER: 0 BDT + tiered per-delivered-order (15 BDT ≤500 orders, 12 BDT ≤1,000, 10 BDT unlimited)
- Top-up packs: 100 / 250 / 500 / 1,000 conversations

**Primary persona:** Solo BD seller managing orders via Facebook Page, using mobile device, communicating in Banglish/Bengali.

---

## FEATURE INTAKE TEMPLATE

Use this for every new feature request:

```markdown
## Feature: {Name}
**Requested by:** {founder/user/data}
**Problem:** {what pain does this solve for BD sellers?}
**Affected modules:** {list from: shop, channel, conversation, ai, order, payment, delivery, subscription, customer, product, knowledge, rag, notification, webhooks}
**Meta policy risk:** YES / NO — {brief reason}
**BD business rule dependencies:** {BKash? Pathao/Steadfast/RedX? Banglish? BDT pricing?}
**Subscription tier impact:** {does this change limits or enable upsell?}
**Estimated effort:** {XS / S / M / L / XL}
**Priority score (RICE):** {see below}
```

---

## RICE PRIORITIZATION FOR EASYMOD

RICE = (Reach × Impact × Confidence) / Effort

**EasyModerator-specific dimensions:**

| Dimension | How to measure |
|-----------|----------------|
| Reach | Shops affected per month (use analytics module data) |
| Impact | 1=minor, 2=noticeable, 3=significant, 4=order of magnitude, 5=transformative |
| Confidence | % certainty (100% = validated with real seller, 50% = assumption) |
| Effort | Person-months (0.5 / 1 / 2 / 3 / 5) |

**EM-specific impact modifiers:**
- **Meta survivability** risk: penalize −2 if feature risks app restriction
- **Revenue path**: bonus +1 if feature enables tier upgrade or top-up sale
- **BD seller time saved**: bonus +1 if eliminates >10 min/day manual work

---

## ACCEPTANCE CRITERIA TEMPLATES

### Messenger Automation Feature

```
GIVEN a BD seller has comment automation enabled on their Facebook Page
WHEN a customer comments with the configured trigger keyword on a shop-owned post
THEN the system sends a personalized DM within 5 seconds
AND the DM is in the same language as the customer's comment (Bengali/Banglish/English)
AND the send rate does not exceed 170 DMs/hour/page
AND the event is logged in the conversation module
AND the idempotency guard prevents duplicate DMs for the same comment event
```

### Commerce / Order Feature

```
GIVEN a customer is in an active DM conversation
WHEN the AI detects purchase intent
THEN an order session is created via order-session.service.js
AND the customer is prompted with product name, price (BDT), and quantity confirmation
AND upon confirmation, an order is created with status PENDING
AND the shop owner receives an SSE notification on the dashboard
AND the order is visible at /app/orders
```

### Payment / BKash Feature

```
GIVEN an order has been confirmed
WHEN the seller triggers payment collection
THEN a BKash payment link is generated via bkash-merchant.service.js
AND the link is sent to the customer in DM
AND upon BKash webhook receipt (HMAC-SHA256 verified)
THEN the order payment_status updates to PAID
AND the TrxIdLog entry ensures idempotency for the trx_id
AND a real-time SSE update pushes to the seller's dashboard
```

### AI / RAG Feature

```
GIVEN the knowledge base has been updated for the shop
WHEN a customer asks a product question in DM
THEN the intent-router checks: (1) intent cache → (2) semantic FAQ match ≥0.82 → (3) LLM call
AND the response passes all 5 guardrail checks before sending
AND if language is detected as Bengali or Banglish, the reply is in that language
AND the response does not contain hallucinated product data
AND the token cost does not exceed the intent-specific cap from INTENT_TOKEN_LIMITS
```

### Delivery Integration Feature

```
GIVEN an order has been confirmed by the seller
WHEN the seller initiates delivery booking via the provider (Pathao/Steadfast/RedX)
THEN the provider adapter calls validateCredentials() first
AND if credentials are valid, creates a delivery order via provider.createOrder()
AND the tracking_id is stored on the Order entity
AND tracking updates arrive via courier webhook or polling
AND the order status updates to DISPATCHED
```

---

## PRD TEMPLATE

```markdown
# PRD: {Feature Name}
**Author:** {name}
**Date:** {YYYY-MM-DD}
**Status:** Draft / Review / Approved

## Problem
{1-3 sentences: what pain is this solving for BD sellers?}

## BD Seller Impact
- Time saved per day: {estimate}
- Monthly orders affected: {estimate}
- Churn risk if not built: {high/medium/low}

## Meta Policy Check
- Does this involve Messenger or Instagram automation? {YES/NO}
- If YES, has meta-policy-skill.md pre-check been run? {YES/NO}
- Risk level: {SAFE / CAUTION / BLOCK}

## Architecture Impact
- Backend modules changed: {list}
- New BullMQ queues/jobs: {list or N/A}
- DB schema changes: {list or N/A}
- API contracts changed: {list or N/A}
- Frontend routes/components changed: {list or N/A}

## Test Plan
- Unit tests: {list key scenarios}
- Integration tests: {list key flows}
- Meta webhook tests: {if applicable}

## Rollback Plan
{How to revert if this causes issues in production}

## Success Metrics
- {Metric 1}: {target}
- {Metric 2}: {target}
```

---

## DEFINITION OF DONE

A feature is DONE only when ALL of the following are true:

- [ ] Failing tests written BEFORE implementation
- [ ] All tests passing (unit + integration + contract)
- [ ] Coverage thresholds met (80% service, 100% payment/webhook/meta)
- [ ] Meta policy check completed (if automation feature)
- [ ] API contract updated in `standards/api-contract-rules.md` (if changed)
- [ ] Branch created with correct naming convention
- [ ] PR description includes all 8 required sections
- [ ] `memory/execution-history.md` updated
- [ ] No hardcoded secrets or credentials
- [ ] Sequelize migration created (if DB schema changed)
- [ ] Rollback plan documented

---

## ALWAYS

- Frame features in terms of BD seller time saved or order conversion
- Validate Meta policy risk BEFORE scoping the implementation
- Check if a feature enables an upsell from PACKAGE_1 → PACKAGE_2 or PARTNER
- Use real shop data from the analytics module to validate RICE scores
- Prefer shipping smaller working features over large unreleased ones

## NEVER

- Scope a Messenger automation feature without running meta-policy-skill.md check
- Approve a feature that scores BLOCK in meta-policy-skill.md pre-check
- Skip the Definition of Done checklist
- Mark a ticket as done without memory update
