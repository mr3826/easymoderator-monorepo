You are the senior full-stack engineer responsible for producing an **authoritative, repository-derived current-state map of the entire EasyModerator application**.

This is a DISCOVERY/AUDIT task only.

The next engineering task will use your report to design a **feature-by-feature automated testing system for the entire application**.

Therefore your job now is to determine exactly what EasyModerator currently is, what exists, how every major feature works, what is deployed, what is already testable, what external test assets exist, and where testing gaps remain.

---

# Critical rule: use ZERO memory as authority

Do **not** answer from:

- previous conversations
- previous Codex/Claude context
- project memory
- old audit reports
- assumptions about EasyModerator
- remembered architecture
- remembered feature lists
- remembered production state

Treat all previous knowledge as potentially stale.

You must derive the current application state again from the actual current codebase and live configuration.

## Source-of-truth priority

Use:

1. current tracked source code
2. migrations / database schema
3. current configuration
4. current CI/CD workflows
5. current infrastructure definitions
6. current tests
7. current production-safe inspection
8. current GitHub state
9. documentation only as corroborating evidence

If documentation conflicts with code, **code wins**.

If production differs from repository expectations, explicitly report the difference.

Do not silently reconcile contradictions.

---

# Scope

Audit the **entire EasyModerator application**, not only AI or Messenger.

Include every currently relevant repository/component you discover, such as:

- backend
- frontend
- database
- Redis/BullMQ
- vector/search infrastructure
- AI/RAG
- Meta/Facebook integration
- authentication
- authorization
- onboarding
- shops
- channels
- shared inbox
- conversations
- customers
- products
- catalog
- product attributes/templates
- knowledge/FAQ
- AI configuration
- orders
- courier integrations
- billing/subscriptions
- payments
- usage tracking
- analytics
- notifications
- admin functionality
- file/media handling
- security
- audit logs
- background jobs
- schedulers
- webhooks
- exports/imports
- marketing/application boundaries if stored in the same system
- Growth OS/internal applications if they are actually part of the current deployed codebase
- operational/launch tooling
- CI/CD
- production deployment
- test infrastructure

Do not include a feature merely because an old document says it exists.

Prove it from current code.

---

# PHASE 1 — establish repository boundaries

Start from the actual workspace.

Discover:

```text
git roots
tracked repositories
submodules
nested applications
backend directories
frontend directories
shared packages
scripts
infrastructure
Docker configuration
GitHub workflows
migrations
docs
tests
```

Report:

```text
REPOSITORY=
CURRENT_BRANCH=
CURRENT_HEAD=
ORIGIN=
MAIN_HEAD=
DIRTY_WORKTREE=
```

for every relevant Git repository.

Do not accidentally audit stale nested clones as active code.

Determine which repository/build actually reaches production.

---

# PHASE 2 — create a complete tracked-file coverage ledger

This is mandatory.

Use the repository equivalent of:

```bash
git ls-files
```

for every active repository.

Every tracked file must end the audit in one of these states:

```text
REVIEWED
GENERATED
VENDOR
STATIC_ASSET
TEST_FIXTURE
DEPRECATED
NOT_RUNTIME_RELEVANT
```

For anything other than `REVIEWED`, include a short reason.

Do not simply search for feature keywords and call the repository audited.

The purpose of the ledger is to prove that no active source area was silently skipped.

## Exclusions

You do not need to manually inspect every line of:

- generated lockfiles
- build artifacts
- vendored dependencies
- compiled assets
- binary/static assets

But they must still appear/classify in the coverage accounting.

Source code, configuration, migrations, tests, workflows and scripts must be inspected.

At the end provide:

```text
TOTAL_TRACKED_FILES=
REVIEWED_FILES=
CLASSIFIED_NON_SOURCE_FILES=
UNRESOLVED_FILES=
```

`UNRESOLVED_FILES` must be 0 for a complete audit.

---

# PHASE 3 — derive the architecture from code

Produce the actual current architecture.

Map:

```text
Browser/UI
→ frontend routes/components
→ frontend API client
→ backend routes/controllers
→ services/domain logic
→ PostgreSQL
→ Redis
→ BullMQ
→ vector/search services
→ AI providers
→ external providers
```

Identify all independently running runtime processes:

