# EasyModerator Meta E2E Test Setup

**Date** 2026-08-10 · Single authoritative setup/handoff document for the Meta
E2E test system. The invariant under test is stated once, in
[`docs/ai-cost/AI_TRUST_BOUNDARY.md`](../ai-cost/AI_TRUST_BOUNDARY.md), and is
not repeated here:

> LLM output is a candidate response, not an authoritative response.

## Current status

```
IMPLEMENTATION_STATUS = COMPLETE (both layers)
LIVE_META_READY       = READY
MISSING_INPUTS        = none — every value is discovered from the deployed
                        database at run time
FOUNDER_ACTION        = send the messages the runner prints, from the tester
                        customer account (§10)
```

Layer 1 (automated, CI) is complete and green: 31 assertions across
META-E2E-001…012, running the real webhook → queue → worker → retrieval → AI →
grounding → Meta provider path. It needs **no Meta credential and no founder
input** — it runs on every backend PR.

Layer 2 (real Meta) is complete. The runner discovers the shop, the connected
Page, the channel, the tester conversation, the customer PSID and the positive
product fixture from the deployment's own records, and refuses to guess when any
of them is ambiguous. The only manual step left is the one Meta gives no
server-side API for: a real person sending a real Messenger message.

---

## 1. Test assets

**Merchant tester account**
```
STATUS          = DONE
EASYMOD_LOGIN   = admin@easymod.tech
USER_ID         = 14189ba9-dba6-410f-920f-c176e323fffc
FB_ROLE         = App Tester on 2040799330176198, accepted
VALUE_REQUIRED  = NO LOGIN CREDENTIALS
```
Nothing in this test system reads or stores a Facebook credential. This account
matters only because it is the identity that completed EasyModerator's normal
Facebook connection flow for the tester Page.

**Customer tester Facebook account**
```
STATUS          = DONE
DISPLAY_NAME    = EasyModerator Tester
FB_ROLE         = App Tester on 2040799330176198, accepted
VALUE_REQUIRED  = NO LOGIN CREDENTIALS
```
It is an **external test actor**. EasyModerator learns only its Page-scoped ID
(PSID), and only from a legitimate inbound webhook — see §5.

**Tester Page**
```
STATUS    = FOUND
PAGE_NAME = Easy Style Fashion
PAGE_ID   = 1213925798474895
```

**EasyModerator tester shop**
```
STATUS    = FOUND
SHOP_NAME = Easy Style Fashion
SHOP_ID   = 458b6a78-d409-4740-9fbd-c48875d67155
TENANT_ID = 3c4514d9-1785-4bd7-a150-c7d351282e5f
IS_ACTIVE = true
OWNER     = admin@easymod.tech (user_shops.role = owner)
```

**EasyModerator Facebook channel**
```
STATUS       = FOUND
CHANNEL_ID   = 77091ba8-9218-429c-a7e4-54f28ad88a2b
META_PAGE_ID = 1213925798474895
PLATFORM     = facebook
CHANNEL_STATUS = CONNECTED
CONNECTED_AT = 2026-08-08T20:33:01Z
WEBHOOK_SUBSCRIBED_FIELDS = ["messages"]  · last verified 2026-08-08T20:33:13Z
```

> The same shop also carries a **DISCONNECTED** channel
> (`5c9ba504-…`, Page `1006927412511938`, "Bornohin Fashion BD") left over from
> an earlier Page. Discovery filters on `status = CONNECTED` for exactly this
> reason — and so does the PSID lookup in §5, because that stale Page has its
> own customer row for the same human.

Discovery order in the live runner, most specific first:
`META_E2E_PAGE_ID` → `META_E2E_SHOP_ID` → `META_E2E_SHOP_NAME` →
`META_E2E_MERCHANT_EMAIL` → the only active shop / the only CONNECTED facebook
channel. Anything ambiguous is an error naming the candidates, never a guess.

### Automated-suite fixtures (no founder input, FOUND)

The CI suite creates its own two shops and Pages in a disposable database, so it
never depends on any of the above:

