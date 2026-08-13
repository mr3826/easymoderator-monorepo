You are the senior full-stack test/quality engineer responsible for turning EasyModerator's current feature inventory into a **permanent whole-application automated verification system**.

The starting audit is:

`docs/testing/WHOLE_APP_CURRENT_STATE_AUDIT.md`

Read it completely.

However:

**DO NOT blindly trust the audit as current truth.**

It is a snapshot.

Before implementing each domain:

1. inspect current `main`
2. inspect current implementation
3. inspect current migrations
4. inspect current tests
5. inspect current production-safe configuration where appropriate
6. confirm the capability still exists and behaves as documented

If the audit conflicts with current code:

**CURRENT CODE WINS.**

If current production differs from current code:

record the contradiction and determine whether the test should target intended code behavior or production reality.

Do not use memory or previous conversation context as authority.

---

# Objective

Build a comprehensive feature-wise testing architecture that answers:

> "If we change EasyModerator today, will CI tell us whether we broke a real merchant capability?"

The final system should cover, at the appropriate layer:

- backend domain logic
- APIs
- database invariants
- tenant isolation
- auth/security
- frontend behavior
- browser workflows
- queues/workers
- AI/RAG
- Meta Messenger
- product/catalog behavior
- Shared Inbox
- customers/CRM
- orders
- courier integrations
- subscription/billing/payment
- analytics
- notifications
- admin features
- media/file safety
- CI/CD
- production-safe smoke checks

Do not attempt to make every feature a browser test.

Use the cheapest reliable layer that proves the actual invariant.

Preferred order:

```text
UNIT
→ INTEGRATION
→ SERVICE E2E
→ BROWSER E2E
→ EXTERNAL LIVE TEST
```

Use external/live tests only where internal testing cannot establish the guarantee.

---

# Core principles

## 1. Test behavior, not implementation details

Good:

```text
yearly subscription does not renew monthly
```

Bad:

```text
method X was called once
```

when the latter does not prove merchant behavior.

---

## 2. Production-shaped where valuable

High-risk flows should use real:

- PostgreSQL
- Redis
- BullMQ
- migrations
- route middleware
- authorization
- workers
- service boundaries

where practical.

Avoid SQLite if PostgreSQL-specific behavior matters.

---

## 3. External providers get explicit boundaries

Use:

```text
REAL APPLICATION
→ REAL DOMAIN LOGIC
→ CAPTURE/FAKE AT OUTERMOST NETWORK HOP
```

for CI.

Examples:

```text
EasyModerator
→ bKash adapter
→ CAPTURE
```

```text
EasyModerator
→ Pathao adapter
→ CAPTURE
```

```text
EasyModerator
→ Resend adapter
→ CAPTURE
```

Do not mock internal business services merely to avoid setting up integration tests.

---

## 4. Preserve real live smoke tests where justified

We already have a real Meta tester environment.

Keep:

```text
Meta Test Page
Easy Style Fashion
EasyModerator Tester customer
admin@easymod.tech
```

for explicit real-Meta certification.

Do not turn real Meta transport into normal PR CI.

---

## 5. Never automate unsafe production actions

Never automatically execute in production:

- real bKash charge
- real courier booking
- destructive account deletion
- production DB wipe
- real customer email campaigns
- subscription mutation on real customers
- arbitrary Meta customer messaging
- data deletion
- credential rotation

Use:

- test database
- sandbox provider
- capture adapter
- dedicated test asset
- manual explicit smoke

as appropriate.

---

# Phase 0 — current-state verification

Before writing tests:

Read:

```text
docs/testing/WHOLE_APP_CURRENT_STATE_AUDIT.md
docs/testing/META_E2E_TEST_SETUP.md
docs/ai-cost/AI_TRUST_BOUNDARY.md
```

Then verify current:

```text
MAIN_HEAD
DEPLOYED_COMMIT
WORKTREE
OPEN_PRS
CI_STATUS
```