```text
frontend
API
worker
scheduler
database
Redis
vector DB
reverse proxy
other services
```

For each:

```text
PROCESS=
ENTRYPOINT=
RESPONSIBILITY=
DEPENDENCIES=
DEPLOYMENT_UNIT=
HEALTH_SIGNAL=
```

Create a concise Mermaid architecture diagram.

---

# PHASE 4 — build the authoritative feature inventory

Identify features from implementation, not documentation.

Create one row for every meaningful user-facing, merchant-facing, admin-facing and operational feature.

Required columns:

| Field | Meaning |
|---|---|
| Feature ID | Stable audit identifier |
| Domain | Auth / Inbox / Products / Billing etc. |
| Feature | Human-readable feature |
| User type | Merchant / customer / admin / system |
| Frontend entry | Route/component |
| Backend entry | API/webhook/job |
| Core services | Main business logic |
| Data tables | Authoritative persistence |
| Background jobs | If any |
| External provider | If any |
| Status | ACTIVE / PARTIAL / DISABLED / DEAD / INTERNAL |
| Production evidence | Where applicable |
| Existing tests | Exact suites |
| Test level | unit/integration/E2E/live |
| Testing gap | What is not proven |

Do not collapse large domains into a single row.

Example:

Do not write merely:

```text
Products — implemented
```

Break it into actual supported capabilities discovered from code, such as:

```text
create product
edit product
archive/delete product
variants
images
AI-visible attributes
templates
search
etc.
```

but only when those capabilities really exist.

---

# PHASE 5 — frontend inventory

Inspect all active frontend routes and navigation.

Produce:

```text
ROUTE
PAGE/COMPONENT
AUTH_REQUIRED
ROLE_REQUIRED
PRIMARY_API_CALLS
FEATURE
CURRENT_STATUS
```

Include:

- public pages
- authentication
- onboarding
- dashboard
- settings
- admin pages
- hidden/internal routes
- error routes
- callback routes

Also identify important UI interactions:

```text
buttons
forms
modals
tables
filters
pagination
uploads
connect/disconnect flows
create/edit/delete
confirmation flows
empty states
error states
```

Do not attempt visual QA yet.

This audit is identifying what future tests must exercise.

---

# PHASE 6 — backend/API inventory

Enumerate all current externally or internally meaningful backend entry points.

Include:

- REST endpoints
- webhooks
- SSE/WebSocket if any
- internal callbacks
- background processors
- scheduled jobs
- admin endpoints

For APIs capture:

```text
METHOD
PATH
AUTH
ROLE/PERMISSION
REQUEST CONTRACT
RESPONSE CONTRACT
SERVICE
SIDE EFFECT
TABLES
EXTERNAL CALL
ERROR STATES
EXISTING TEST
```

Do not paste huge schemas; summarize precisely and point to source files.

Identify dead/unmounted route modules separately.

---

# PHASE 7 — database and domain-model inventory

Read migrations and current model/entity/schema definitions.

Build an authoritative table inventory:

```text
TABLE
DOMAIN
PRIMARY KEY
IMPORTANT FOREIGN KEYS
IMPORTANT UNIQUE CONSTRAINTS
IMPORTANT STATE ENUMS
SOFT DELETE?
TENANT KEY
HIGH-RISK DATA
```

Pay special attention to:

- tenant/shop scoping
- users
- memberships
- channels
- customers
- conversations
- messages
- products
- product media
- knowledge
- orders
- billing
- invoices
- payments
- usage
- queues/durable receipts
- audit records
- notifications

Identify database invariants future tests should verify.

---

# PHASE 8 — authentication and authorization

Map the complete current security model.

Include:

```text
signup
login
logout
refresh/session
password reset
email verification
2FA
roles
SUPER_ADMIN
merchant/shop membership
tenant isolation
API guards
admin guards
webhook authentication
CSRF/state/nonce protections where applicable
```

For each authorization boundary document:

```text
WHO_CAN_CALL
HOW_ENFORCED
FAILURE_RESPONSE
TEST_EXISTS?
```

Explicitly find places where authorization depends only on frontend hiding rather than backend enforcement.

---

# PHASE 9 — Meta/Facebook integration

Derive the current Meta implementation again from code.

Do not rely on previous Meta audit context.

Map:

```text
OAuth
Page discovery
Page connection
Page token storage
token refresh
webhook verification
Page subscription
inbound Messenger
dedup
queue
worker
AI/manual handling
outbound Messenger
attachments
disconnect
deauthorization
data deletion
policy-window enforcement
```

Determine current requested permissions from code/config.

Determine current webhook fields.

Inspect current tester infrastructure and test harness.

Document existing safe test assets/configuration that can be discovered without exposing credentials.

Examples:

```text
Meta App ID
tester Page IDs where safe
test shop
test channel
real-Meta harness
PSID discovery mechanism
test product
```

Do **not** print:

```text
Page token
App Secret
Facebook password
PSID if policy says not to commit it
cookies
session credentials
```

For secrets report only:

```text
SECRET_NAME
PRESENT / MISSING / UNKNOWN
```

---

# PHASE 10 — AI system

Map the current complete AI path.

Include:

```text
message intent routing
conversation history
product search
knowledge retrieval
embeddings
vector store
RAG
provider selection
Gemini
OpenAI fallback
circuit breaker
cache
grounding evidence
outbound grounding gate
confidence
policy gate
send/suppress/fallback
observability
```

Use the current `AI_TRUST_BOUNDARY.md` only after confirming it against implementation.

Report any divergence.

Document existing AI test suites, including Meta-shaped E2E and real-Meta certification infrastructure.

Do not redesign AI in this task.

---

# PHASE 11 — products/catalog

Inventory actual product functionality.

Inspect:

- product CRUD
- status
- category
- pricing
- quantity
- stock tracking
- variants/options
- attributes
- AI fields
- media
- image/file safety
- templates
- semantic search
- embeddings
- Facebook import if currently implemented
- product visibility
- order integration

For each, identify frontend, backend, persistence, and test coverage.

---

# PHASE 12 — Shared Inbox / messaging

Map:

```text
inbound message
conversation creation
customer matching
conversation list
message history
manual reply
AI reply
AI pause/HITL
attachments
failed sends
retries
read/unread
assignment if present
filters/search if present
customer profile enrichment
message metadata
```

Include all automation modes and conditions that block automatic replies.

---

# PHASE 13 — customers/CRM

Identify actual current capabilities:

```text
customer creation
profile
phone/email
tags
segments
purchase history
notes
lead scoring
customer merge
search/filter
CRM analytics
```

Only mark implemented capabilities that code proves exist.

---

# PHASE 14 — orders

Trace full order lifecycle.

Include:

```text
create
edit
status changes
customer association
products/order items
pricing
discounts
delivery fee
address
payment state
courier state
cancel
manual vs AI creation
```

Document domain states/enums and transitions.

Identify invalid transitions future tests should reject.

---

# PHASE 15 — courier integrations

Discover every current courier provider.

For each:

```text
PROVIDER
STATUS
CONFIG
AUTH METHOD
CREATE BOOKING
TRACKING
CANCEL if supported
WEBHOOK/CALLBACK
RETRY
FAILURE HANDLING
TEST MODE
EXISTING TESTS
PRODUCTION TESTABILITY
```

Examples may include Pathao/Steadfast/RedX, but do not assume they exist.

Use only what code proves.

Never print credentials.

---

# PHASE 16 — subscriptions/billing/payments

Re-derive current billing behavior.

Include:

```text
plans
trial
monthly/yearly
usage
grace
renewal
invoice creation
payment
bKash
top-ups
failed payment
dunning
suspension
reactivation
manual reconciliation
revenue exclusion
admin billing tools
```

Determine current production-safe tester state for:

```text
admin@easymod.tech
Easy Style Fashion
```

but do not alter it.

Report only enough current state to support future automated testing.

Verify the annual-billing fixes from current code rather than assuming they were deployed.

---

# PHASE 17 — file/media handling

Audit all upload/download/remote-fetch functionality.

Capture:

```text
file types
size limits
storage location
public/private URL behavior
ownership
shop isolation
SSRF protections
MIME checks
filename/path safety
cleanup
Meta attachment usage
```

Identify corresponding tests.

---

# PHASE 18 — notifications and operational signals

Inventory:

```text
merchant notifications
admin notifications
Slack/Sentry alerts
billing alerts
AI pause signals
DLQ alerts
canaries
email notifications
Telegram if actually implemented
```