| Fixture | Value |
| --- | --- |
| Shop A | `aaaaaaaa-0000-4000-8000-00000000000a` — owns the catalog |
| Shop B | `bbbbbbbb-0000-4000-8000-00000000000b` — isolation counterparty |
| Page A / Channel A | `100000000000001` / `aaaaaaaa-1111-4111-8111-11111111111a` |
| Page B / Channel B | `100000000000002` / `bbbbbbbb-1111-4111-8111-11111111111b` |
| Customer PSID | `7000000000000001` |

Source of truth: `EasyMod-backend/tests/meta-e2e/fixtures.js`.

---

## 2. Meta application

```
META_APP_ID = 2040799330176198          (app "saas-easymod")
STATUS      = FOUND
```
Discovered via the Meta Developer Tools MCP. App status is **`dev_mode`**
(`is_live = false`), App Review submission status `UNSUBMITTED`. That has a
direct consequence for live testing — see §3 and §10.

```
META_APP_SECRET
STATUS = SECRET_PRESENT   (GitHub Actions secret `META_APP_SECRET`, and
                           `META_WEBHOOK_APP_SECRET` as a legacy alias)
VALUE  = NEVER WRITE SECRET HERE
```

```
WEBHOOK_CALLBACK_URL = https://api.easymod.tech/webhooks/meta
STATUS               = FOUND
```
Confirmed from two sides: the Meta app's `page` subscription reports a callback
on `https://api.easymod.tech/...`, and `Caddyfile` rewrites the public
`/webhooks/meta` to the backend's `/api/webhooks/meta` mount in `src/app.js`.

```
WEBHOOK_VERIFY_TOKEN
STATUS = SECRET_PRESENT   (GitHub Actions secret `META_WEBHOOK_VERIFY_TOKEN`)
VALUE  = NEVER WRITE SECRET HERE
```

```
WEBHOOK_FIELDS = messages
STATUS         = FOUND — subscription active
```
The live app subscription is `topic=page`, `fields=["messages"]`, `enabled=true`,
which matches `MetaMessengerProvider.webhookFields()` exactly. **No change
required.**

---

## 3. Permissions

The launch scope is three scopes, sourced from `DEFAULT_SCOPES` in
`src/modules/channel-providers/providers/MetaMessengerProvider.js` and locked by
a contract test.

| PERMISSION | REQUIRED_BY_CODE | CURRENT_STATUS | ACTION_REQUIRED |
| --- | --- | --- | --- |
| `pages_show_list` | YES — `buildAuthUrl` DEFAULT_SCOPES; `listManagedAssets` reads `/me/accounts` | Not in App Review privileges (app is in dev mode) | None for testing. Advanced Access is a launch/App-Review task, not an E2E task. |
| `pages_messaging` | YES — `sendMessage` → `/me/messages`; granular-scope target IDs gate which Pages are connectable | Same | None for testing |
| `pages_manage_metadata` | YES — `subscribeWebhook` / `verifyWebhookSubscription` on `/{page}/subscribed_apps` | Same | None for testing |

App Review currently grants only `openid`, `public_profile`, `email`
(`DEVOPS_APPROVED`, standard access). **While the app is in development mode
Meta grants the three Page scopes to people who hold a role on the app**, which
is exactly why §10 asks for the tester accounts to be App Testers rather than
asking for Advanced Access.

No other permission is required by the Messenger path. `business_management` was
deliberately removed — `listManagedAssets` uses only `/me/accounts` — and must
not be re-added for testing.

**Do not change app permissions to make this test pass.**

---

## 4. Page token

```
PAGE_ACCESS_TOKEN
STATUS = STORED_ENCRYPTED_IN_EASYMODERATOR_CHANNEL
STATE  = PRESENT_AND_DECRYPTABLE
         (verified 2026-08-10 by loading channel 77091ba8-… through the entity's
          own AES-256-GCM getter and asserting only that it returned a value —
          no token, prefix or ciphertext was printed, logged or written)
```

- **Token source** — EasyModerator's normal Facebook connection flow:
  `exchangeCode` → long-lived user token → `getAssetAccessToken` per Page.