Resolve whether the urgent findings recorded in the audit are still open.

Especially re-check:

```text
yearly billing cadence
usage metering idempotency
Redis noeviction
billing-paused visibility
context-product history
safe-media-fetch flakiness
```

Do not recreate a bug test for behavior already legitimately fixed without first verifying current implementation.

Tests should preserve the corrected invariant.

---

# Phase 1 — create the test architecture

Create/update:

```text
docs/testing/WHOLE_APP_TEST_ARCHITECTURE.md
```

This becomes the authoritative test strategy.

Define test tiers:

```text
T0 — unit
T1 — database/service integration
T2 — application E2E
T3 — browser E2E
T4 — external provider smoke
T5 — production-safe certification
```

For each tier document:

```text
purpose
environment
database
Redis
queues
external providers
cleanup
CI trigger
timeout
failure semantics
```

---

# Phase 2 — create a central feature test registry

Create a machine-readable registry, preferably something equivalent to:

```text
tests/feature-registry.json
```

or another repository-appropriate format.

One entry per current capability.

Example:

```json
{
  "id": "F-ORD-001",
  "domain": "orders",
  "capability": "create order",
  "risk": "P1",
  "status": "active",
  "requiredTestLayers": [
    "integration",
    "browser"
  ],
  "externalProvider": null
}
```

Do not copy stale rows blindly.

Synchronize it with current code.

This registry will be used to identify:

```text
TESTED
PARTIAL
MISSING
MANUAL
NOT_APPLICABLE
```

capabilities.

---

# Phase 3 — PostgreSQL integration environment

Build/standardize a reusable integration-test environment using real PostgreSQL.

Use disposable database names containing:

```text
test
```

or:

```text
e2e
```

and preserve the existing destructive guard.

Tests must refuse destructive execution against arbitrary/prod DB names.

Create shared fixture infrastructure for:

```text
user
shop
membership
subscription
Meta channel
customer
conversation
messages
category
products
FAQ
order
invoice
payment
delivery provider
notifications
```

Use deterministic IDs/data where useful.

Do not duplicate fixtures across every suite.

---

# Phase 4 — Redis + BullMQ test infrastructure

Use real Redis service containers for tests that depend on:

- BullMQ
- sessions
- rate limits
- dedup
- locks
- caches

Create reliable queue helpers:

```text
waitForJob
waitForQueueIdle
assertNoFailedJobs
assertDlqEmpty
cleanupQueue
```

Do not use arbitrary sleeps where observable events can be awaited.

Verify production Redis configuration invariant:

```text
BullMQ Redis must use noeviction
```

if that remains the current requirement.

---

# Phase 5 — authentication/security suite

Build comprehensive coverage for:

## Authentication

```text
signup
signin
invalid password
logout
refresh
session revoke
forgot password
reset password
2FA setup
2FA verify
2FA failure
2FA disable
token-version invalidation
```

## Authorization

Test:

```text
unauthenticated
merchant
staff
owner
admin
SUPER_ADMIN
```

against all meaningful protected domains.

Explicitly verify:

```text
merchant A cannot access merchant B
shop A cannot read/write shop B resources
customer IDs cannot bypass tenant scope
conversation IDs cannot bypass scope
product IDs cannot bypass scope
order IDs cannot bypass scope
channel IDs cannot bypass scope
```

Tenant isolation is P0.

Create table-driven security tests where practical.

---

# Phase 6 — onboarding/setup browser journey

Implement Playwright coverage for:

```text
signup
→ signin
→ onboarding/setup
→ shop created/selected
→ setup status
```

Test:

- empty state
- validation
- refresh persistence
- mobile viewport where relevant
- failed API behavior
- successful completion

Do not call external Meta during this browser suite.

Use deterministic connected-channel fixture/state or a test seam.

---

# Phase 7 — product/catalog suite

Implement feature-level coverage for:

```text
create product
edit product
archive/delete
categories
variants
stock
track_quantity
price
images
AI attributes
search
visibility
```