Determine which are code paths versus configuration-only.

---

# PHASE 19 — admin capabilities

Inspect actual SUPER_ADMIN/admin functionality.

Inventory:

```text
users
shops
subscriptions
billing
support/debug tools
system health
analytics
impersonation if any
manual reconciliation
feature controls
```

Report authorization boundaries carefully.

---

# PHASE 20 — analytics

Inventory all metrics/dashboard/reporting features.

For each metric identify:

```text
definition
source tables
API
frontend
aggregation
time boundaries
test coverage
financial sensitivity
```

Pay special attention to:

```text
revenue
MRR
usage
activation
retention
conversation counts
order counts
AI usage
```

---

# PHASE 21 — background processing

Enumerate every BullMQ queue, worker, scheduler and recurring job.

For each:

```text
QUEUE/JOB
PRODUCER
CONSUMER
RETRY
BACKOFF
IDEMPOTENCY
FAILED STATE
DLQ
RETENTION
OBSERVABILITY
TEST
```

Identify Redis assumptions, including current eviction policy requirements.

---

# PHASE 22 — external integrations inventory

Create one authoritative integration matrix.

Include every external service discovered in code:

```text
SERVICE
PURPOSE
CURRENTLY ACTIVE?
CONFIG VARIABLES
SECRET NAMES
SANDBOX/PROD SUPPORT
TEST ACCOUNT AVAILABLE?
MOCK/FAKE AVAILABLE?
EXISTING INTEGRATION TEST?
LIVE TEST SAFE?
```

Potential examples include, only if actually present:

- Meta
- Gemini
- OpenAI
- bKash
- courier providers
- email
- Sentry
- Slack
- Telegram
- Qdrant
- object storage
- other providers

Never expose secret values.

---

# PHASE 23 — configuration and feature flags

Inventory meaningful environment variables and configuration switches.

Classify:

```text
REQUIRED_PRODUCTION
OPTIONAL
TEST_ONLY
DEPRECATED
UNKNOWN
```

Identify feature flags/modes that materially change behavior.

Do not copy secret values.

---

# PHASE 24 — production topology

Using current deployment configuration and safe production inspection where authorized, report:

```text
DOMAIN
SERVICE
CONTAINER
IMAGE/COMMIT
PORT
HEALTH
DEPENDENCIES
```

Verify actual deployed commit.

Capture:

```text
PRODUCTION_MAIN_COMMIT=
PRODUCTION_DEPLOYED_COMMIT=
MATCH=
```

Inspect health only through safe read commands.

Do not restart or alter production during this audit.

---

# PHASE 25 — CI/CD

Inventory every current GitHub Actions workflow/job.

For each:

```text
WORKFLOW
TRIGGER
TESTS
BUILD
SECURITY
MIGRATIONS
DEPLOY
MANUAL STEPS
SECRETS USED BY NAME
```

Determine exactly what currently blocks deployment.

Document tests that exist but are not part of CI.

---

# PHASE 26 — current automated test inventory

This is critical for the next prompt.

Enumerate every current test suite.

For each:

```text
TEST_SUITE
DOMAIN
FILES
TEST_COUNT if practical
TYPE = unit/integration/E2E/live
REAL_DB?
REAL_REDIS?
REAL_QUEUE?
REAL_PROVIDER?
MOCKED_BOUNDARIES
CI?
WHAT_IT_PROVES
WHAT_IT_DOES_NOT_PROVE
```

Do not equate a unit test with feature certification.

Explicitly identify:

- frontend tests
- backend tests
- database integration tests
- Meta-shaped E2E
- real Meta E2E
- billing tests
- courier tests
- payment tests
- security tests
- media tests
- production smoke tests

---

# PHASE 27 — existing test credentials/assets

We have intentionally created various tester integrations over time.

Discover what currently exists.

Do not rely on memory.

For each integration, determine whether the repository/configuration/current safe production state exposes:

```text
TEST_ASSET
STATUS
ENVIRONMENT
ACCOUNT/SHOP
IDENTIFIER
CREDENTIAL_SECRET_NAMES
CAN_RUN_AUTOMATICALLY?
REQUIRES_HUMAN?
CAN_MUTATE_REAL_EXTERNAL_STATE?
```