- **Storage location (conceptually)** — the `page_access_token_ct` column on the
  channel record. The entity's getter/setter encrypt and decrypt transparently
  (AES-256-GCM, versioned `v2:` prefix, key `CHANNEL_ENCRYPTION_KEY`). Nothing
  in this test system reads the plaintext; the live runner reports only
  `present` / `MISSING`.
- **Refresh/reconnect** — required only if the live runner reports
  `Page token: MISSING`, which also covers "stored but undecryptable". Fix by
  reconnecting the Page through the normal EasyModerator flow. There is a
  scheduled `meta-token-refresh.job` for ordinary rotation.

No new plaintext token configuration is introduced. The automated suite stores
its own throwaway string through the same encrypting setter, so the encryption
path is exercised rather than bypassed.

---

## 5. Customer PSID

```
CUSTOMER_PSID = FOUND_AT_RUNTIME     (deliberately not written to this file)
STATUS        = FOUND_FROM_REAL_INBOUND_MESSAGE
CUSTOMER_NAME = EasyModerator Tester
CUSTOMER_ID   = 9cd4521d-f954-4feb-9b5a-56a5f38ff309
CONVERSATION  = 750ef7eb-cd64-410b-83c8-066ff4e5518c   (21 messages)
SOURCE        = meta_webhook_receipts → entry[].messaging[].sender.id,
                11 receipts, all PROCESSED, page_id 1213925798474895
```

The PSID is page-scoped, and this deployment demonstrates it: the *same human*
also has a customer row (`eb903a0b-…`) with a **different** `channel_user_id`
against the shop's older, now-DISCONNECTED Page. Resolving the tester by shop
alone would pick the wrong one; the runner scopes by `meta_channel_id`.

How it is learned, and the only way it may be learned:

```
tester customer account
  → Messenger DM to the tester Page
  → Meta delivers the webhook
  → entry[].messaging[].sender.id            (the PSID)
  → customers.channel_user_id (channel_type = 'messenger', scoped to the shop)
  → conversations.customer_id
```

`npm run test:meta:live` reports only the last four characters of the PSID it
resolved. It is a **Page-scoped ID**: it is not the tester's Facebook account ID,
it differs per Page, and it cannot be used to look the person up.

Not recorded in this document: PSIDs are customer identifiers, and this file is
committed to Git. `FOUND_AT_RUNTIME` above is the value, deliberately.

---

## 6. Known catalog fixtures

### Automated suite (FOUND — created per run, nothing to supply)

```
KNOWN_PRODUCT_ID     = cccccccc-0000-4000-8000-00000000000c
KNOWN_PRODUCT_NAME   = EM E2E Black Panjabi
EXPECTED_PRICE       = 1847
EXPECTED_MATERIAL    = Cotton
EXPECTED_IMAGE       = https://cdn.easymod.tech/e2e/em-e2e-black-panjabi.jpg

UNKNOWN_ATTRIBUTE_PRODUCT_ID   = dddddddd-0000-4000-8000-00000000000d
UNKNOWN_ATTRIBUTE_PRODUCT_NAME = EM E2E Blue Shirt
EXPECTED_MATERIAL              = UNKNOWN

NO_IMAGE_PRODUCT_ID   = eeeeeeee-0000-4000-8000-00000000000e
NO_IMAGE_PRODUCT_NAME = EM E2E Green Kurti

NONEXISTENT_PRODUCT_QUERY = chiffon saree ache?
```

Two supporting fixtures make the negative cases mean something:

- `EM E2E Cotton Saree` (`ffffffff-…`) — a real saree, so "chiffon saree" is a
  *partial* match that produces `relatedProducts`, not an empty catalog.
- `EM E2E Chiffon Kurti` (`77777777-…`, price 1390) — the §5 case: the product
  **name** says chiffon while the structured `ai_material` column is empty, so
  the reply must admit the material is not recorded rather than assert it.
- `EM E2E Tote Bag` (`99999999-…`) — Shop B's own product, so the cross-shop
  test cannot pass merely because Shop B's catalog is empty.

These exist only inside the disposable E2E database. They cannot reach a
merchant shop.

### Live shop (FOUND — nothing to create)

