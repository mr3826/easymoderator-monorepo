# 02 — Meta Scope and Permission Audit (Workstream A)

**Verdict for this workstream: PASS.** No scope drift found on any executable launch path.

## Permission surface — proven

Single source of truth, `EasyMod-backend/src/modules/channel-providers/providers/MetaMessengerProvider.js:27-31`:

```js
const DEFAULT_SCOPES = [
    'pages_show_list',
    'pages_messaging',
    'pages_manage_metadata'
];
```

| Expected | Actual | Status |
|---|---|---|
| `pages_show_list` | present | PASS |
| `pages_messaging` | present | PASS |
| `pages_manage_metadata` | present | PASS |
| *(nothing else)* | nothing else | PASS |

### Every path that could widen it — checked

| Vector | Finding | Receipt |
|---|---|---|
| Backend OAuth initiation | `buildAuthUrl({ state, scopes: [] })` — empty array, so `DEFAULT_SCOPES` is used | `meta-oauth.service.js:51` |
| `buildAuthUrl` fallback | `(scopes && scopes.length ? scopes : DEFAULT_SCOPES)` — empty array falls through to the constant | `MetaMessengerProvider.js:90` |
| Separate reconnect / reauth flow | none exists; reconnect re-enters the same `buildAuthUrl` | grep `buildAuthUrl` → 1 definition, 1 caller |
| Environment override | **none** — no `META_SCOPES` / `META_PERMISSIONS` variable exists anywhere | repo-wide grep, incl. `.env.prod.example`, workflows |
| Frontend connection flow | no `FB.login`, no client-side scope string; frontend only links to the backend-built URL | repo-wide grep for `FB.login` → 0 hits |
| Legacy permission constants | none outside tests | grep for `business_management`, `instagram_*`, `pages_read_engagement` |
| Post-auth Graph calls | `/me/accounts` only for discovery; Business Portfolio edges deliberately not queried | `MetaMessengerProvider.js:163-165` |

The only non-test references to removed permissions in the entire source tree are the
comment at `MetaMessengerProvider.js:164` explaining *why* `business_management` was
removed, and negative assertions in tests
(`meta-oauth.service.test.js:74-76`, `MetaMessengerProvider.test.js:65-69`).

`GRANULAR_PAGE_SCOPES` (`MetaMessengerProvider.js:37-40`) contains only `pages_messaging`
and `pages_manage_metadata` — used to intersect `debug_token` granular results, not to
request anything.

## Webhook field surface — proven

`MetaMessengerProvider.js:33-35`:

```js
const WEBHOOK_FIELDS = [
    'messages'
];
```

Subscription is written at `MetaMessengerProvider.js:333-338` via
`POST /{page-id}/subscribed_apps` with `subscribed_fields: this.webhookFields().join(',')`.

The one place a different value could enter is the controller fallback at
`meta-channel.controller.js:327-329`:

```js
const requiredFields = typeof provider.webhookFields === 'function'
    ? provider.webhookFields()
    : ['messages'];
```

Both branches yield `['messages']`. **No drift.**

| Field | Subscribed? | Classification |
|---|---|---|
| `messages` | **yes** | in scope |
| `feed` | no | explicitly ignored in the normalizer — `MetaMessengerProvider.js:429` "Page feed/comment changes are intentionally ignored for launch" |
| comments / mentions | no | no code path |
| messaging postbacks | no | non-message events skipped (`meta-webhook-events.handler.js:480-483`) |
| message reactions | no | same skip path |
| standby / referral | no | no code path |
| Instagram fields | no | no provider exists |
| `messaging_optins` | **handled if delivered** | see note below |

### Note on `messaging_optins`

`meta-webhook-events.handler.js:470-473` handles `messaging.optin` events, and the
entity comment at `meta-channel.entity.js:121` gives `["messages","messaging_optins"]`
as an example value. **The app never subscribes to `messaging_optins`** — `WEBHOOK_FIELDS`
is `['messages']` — so this handler is unreachable in production. It is dormant
receive-side code, not a subscription. Classified **INFO**; the entity comment is
misleading and should be corrected to avoid a reviewer or engineer inferring a wider
subscription.

## Removed-channel reachability — proven unreachable

| Capability | Can a launch user reach it? | Proof |
|---|---|---|
| Connect Instagram | **No** | `provider.registry.js` freezes `{ facebook: messenger }`; `getProvider('instagram')` throws |
| Connect WhatsApp | **No** | same; no provider file exists (`providers/` contains exactly `MetaMessengerProvider.js`) |
| Enable comment-to-DM | **No** | no route, no service; only an archived migration `archive/20260603_001_create_comment_to_dm_events.js` |
| Subscribe Page `feed` | **No** | `WEBHOOK_FIELDS` is `['messages']`; no code path writes another value |
| Trigger an Instagram provider | **No** | registry has one key |
| Reach legacy channel UI via hidden route | **No** | no Instagram/WhatsApp component or route in the frontend |
| Activate removed behaviour via direct API | **No** | Sequelize model enum is `DataTypes.ENUM('facebook')` (`meta-channel.entity.js:36`) — a crafted `platform: 'instagram'` is rejected at the model layer before reaching the DB |
| See unsupported channels in public copy | **No** | see `15_PUBLIC_COPY_AND_MARKET_CLAIMS.md` |

### Dormant DB enum — acceptable

The PostgreSQL enum still permits `'instagram'` (legacy), and
`20260624_001_disconnect_instagram_channels.js` disconnected existing rows. The brief
allows dormant enum values **only if** no executable path can connect, subscribe,
ingest, process, display, or advertise the capability. All seven checks above are
negative, and the application-layer Sequelize enum is narrower than the DB enum.
**DEFERRED_WITH_JUSTIFICATION** — tightening the DB enum is a post-launch cleanup, not a
blocker.

## Findings from this workstream

| ID | Sev | Finding |
|---|---|---|
| F-30 | INFO | `meta-channel.entity.js:121` comment implies a `messaging_optins` subscription that is never made |
| F-27 | P3 | `conversation/ai-chatbot.controller.js` remains in the tree though `/api/ai-chatbot/*` is unmounted — dead code |
| F-26 | P3 | Dead `MESSAGE_TAG` branch in `MetaMessengerProvider.js:471-473` (see `05_`) |