Mandatory regressions:

```text
track_quantity=false + quantity=0 => available
track_quantity=true + quantity=0 => unavailable
```

Verify inactive/deleted products do not enter AI retrieval where they should not.

Verify cross-shop isolation.

---

# Phase 8 — product media/security suite

Test:

```text
valid image
invalid MIME
fake extension
oversized image
unsafe URL
localhost
private IP
redirect-to-private-IP
too many redirects
wrong magic bytes
cross-shop media
cross-product media
```

Fix any remaining flaky media tests structurally.

Run media timeout tests repeatedly to prove determinism.

No retries that hide flakiness.

---

# Phase 9 — RAG/Qdrant integration

The audit identifies Qdrant absence from CI as a meaningful gap.

Add a test Qdrant service if practical.

Use real:

```text
PostgreSQL
Qdrant
embedding interface
RAG service
```

Capture only the external embedding/LLM wire if necessary.

Create deterministic retrieval corpus:

```text
known exact product
partial match product
related product
nonexistent product
known FAQ
unknown FAQ
inactive product
cross-shop product
```

Verify:

```text
precision
tenant isolation
active filtering
partial-match behavior
unknown behavior
```

Do not use LLM output to determine whether retrieval succeeded.

---

# Phase 10 — AI trust-boundary regression suite

Preserve and expand existing Meta-shaped E2E.

Do NOT rebuild the system.

Add explicit assertions for every persisted grounding field supported by current schema.

For each turn verify equivalents of:

```text
grounding_decision
grounding_reason
grounding_product_status
grounding_media_status
grounding_media_product_id
grounding_verified_product_ids
grounding_knowledge_ids
grounding_violations
grounding_provider
grounding_attachment_urls
source_references
```

Use actual current field names.

Cover:

```text
nonexistent product
known product
unknown attribute
known attribute
product image
no product image
repeated pressure
conversation contamination
cross-shop product
unknown merchant policy
provider failover
retrieval failure
model malformed output
```

Keep real Meta smoke outside normal PR CI.

---

# Phase 11 — Shared Inbox suite

Implement service/integration coverage for:

```text
conversation creation
conversation list
conversation detail
pagination
search
filters
read/unread
message ordering
customer binding
manual reply
AI reply
draft mode
manual mode
auto mode
failed sends
retry
DLQ
attachments
```

For manual outbound messages:

run the real Meta provider abstraction up to its external network boundary and capture the final request.

Verify:

```text
recipient
Page
message text
attachment
provider metadata
persistence
```

---

# Phase 12 — frontend Shared Inbox Playwright

Test merchant behavior:

```text
open inbox
select conversation
see inbound message
send manual reply
AI draft appears
approve draft where supported
switch filters
mark/read state
open attachment
view customer context
error state
retry failed send
```

Use an isolated backend test environment.

Do not use real facebook.com in browser automation.

---

# Phase 13 — customer/CRM suite

First confirm current supported CRM capabilities from code.

Then test only real capabilities.

Likely areas include:

```text
customer creation from channel
manual customer creation if supported
profile
phone/email
search
filter
tags
segments
purchase history
merge
notes
```

Do not invent lead scoring or segmentation if current code does not implement it.

Tenant-isolation tests mandatory.

---

# Phase 14 — orders suite

Build full integration tests for order lifecycle.

At minimum:

```text
create
retrieve
update
cancel
status transition
customer association
items
quantity
variants/options
price freezing
delivery fee
discount if currently implemented
idempotency
```

Mandatory invariants:

```text
unit_price freezes at order creation
duplicate idempotency key does not duplicate order
invalid state transition rejected
shop isolation enforced
```

If stock mutation occurs:

test:

```text
decrement
cancel rollback
insufficient stock
track_quantity=false behavior
```

according to current implementation.

---

# Phase 15 — order browser E2E

Implement merchant journey:

```text
create customer/product fixture
→ open Orders
→ create order
→ verify totals
→ change status
→ open order detail
→ verify customer/product association
```

Test failure validation as well as happy path.

---

# Phase 16 — courier integration contract layer

For each currently implemented provider:

```text
Pathao
Steadfast
RedX
```

only if still present in code.

Build provider contract tests around capture/fake HTTP servers.

Verify:

```text
credential handling
request shape
address mapping
phone mapping
COD amount
booking response parsing
tracking parsing
error mapping
timeout
retry where supported
```

Never make real courier bookings in CI.

If sandbox credentials currently exist, document them by secret name only.

Do not use live booking automatically.

---

# Phase 17 — courier workflow integration

Test application behavior with provider adapters captured:

```text
configured provider
inactive provider
missing credentials
successful booking
provider rejection
timeout
duplicate booking attempt
tracking update
replayed webhook
cross-shop tracking attempt
```

Verify external side effect occurs at most once.

---

# Phase 18 — billing/subscription suite

This is P0.

Re-derive current billing implementation first.

Test:

```text
trial
monthly subscription
yearly subscription
period calculation
invoice generation
renewal
grace
dunning
suspension
reactivation
top-up if still supported
usage
manual test reconciliation
```

Mandatory yearly regression:

```text
yearly subscription
→ one annual entitlement
→ no monthly invoice
→ no monthly dunning
→ annual renewal only
```

Mandatory monthly regression:

```text
monthly subscription
→ monthly renewal
```

Verify repeated scheduler runs are idempotent.

---

# Phase 19 — billing test fixture

Create a dedicated non-production billing fixture.

Do not mutate real merchants.

Do not use:

```text
admin@easymod.tech
```

for destructive billing scenarios.

That production account may remain available as read-only/live smoke evidence where explicitly required.

For integration:

create isolated:

```text
billing-test@example.invalid
```

or repository-standard disposable account/shop.

Never create fake production revenue.

---

# Phase 20 — usage metering

Verify current usage logic.

Cover:

```text
conversation counted
same event deduplicated
valid idempotency format
different conversations counted independently
shop isolation
billing period association
top-up/overage ordering if currently implemented
```

If previous UUID issue is already fixed, preserve the regression test.

If not fixed, implement the test first, demonstrate failure, then fix via a separate coherent change.

---

# Phase 21 — bKash contract tests

Do not call real bKash in CI.

Use capture/fake server.

Test:

```text
checkout creation
success callback
failure callback
invalid signature
wrong IP where enforced
duplicate callback
wrong invoice
wrong amount
already-paid invoice
idempotency
subscription activation
```

A fake callback must never bypass the same validation used for real callbacks.

If sandbox credentials exist, build an optional manual sandbox smoke command, not normal CI.

---

# Phase 22 — billing-paused messaging

Test current expected behavior.

At minimum:

```text
inbound persists
AI does not generate commerce response
manual inbox remains usable
merchant/operator signal exists
customer billing details not exposed
repeated messages do not spam alerts
```

If current implementation differs, base tests on the corrected current domain invariant.

Do not alter the production tester subscription to test this.

Use isolated integration fixtures.

---

# Phase 23 — notifications

Build capture adapters/fake endpoints for:

```text
Resend
Slack
Telegram
browser push
```

Test:

```text
correct recipient
correct event
correct payload
no secret leakage
retry/failure
dedup/rate-limit where appropriate
```

Do not deliver real external notifications during PR CI.

Add optional explicit live-smoke commands only where worthwhile.

---

# Phase 24 — analytics

Build deterministic fixture datasets.

Test:

```text
conversation counts
orders
activation
retention
usage
AI cost
revenue
MRR
```

Use known timestamps.

Freeze clock where necessary.

Verify time boundaries:

```text
day
month
billing period
timezone
```

Financial analytics tests must distinguish:

```text
real collected payment
test reconciliation
failed payment
unpaid invoice
```