```
STATUS            = READY_FOR_POSITIVE_E2E
PRODUCT_ID        = 65f0d40d-ddc2-49fa-9669-435e3993dc92
PRODUCT_NAME      = Premium Black Panjabi
SKU               = PRD-VDJC78A
PRODUCT_STATUS    = is_active=true · deleted_at=NULL · in_stock=true
AI_VISIBLE        = ai_processed_at 2026-08-08T02:01:09Z
PRICE             = 2500.00        (authoritative — assertions read this column)
CATEGORY          = Men
COLOR             = black          (ai_color_primary — the KNOWN attribute)
MATERIAL          = NULL           (ai_material — the UNKNOWN attribute)
VARIANTS          = Size: S, M, L, XL
MEDIA_STATUS      = FOUND
MEDIA_COUNT       = 1              (image_url == images[0], same shop-scoped path)
IMAGE             = /uploads/product-images/458b6a78-…/1786154286653-….jpg
                    served 200 image/jpeg (180 KB) from api.easymod.tech
QUANTITY          = 0 with track_quantity=false → in_stock is the authoritative
                    stock fact; the quantity column is not being tracked
```

The live runner discovers this product itself — it is the only active product in
this shop that owns an image — and derives every expected value from the row, so
nothing here is a hard-coded fixture. `META_E2E_KNOWN_PRODUCT_ID` /
`META_E2E_KNOWN_PRODUCT_NAME` pin it explicitly if the catalog grows.

`ai_material IS NULL` is not a defect for this test, it is the point: it gives
the live run a genuine unknown attribute, so META-LIVE-005 can prove the reply
refuses to invent a fabric.

### Live negative fixture

```
META_E2E_NONEXISTENT_QUERY = chiffon saree ache?
STATUS                     = VERIFIED_NOT_PRESENT
```
Checked against the same columns retrieval reads — `name`, `name_bn`, `category`,
`brand`, `description`, `ai_material`, `ai_color_primary`, `ai_category`,
`ai_search_text`, `tags`, `aliases`, `variants`, `ai_tags` — for `chiffon`,
`saree`, `shari` and `শাড়`: **0 matches**. The runner re-verifies this at the
start of every run and refuses to continue if the query has become answerable.

---

## 7. Knowledge fixtures

### Automated suite (FOUND)

```
KNOWN_FAQ_ID           = <serial, resolved at runtime — faq_responses.id>
KNOWN_FAQ_QUERY        = delivery charge
KNOWN_FAQ_EXPECTED_FACT= 60 taka inside Dhaka / 120 taka outside Dhaka

UNKNOWN_POLICY_QUERY   = return policy ki?
```

The FAQ row is created per run in the test shop. The query is worded so every
token hits the FAQ (score 1.0), which clears the shop's 75% confidence
threshold; a partial match is correctly *held for a human*, which is a different
assertion.

Vector/RAG knowledge is not seeded: with no Qdrant in CI the vector tier
degrades to empty, exactly as it does in production when Qdrant is down. The
keyword-FAQ tier is exercised against real PostgreSQL.

---

## 8. CI configuration

### SAFE_CONFIG

The automated suite needs **only infrastructure coordinates**. Everything else
has a test-only default in `tests/meta-e2e/env.js`.

| Variable | Value in CI | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://e2e:e2e@127.0.0.1:5432/easymod_e2e` | disposable database; the suite **refuses to run** unless the database name contains `e2e` or `test` |
| `REDIS_URL` | `redis://127.0.0.1:6379` | real BullMQ + dedup + burst state |

Test-only defaults the suite sets for itself (not secrets, not CI inputs):
`META_APP_SECRET` (isolated integration-test value used to sign its own
payloads), `META_WEBHOOK_VERIFY_TOKEN`, `CHANNEL_ENCRYPTION_KEY`,
`GEMINI_API_KEY` / `OPENAI_API_KEY` (placeholders — the transport is captured),
`AI_BURST_WINDOW_MS=0`, `INTENT_CACHE_TTL_SECONDS=0`,
`GEMINI_CACHE_MIN_CHARS`, `BERT_SERVICE_URL`.

### Live runner

Only the two store URLs are required, and both are already in the deployment's
environment. Everything else is discovered; the overrides exist to pin a run.