Never print credential values.

This section is essential for designing future real-integration tests.

---

# PHASE 28 — destructive action inventory

Identify features whose tests can create irreversible or externally visible actions.

Examples:

```text
real payment
courier booking
Meta send
email send
account deletion
subscription mutation
data deletion
production order
external webhook
```

For each classify:

```text
SAFE_AUTOMATED
SAFE_WITH_TEST_ASSET
SAFE_WITH_CAPTURE/FAKE
MANUAL_ONLY
DO_NOT_AUTOMATE_IN_PROD
```

This will define the boundaries of the later whole-app test suite.

---

# PHASE 29 — feature dependency map

For every major feature, show dependencies.

Example format:

```text
Facebook auto reply
  requires:
    shop
    active channel
    customer
    inbound webhook
    subscription active
    AI mode enabled
    worker
    Redis
    product/knowledge retrieval
    LLM
    grounding
    Meta Send API
```

Do this for all core business flows.

---

# PHASE 30 — business-critical end-to-end journeys

Derive the actual supported journeys from current implementation.

At minimum evaluate whether code supports flows equivalent to:

```text
signup → onboarding → shop
connect Page
add product
add knowledge
customer messages Page
AI responds
merchant replies manually
customer matched
order created
courier booked
payment/subscription
analytics updated
```

But do not force this sequence if current code differs.

Document actual user journeys that the future test suite must certify.

---

# PHASE 31 — testability assessment

For each feature assign one of:

```text
READY_FOR_UNIT_TEST
READY_FOR_INTEGRATION_TEST
READY_FOR_BROWSER_E2E
READY_FOR_EXTERNAL_E2E
NEEDS_TEST_SEAM
NEEDS_TEST_ASSET
MANUAL_ONLY
UNSAFE_TO_AUTOMATE
```

Explain why.

Identify where a small test seam would be useful, but **do not implement it yet**.

---

# PHASE 32 — risk classification

For each feature classify failure impact:

```text
P0 = security / money / tenant isolation / data loss / uncontrolled external action
P1 = core merchant revenue path broken
P2 = meaningful functionality broken
P3 = UX/non-critical
```

This will determine test priority in the next phase.

---

# PHASE 33 — identify current gaps, not fixes

Create a list of:

```text
UNTESTED_FEATURE
PARTIALLY_TESTED_FEATURE
UNTESTABLE_FEATURE
MISSING_TEST_ASSET
FLAKY_TEST
CI_GAP
PRODUCTION_ONLY_GAP
```

Do not implement fixes during this task.

We need a clean baseline first.

---

# Required report artifact

Create:

```text
docs/testing/WHOLE_APP_CURRENT_STATE_AUDIT.md
```

This document must be sufficiently complete that a different engineer with no prior EasyModerator context could use it to design the full feature-wise test system.

Do not create a generic narrative.

Use evidence-heavy tables and source paths.

---

# Required report structure

## 1. Executive state

```text
AUDIT_DATE=
REPOSITORIES=
MAIN_HEAD=
DEPLOYED_COMMIT=
PROD_MATCHES_MAIN=
TOTAL_TRACKED_FILES=
REVIEWED_FILES=
UNRESOLVED_FILES=
```

## 2. System architecture

Include Mermaid diagram.

## 3. Runtime processes

## 4. Frontend route inventory

## 5. Backend/API inventory

## 6. Database/domain model

## 7. Feature inventory

## 8. Authentication/authorization

## 9. Meta/Messenger

## 10. AI/RAG/grounding

## 11. Products/catalog

## 12. Shared Inbox

## 13. Customers/CRM

## 14. Orders

## 15. Courier

## 16. Billing/subscriptions/payments

## 17. Media/files

## 18. Notifications/operations

## 19. Admin

## 20. Analytics

## 21. Background jobs/queues

## 22. External integrations

## 23. Configuration/feature flags

## 24. Production topology

## 25. CI/CD

## 26. Existing test inventory

## 27. Existing test credentials/assets

## 28. Destructive-action safety matrix

## 29. Feature dependency map

## 30. Business-critical journeys

## 31. Feature-by-feature testability matrix

## 32. Risk ranking

## 33. Current testing gaps

## 34. File coverage ledger

---

# Mandatory feature-wise test matrix