No test reconciliation should appear as real cash revenue.

---

# Phase 25 — admin suite

Test backend admin authorization and behavior.

Roles:

```text
merchant => forbidden
staff => forbidden
owner => forbidden
admin => allowed as appropriate
SUPER_ADMIN => allowed
```

Capabilities to verify if currently implemented:

```text
users
shops
subscriptions
analytics
audit logs
failed jobs
health
debug
manual reconciliation
```

Test tenant/admin boundary explicitly.

---

# Phase 26 — audit logs

For critical operations verify audit emission:

```text
login/security-sensitive changes
shop settings
channel connect/disconnect
subscription reconciliation
admin actions
order state changes
```

only where current implementation promises audit events.

Verify audit logs cannot be modified/deleted by ordinary users.

---

# Phase 27 — health/operational suite

Test:

```text
/health
/health/ready
DB unavailable
Redis unavailable
Qdrant unavailable
worker unhealthy if represented
```

Readiness should reflect actual critical dependency requirements.

Do not make flaky network assumptions.

---

# Phase 28 — queue failure tests

Inject controlled failures.

Verify:

```text
retry
backoff
final failure
DLQ
admin visibility
alert
idempotent retry
```

A retry must not duplicate:

```text
Meta reply
order
payment
courier booking
notification
```

where applicable.

---

# Phase 29 — frontend route-wide smoke suite

For every active frontend route discovered from current code:

test:

```text
route loads
correct auth redirect
no uncaught JS error
main API dependency succeeds or expected empty state displays
```

Use role-specific sessions.

Create separate coverage for:

```text
public
merchant
admin
```

Do not use one giant brittle Playwright script.

Organize by feature/domain.

---

# Phase 30 — responsive smoke

Run critical merchant workflows at least at:

```text
mobile viewport
desktop viewport
```

Prioritize:

```text
signin
onboarding
inbox
products
orders
subscription
```

This is behavioral responsiveness testing, not pixel-perfect screenshot locking.

Use visual regression only for stable key layouts if useful.

---

# Phase 31 — accessibility baseline

Add practical automated accessibility checks for key pages.

At minimum:

```text
signin
dashboard
inbox
products
orders
subscription
admin
```

Do not turn minor accessibility warnings into launch-blocking P0 failures unless truly critical.

Track them appropriately.

---

# Phase 32 — API contract checks

Ensure frontend API clients match backend contracts.

Create either:

- schema-based contract validation
- generated contract
- runtime contract test
- type-level parity where architecture supports it

Avoid maintaining a second manually duplicated API specification if possible.

Focus on drift-prone endpoints:

```text
auth
products
orders
inbox
subscription
admin
```

---

# Phase 33 — migration tests

Build migration verification against PostgreSQL.

At minimum:

```text
empty DB → latest
current previous schema → latest
migration idempotency where expected
critical constraints/indexes present
```

Never depend on `sequelize.sync()` as a substitute for migrations when production depends on migrations.

Specifically verify critical tables such as:

```text
order_sessions
meta_webhook_receipts
billing tables
grounding fields
```

---

# Phase 34 — schema drift test

Add a CI-safe schema audit comparing expected Sequelize/domain model against migrated PostgreSQL schema where useful.

Do not auto-alter production schema.

Schema drift should fail CI with actionable output.

---

# Phase 35 — CI restructuring

Create clear CI jobs such as:

```text
backend-unit
backend-security
backend-integration
meta-e2e
frontend-unit
frontend-build
frontend-e2e-smoke
```

Add Qdrant/PostgreSQL/Redis service containers only to jobs needing them.

Do not make every job start every dependency.

Parallelize appropriately.

`test:security` should become a required CI gate if it is stable.

Frontend Playwright should enter CI once deterministic.

---

# Phase 36 — flaky-test policy

No silent retries for deterministic feature tests.

A flaky test must be:

```text
FIXED
or
QUARANTINED WITH OWNER + REASON
```