| Variable | Status | Purpose |
| --- | --- | --- |
| `DATABASE_URL`, `REDIS_URL` | FOUND on the deployment | the runner reads EasyModerator's own records |
| `META_E2E_PAGE_ID` | optional override | pin the Page; otherwise the only CONNECTED facebook channel |
| `META_E2E_SHOP_ID` / `_SHOP_NAME` / `_MERCHANT_EMAIL` | optional override | pin the shop; otherwise the only active shop |
| `META_E2E_KNOWN_PRODUCT_ID` / `_KNOWN_PRODUCT_NAME` | optional override | pin the positive fixture; otherwise the only active product with an image |
| `META_E2E_CUSTOMER_PSID` | optional override | pin the tester conversation; otherwise the only one with inbound history on this channel |
| `META_E2E_NONEXISTENT_QUERY` | optional | defaults to `chiffon saree ache?`, re-verified against the catalog each run |
| `META_E2E_TIMEOUT_SECONDS` | optional | per-step wait for a human + Meta, default 600 |
| `META_E2E_RUN_ID` | optional | re-attach to an interrupted run |

### SECRET_CONFIG

No new secret is required by either layer. Existing secrets are used only by the
already-deployed application:

| SECRET_NAME | STATUS | PURPOSE |
| --- | --- | --- |
| `META_APP_SECRET` | PRESENT | webhook HMAC + `appsecret_proof` (production) |
| `META_WEBHOOK_APP_SECRET` | PRESENT | legacy alias of the above |
| `META_WEBHOOK_VERIFY_TOKEN` | PRESENT | Meta webhook GET handshake |
| `CHANNEL_ENCRYPTION_KEY` | PRESENT | Page-token encryption at rest |
| `VITE_META_APP_ID` | PRESENT | Meta App ID (public value) |

---

## 9. GitHub Secrets

Inspected with `gh secret list --repo mr3826/easymod-backend` (names only —
values are never readable through the API and are never printed here).

```
SECRET_NAME = META_APP_SECRET               STATUS = PRESENT   PURPOSE = webhook signature + appsecret_proof
SECRET_NAME = META_WEBHOOK_APP_SECRET       STATUS = PRESENT   PURPOSE = legacy alias, read as a fallback by config
SECRET_NAME = META_WEBHOOK_VERIFY_TOKEN     STATUS = PRESENT   PURPOSE = webhook verification handshake
SECRET_NAME = CHANNEL_ENCRYPTION_KEY        STATUS = PRESENT   PURPOSE = Page access token encryption
SECRET_NAME = VITE_META_APP_ID              STATUS = PRESENT   PURPOSE = Meta App ID for OAuth + backend config
SECRET_NAME = DATABASE_URL / REDIS_URL      STATUS = PRESENT   PURPOSE = production stores (NOT used by CI E2E)
```

**No new test-only secret is needed, and none was created.** The automated suite
signs its payloads with an isolated value it generates for itself, so the real
App Secret never has to leave production. Do not add a `META_E2E_*` secret; the
live runner needs IDs, not credentials.

---

## 10. Manual founder actions

### A. Send the messages the runner prints (per live run) — the only one left

```
ACTION                 From the tester CUSTOMER account ("EasyModerator Tester"), send each
                       message the runner prints, in order, to the "Easy Style Fashion" Page.
                       Wait for each reply before sending the next. No key presses on the
                       runner side — it follows the real webhook.
WHY_REQUIRED           Meta exposes no supported server-side way to send AS a customer.
                       Automating it would mean browser automation or unofficial APIs against
                       facebook.com, which is explicitly out of scope.
EXACT_UI_LOCATION      messenger.com (or the Messenger app) → Easy Style Fashion
VALUE_TO_RETURN        Nothing — the runner detects and validates everything after this.
```

### Already done — kept for the record, do not repeat