The report must contain a final normalized matrix with one row per testable capability:

| Feature ID | Domain | Capability | Status | P0/P1/P2/P3 | Existing coverage | Best future test layer | External dependency | Test asset available | Human required | Data mutation | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|

This matrix will be the primary input for the next prompt.

Be granular.

---

# Evidence requirements

Every important claim should cite exact repository evidence such as:

```text
path/to/file.js:Lx-Ly
migration file
route
service
test
workflow
Docker configuration
production-safe command/result
```

Do not invent line numbers before reading files.

If line numbers are unstable, file + symbol/function is acceptable.

---

# Contradictions

Maintain a section:

```text
CODE_VS_DOC_CONTRADICTIONS
CODE_VS_PRODUCTION_CONTRADICTIONS
STALE_CONFIG
DEAD_CODE
UNKNOWN_BEHAVIOR
```

Do not hide contradictions.

---

# No implementation changes

During this task:

DO NOT:

- redesign features
- fix bugs
- modify business logic
- alter production data
- create payments
- create courier bookings
- send Meta messages
- rotate secrets
- change infrastructure
- merge unrelated PRs

You may safely:

- read production state
- inspect GitHub
- inspect secret names
- inspect DB rows
- inspect logs
- run non-destructive tests
- run static analysis
- create/update only the audit document

If you discover an urgent P0 defect, report it clearly but do not fix it in this task.

---

# Completeness gate

Before finishing, verify:

```text
ALL_ACTIVE_REPOS_DISCOVERED = YES
ALL_TRACKED_FILES_CLASSIFIED = YES
ALL_FRONTEND_ROUTES_MAPPED = YES
ALL_BACKEND_ENTRYPOINTS_MAPPED = YES
ALL_DATABASE_DOMAINS_MAPPED = YES
ALL_ACTIVE_FEATURES_MAPPED = YES
ALL_EXTERNAL_INTEGRATIONS_MAPPED = YES
ALL_BACKGROUND_JOBS_MAPPED = YES
ALL_EXISTING_TESTS_MAPPED = YES
ALL_TEST_ASSETS_MAPPED = YES
ALL_CRITICAL_BUSINESS_JOURNEYS_MAPPED = YES
FEATURE_TESTABILITY_MATRIX_COMPLETE = YES
UNRESOLVED_FILES = 0
```

If any is NO, continue auditing.

Do not return `AUDIT_COMPLETE`.

---

# Final response

Return only a concise handoff after writing the report:

```text
REPORT=
AUDIT_COMMIT=

REPOSITORIES=
MAIN_HEAD=
DEPLOYED_COMMIT=

TOTAL_TRACKED_FILES=
REVIEWED_FILES=
UNRESOLVED_FILES=

ACTIVE_FEATURE_COUNT=
FEATURE_CAPABILITY_ROWS=

FRONTEND_ROUTES=
BACKEND_ENTRYPOINTS=
DATABASE_TABLES=
BACKGROUND_JOBS=
EXTERNAL_INTEGRATIONS=

CURRENT_TEST_SUITES=
CURRENT_TEST_ASSETS=

P0_CAPABILITIES=
P1_CAPABILITIES=
P2_CAPABILITIES=
P3_CAPABILITIES=

FULLY_TESTED_CAPABILITIES=
PARTIALLY_TESTED_CAPABILITIES=
UNTESTED_CAPABILITIES=
MANUAL_ONLY_CAPABILITIES=

CODE_VS_PRODUCTION_CONTRADICTIONS=
URGENT_FINDINGS=

NEXT_INPUT_FOR_TEST_DESIGN=
docs/testing/WHOLE_APP_CURRENT_STATE_AUDIT.md

COMPLETENESS=
AUDIT_COMPLETE
|
INCOMPLETE
```

Only return:

```text
COMPLETENESS=AUDIT_COMPLETE
```

when every active tracked source/config/test/workflow/migration area has been reviewed or explicitly classified, `UNRESOLVED_FILES=0`, and the feature-wise testability matrix is complete.

The purpose of this task is **not to tell me what you remember EasyModerator does**.

The purpose is to reconstruct, from the current codebase and current deployed system, exactly what EasyModerator does **today**, so the next engineering prompt can build a comprehensive feature-wise automated test system from evidence rather than assumptions.