Do not hide flakiness with:

```text
retries=5
```

unless the test is explicitly external/network-dependent and retry semantics are appropriate.

Track external smoke tests separately.

---

# Phase 37 — feature coverage report

Create:

```text
scripts/test-feature-coverage.js
```

or equivalent.

It should read the feature registry and report:

```text
TOTAL
FULLY_COVERED
PARTIAL
MISSING
MANUAL_ONLY
```

Output by risk:

```text
P0
P1
P2
P3
```

CI should fail if:

```text
ACTIVE P0 capability has no automated protection
```

unless explicitly classified:

```text
MANUAL_ONLY
```

with documented justification.

---

# Phase 38 — required documentation

Create/update:

```text
docs/testing/WHOLE_APP_TEST_ARCHITECTURE.md
docs/testing/FEATURE_TEST_COVERAGE.md
docs/testing/EXTERNAL_TEST_ASSETS.md
docs/testing/PRODUCTION_SMOKE_RUNBOOK.md
```

Do not put secret values into documentation.

For external credentials include only:

```text
SECRET_NAME
STATUS
PURPOSE
ENVIRONMENT
```

---

# Phase 39 — external test assets

Re-discover current test assets.

Do not rely solely on the audit snapshot.

Document current availability of:

```text
Meta test Page
Meta tester customer
Meta test shop/product
bKash sandbox
courier sandbox/test account
email capture
Slack test webhook/channel
Telegram test chat
Qdrant test service
```

Classify:

```text
AVAILABLE
MISSING
NOT_REQUIRED
MANUAL
```

Do not create external accounts or spend money automatically.

---

# Phase 40 — production smoke system

Create explicit post-deploy smoke commands.

They should be safe and mostly read-only.

Examples:

```text
health
ready
DB
Redis
Qdrant
queue
DLQ
migration version
critical configuration
billing scheduler sanity
```

Keep real Meta as explicit:

```text
npm run test:meta:live
```

Do not make it part of every deploy if it requires human customer messages.

---

# Do not over-test low-value implementation details

Avoid creating thousands of redundant tests merely to increase counts.

For each capability ask:

> What failure would hurt a merchant?

Then test that invariant.

Examples:

Product:

```text
merchant creates product
→ it exists in their shop
→ another shop cannot see it
→ AI sees it if active
```

Order:

```text
merchant creates order
→ totals correct
→ items frozen
→ duplicate request does not create duplicate
```

Billing:

```text
yearly customer
→ stays entitled for a year
→ does not get monthly dunning
```

---

# Required execution order

Do not attempt everything in one giant PR.

Use incremental milestones.

Recommended order:

```text
M1 — shared test infrastructure + registry
M2 — auth/security/tenant isolation
M3 — products/catalog/media
M4 — AI/RAG/Meta
M5 — inbox/customers
M6 — orders
M7 — billing/payment
M8 — courier/notifications
M9 — analytics/admin
M10 — frontend Playwright
M11 — migration/schema/ops
M12 — final coverage enforcement
```

Adjust based on actual dependency graph.

Each milestone should:

```text
branch
implement
test
PR
CI
merge
```

before moving to the next, unless repository workflow strongly favors a different safe approach.

---

# Bug discovery rule

Tests will likely uncover bugs.

When a new bug is found:

1. prove it with a failing test
2. determine severity
3. fix it if it is directly within the milestone
4. add regression coverage
5. document it

Do not weaken the test to accommodate broken behavior.

For unrelated large defects:

open/document a separate finding rather than expanding the PR uncontrollably.

---

# Security constraints

Never expose:

```text
Facebook passwords
Page access tokens
App Secret
bKash secrets
courier credentials
email credentials
Telegram token
Slack webhook
JWT secrets
DB password
Redis password
2FA codes
PSIDs in committed docs where prohibited
```

Secret inspection means:

```text
PRESENT
MISSING
UNKNOWN
```

not value dumping.

---

# Production safety