| Was | Status | Evidence |
| --- | --- | --- |
| Connect the tester Page through EasyModerator's OAuth flow | DONE | `meta_channels` `77091ba8-…` CONNECTED 2026-08-08, token encrypted at rest |
| Both tester accounts as accepted App Testers | DONE | 11 `meta_webhook_receipts`, all PROCESSED — a dev-mode app only delivers for people holding a role |
| A real customer message, so the PSID exists | DONE | conversation `750ef7eb-…`, 21 messages, latest inbound 2026-08-09 |
| A live catalog fixture with an image | DONE | `Premium Black Panjabi` — §6 |
| Deployed-store access for the runner | DONE | it runs inside the backend container, where both URLs already resolve |

Nothing here asks for a Facebook password, a cookie, a session or a 2FA code,
and nothing ever will.

---

## 11. Live test procedure

```bash
# 1. Confirm the deployment is running the build you want to test
curl -s https://api.easymod.tech/health | head -c 200

# 2. Run the live harness where the deployed stores are reachable.
#    No arguments: it discovers the shop, Page, channel, tester conversation
#    and product itself, and refuses to guess if any of them is ambiguous.
ssh root@$DEPLOY_HOST
cd /opt/easymod
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T backend \
  npm run test:meta:live
```

3. The runner prints what it discovered, then the full ordered list of messages.
4. Send them from the tester **customer** account, one at a time, waiting for
   each reply. Nothing to press on the runner side.
5. Everything after each send is validated automatically, against
   EasyModerator's own records — never against model phrasing alone. The run
   ends with `FINAL: PASS` or `FINAL: FAIL` plus a `RESULT_JSON` line.

Scenarios, in the order they run:

| Step | Message | What must hold |
| --- | --- | --- |
| A · 001 | `chiffon saree ache?` | `NOT_FOUND`, no verified product, no attachment, no price, no URL |
| B · 002.1–4 | `picture den` → `try koren` → `abar check koren` → `are you sure?` | nothing becomes true under pressure: still no verified product, no attachment, no price, no URL |
| C · 003 | `Premium Black Panjabi ache? dam koto?` | `SEND` + `VERIFIED`, verified id == the discovered product, reply states the catalog price |
| C · 004 | `Premium Black Panjabi er color ki?` | states the recorded colour |
| C · 005 | `Premium Black Panjabi er material ki?` | asserts **no** fabric — `ai_material` is NULL |
| C · 006 | `Premium Black Panjabi er picture den` | one attachment, and it is that product's own stored URL; `media_product_id` == the product |

Every turn additionally asserts: grounding recorded on the row, a single
outbound (no duplicate send), clean attachment provenance, and
`delivered = true` with Meta's `mid`. The run finishes by checking the DLQ for
that conversation.

The runner only ever prints the last four characters of the PSID, and never
reads a token.

---

## 12. Pass criteria

| Criterion | Automated (CI) | Live Meta |
| --- | --- | --- |
| `REAL_META_WEBHOOK` | Meta-shaped + HMAC-signed, real route | PASS — real Meta delivery |
| `QUEUE` | PASS — real Redis/BullMQ job asserted | PASS — reply implies the job ran |
| `WORKER` | PASS — real `processMessageJob` | PASS |
| `PRODUCT_GROUNDING` | PASS — `grounding_product_status` asserted per turn | PASS |
| `AI_GROUNDING` | PASS — decision/reasonCode/violations asserted | PASS |
| `ATTACHMENT_PROVENANCE` | PASS — 5 substitution vectors + object-level filter | PASS |
| `META_OUTBOUND` | PASS — captured Graph Send bodies | PASS — `delivered = true` + Meta's `mid` on the row |
| `PERSISTED_METADATA` | PASS — `grounding_*` + `source_references` on the row | PASS |
| `NO_DUPLICATE_SEND` | implicit (send bodies counted) | PASS — ≤1 delivered AI row per turn |
| `DLQ` | n/a (no worker retry loop in-suite) | PASS — no dead-lettered job for the conversation |

A run is PASS only when every applicable row is PASS.

The full decision is on the row, not only in the log: `grounding_decision`,
`grounding_reason`, `grounding_product_status`, `grounding_media_status`,
`grounding_media_product_id`, `grounding_verified_product_ids`,
`grounding_knowledge_ids`, `grounding_violations`, `grounding_provider`,
`grounding_attachment_urls`, `provider_message_id`, plus `source_references`.
The live runner asserts against those, so a certification does not depend on a
container log that rotates.