No destructive production writes are authorized by this prompt except normal behavior of a dedicated explicitly identified test asset during an explicit live smoke.

Do not:

```text
drop production tables
flush production Redis
alter real customer subscriptions
book real courier
charge bKash
delete customer data
send messages to arbitrary customers
```

---

# Definition of done

This project is complete only when:

```text
all ACTIVE P0 features have automated protection
all ACTIVE P1 features have meaningful automated coverage or documented external/manual justification
critical P2 workflows have coverage
backend security suite runs in CI
real PostgreSQL integration tests exist
real Redis/BullMQ integration tests exist
RAG/Qdrant behavior is tested
frontend critical journeys run in Playwright CI
billing is covered by deterministic time-based tests
orders are covered end to end internally
courier/payment external boundaries use capture/sandbox safely
feature registry and test coverage report are maintained
production smoke runbook exists
CI is green
```

Do not require real-money or real-courier actions to call the internal test suite complete.

---

# Final whole-app certification command

Create one aggregate command appropriate to the repository, conceptually:

```text
npm run test:whole-app
```

It should orchestrate all deterministic automated gates.

It should NOT invoke human/live external tests.

Separately expose commands such as:

```text
npm run test:meta:live
npm run test:bkash:sandbox
npm run test:courier:sandbox
npm run test:prod:smoke
```

only where actually implemented and safe.

---

# Final report

At completion return:

```text
CURRENT_MAIN_COMMIT=
DEPLOYED_COMMIT=

FEATURE_REGISTRY=
TOTAL_ACTIVE_CAPABILITIES=

P0_TOTAL=
P0_AUTOMATED=
P0_MANUAL_ONLY=
P0_MISSING=

P1_TOTAL=
P1_AUTOMATED=
P1_PARTIAL=
P1_MISSING=

P2_TOTAL=
P2_AUTOMATED=

BACKEND_UNIT=
BACKEND_SECURITY=
BACKEND_INTEGRATION=
POSTGRES_INTEGRATION=
REDIS_INTEGRATION=
BULLMQ_INTEGRATION=
QDRANT_INTEGRATION=

META_SHAPED_E2E=
REAL_META_E2E_STATUS=

PRODUCT_TESTS=
INBOX_TESTS=
CUSTOMER_TESTS=
ORDER_TESTS=
BILLING_TESTS=
PAYMENT_TESTS=
COURIER_TESTS=
NOTIFICATION_TESTS=
ANALYTICS_TESTS=
ADMIN_TESTS=
MEDIA_SECURITY_TESTS=

FRONTEND_UNIT=
PLAYWRIGHT_E2E=
RESPONSIVE_SMOKE=
ACCESSIBILITY_BASELINE=

MIGRATION_TESTS=
SCHEMA_DRIFT=
QUEUE_FAILURE_TESTS=

WHOLE_APP_COMMAND=

CI_REQUIRED_GATES=

EXTERNAL_TEST_ASSETS=
MISSING_TEST_ASSETS=

BUGS_FOUND=
BUGS_FIXED=
OPEN_FINDINGS=

PRS=
MERGE_COMMITS=

FINAL_TEST_COUNT=
FLAKY_TESTS=
SKIPPED_REQUIRED_TESTS=

PROD_SMOKE=

DOCUMENTATION=

FINAL_VERDICT=
WHOLE_APP_AUTOMATED_TEST_SYSTEM_COMPLETE
|
PARTIAL
|
NOT_COMPLETE
```

Only return:

```text
FINAL_VERDICT=WHOLE_APP_AUTOMATED_TEST_SYSTEM_COMPLETE
```

when:

```text
P0_MISSING=0
SKIPPED_REQUIRED_TESTS=0
FLAKY_TESTS=0
all required CI gates are green
and the feature registry accurately reflects current code.
```

Do not judge completion by raw test count.

Judge it by whether every current business-critical EasyModerator capability has an appropriate reliable verification boundary.