### The suite was verified against deliberate regressions

Four mutations were applied to production code, the suite was run, and the code
was restored:

| Mutation | Caught by |
| --- | --- |
| Attachment provenance filter accepts any URL | META-E2E-009 (1 test) |
| `shop_id` scoping removed from the catalog search | META-E2E-006 (1 test) |
| Unsupported price claims no longer validated | META-E2E-002, 003, 007, 008 ×2, 010 (6 tests) |
| `NOT_FOUND` collapsed back into `NONE` — **the original incident's defect** | META-E2E-001 ×2, 002, 006, 007 (5 tests) |

With production code restored: **31 passed, 31 total**.

---

## 13. Security constraints

**NEVER STORE:**
- Facebook passwords
- browser cookies
- customer sessions
- 2FA codes
- access tokens in docs
- secrets in Git
- secrets in logs

**NO BROWSER AUTOMATION AGAINST FACEBOOK.** No Selenium, no Playwright, no
session replay, no unofficial API, and no attempt to bypass Meta anti-automation
systems. The only human-driven step is a person typing a message in Messenger.

How the implementation holds to this:

- The automated suite signs its own payloads with an **isolated** test App
  Secret; the production secret is never needed outside production.
- The live runner never calls Meta. It reads EasyModerator's own PostgreSQL and
  Redis and reports the Page token only as `present` / `MISSING`.
- The suite refuses to start unless `DATABASE_URL` names a database containing
  `e2e` or `test`, so it cannot truncate a merchant catalog.
- No PSID is recorded in this file.
- Grounding logs already exclude message bodies, tokens and PII
  (AI_TRUST_BOUNDARY §11); this test system adds no new log sink.

---

## 14. Findings surfaced while building this

Recorded here because they are real behaviour of the current system, discovered
by running the pipeline end to end.

1. **`MemoryCache` threw on every expired read.** `get()` and `exists()` cleared
   a `this.ttls` map that does not exist, so the first read of an aged-out key
   raised `Cannot read properties of undefined (reading 'delete')`. The intent
   router's response cache calls `get()` on the hot path, so once an entry aged
   out, the next customer message with that exact text took down `route()` and
   fell through to the generic keyword responder. **Fixed** in this branch
   (`src/config/memory-cache.js`), with a regression test.

2. **Attribute follow-ups cannot reach their documented path from Messenger.**
   `AI_TRUST_BOUNDARY §4` says "eta chiffon?" is resolved against products the
   conversation already grounded, carried on the previous AI message's
   `source_references`. `message-worker.loadConversationHistory` builds history
   as `{role, content, message}` only, so `contextProductIds(history)` always
   returns `[]` and the turn degrades to the honest "which product do you mean?"
   reply. **The trust invariant still holds** — nothing is invented — but the
   contextual-attribute feature is unreachable on this path. Not changed here
   (out of scope for a testing branch); META-E2E-004 asserts the current
   behaviour so a future fix is a deliberate decision rather than a drift.

3. **`order_sessions` is not created by `sequelize.sync()`.** It comes from the
   migration chain. The production WIPE path runs `db:sync` and then marks
   migrations as already-executed, so a freshly wiped database would not have
   it and `handleOrderFlow` would fail on every turn. The E2E harness therefore
   runs the migrations before `sync()`. Worth confirming against production
   before the next WIPE deploy.

4. **Conversation usage metering fails on every new conversation.**
   `subscriptionService.trackUsage(shopId, 'conversations', 1, "conv:<uuid>")`
   passes the idempotency key into a UUID column:
   `invalid input syntax for type uuid: "conv:<uuid>"`. It is caught and logged
   as non-fatal, so no message is lost — but conversation usage is not being
   metered. Not changed here.

5. **The gate cannot contradict a claim when `productStatus` is `NONE`.** A bare
   availability assertion carrying no price, URL or attachment (e.g. "yes, we
   have it") passes, because there is no product entity in the turn to check it
   against. Every incident-shaped vector — price, URL, photo, attachment — is
   blocked, which is what META-E2E-002 asserts. Flagged as a residual risk
   rather than silently assumed away.
