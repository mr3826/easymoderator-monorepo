# 05 — Messenger Policy Compliance (Workstream D)

**Verdict for this workstream: PASS on policy enforcement; two P2 race/observability defects.**

## Deprecated message tags — genuinely dead

| Required absent | Status | Proof |
|---|---|---|
| `POST_PURCHASE_UPDATE` | **absent** from all live code | only occurrences: an archived migration and two policy test fixtures |
| `ACCOUNT_UPDATE` | **absent** | archived migration only |
| `CONFIRMED_EVENT_UPDATE` | **absent** | archived migration only |
| `HUMAN_AGENT` | **absent** | archived migration only |
| Any out-of-window marketing send | **blocked** | see below |

`policy/rules/templateRequired.rule.js`:

```js
const ALLOWED_TAGS = new Set();   // empty

async evaluate(_message, ctx) {
    const augment = ctx.runningAugment || {};
    const withinWindow = augment.within_window !== false ? true : false;
    if (withinWindow) return { allow: true, reason: 'WITHIN_WINDOW' };
    return { allow: false, reason: 'OUTSIDE_24H_TEMPLATES_DISABLED' };
}
```

`ALLOWED_TAGS` is empty and **no rule in the pipeline ever sets `augment.message_tag`**.
The `MESSAGE_TAG` branch in `MetaMessengerProvider.js:471-473` is therefore unreachable
dead code (finding **F-14**, P3 — remove it so a future change cannot silently revive
tagged sending).

Outside the 24-hour window every send is hard-denied. This is stricter than Meta requires
and is the correct posture pre-approval.

## The 24-hour window

`policy/rules/twentyFourHourWindow.rule.js:17` — `const WINDOW_MS = 24 * 60 * 60 * 1000;`

Returns `within_window: true|false` as an augment; `templateRequired` consumes it and
denies. `NO_INBOUND` (no prior customer message) yields `within_window: false` → deny.
Correct.

## Every outbound path passes the same gate

The pipeline (`policy.rules.js`), in order:

1. `consentRequired` — hard-deny without per-channel consent
2. `messengerOptedOut` — hard-deny on legacy global opt-out
3. `twentyFourHourWindow` — sets `within_window`
4. `templateRequired` — hard-deny outside window
5. `contentSanitizer` — transform only
6. `businessHours` — soft-deny → SUGGEST_ONLY
7. `rateLimit` — soft-deny at 170/hr
8. `draftMode` — soft-deny in DRAFT / AI_SUGGEST_ONLY / MANUAL

The engine short-circuits on the first deny and **always** writes a `policy_decisions` row,
allow or deny (`policy.engine.js:29`).

| Outbound path | Goes through `evaluateOutbound`? | Receipt |
|---|---|---|
| AI-generated reply | yes | `message-worker.js` |
| **Merchant manual reply** | **yes** | `conversation.controller.js:239` |
| Template reply | yes | same controller path |
| Human-handoff message | yes | `human-handoff.service.js` |
| Retry send | yes | retries re-enter the worker |
| **Attachment reply** | **yes** | attachments are part of `normalizedMessage`, evaluated before send |
| Order-status message | yes | worker path |
| Background-job send | yes | worker path |
| Error-recovery send | yes | worker path |

### Bypass is structurally prevented

`MetaMessengerProvider.sendMessage` refuses to run without an allowing decision
(`MetaMessengerProvider.js:435-437`):

```js
if (!decision || decision.allow !== true) {
    throw new Error('sendMessage: PolicyDecision missing or denied');
}
```

This is defence in depth: even a future caller that forgets the policy engine cannot
send. **Manual sends, retries, and attachment sends cannot bypass the policy engine.**

### Blocked sends are surfaced honestly

`conversation.controller.js:240-243` sets `failureReason = 'Message blocked by policy: …'`,
and the `finally` block persists `delivery_status: 'failed'` with the reason and emits an
SSE `delivery_failed`. **The UI does not imply a blocked send succeeded.**

## Timing behaviour — actual configured values

The brief asked for the real values, not the assumed ones.

| Behaviour | Brief's expectation | **Actual implemented value** | Source |
|---|---|---|---|
| Inbound message coalescing | ~10s | **8,000 ms** (`AI_BURST_WINDOW_MS`, default 8s) | `jobs/burst-coalescer.js:35` |
| Coalescing hard cap | — | **20,000 ms** (`AI_BURST_MAX_WAIT_MS`) | `jobs/burst-coalescer.js:36` |
| Human-reply AI suppression | ~30 min | **1,800 s = 30 min** (`AI_PAUSE_TTL_SECS`) | `conversation.controller.js:15` |

The suppression window matches the stated requirement exactly. **The coalescing window is
8 seconds, not 10.** Both are environment-overridable. If 10s is the product requirement,
either the default or the requirement needs to change — flagged as **F-29 (P3)**, a
documentation/config mismatch, not a defect.

## Race conditions between customer message, pending AI reply, and manual reply

The worker checks guards in order at job-execution time, not enqueue time
(`message-worker.js:296-310`):

```
Guard 1  Redis idempotency        msg:dedup:{shopId}:{externalId}
Guard 2  HITL                     conversation.hitl → skip
Guard 3  AI pause (30-min mute)   ai:pause:{conversationId} → skip
Guard 4  Automation mode          MANUAL / DRAFT → skip
```

Because Guard 3 is evaluated when the burst-flush job actually runs, a pending AI reply
scheduled *before* the merchant replied is still suppressed *after* they reply. **The core
requirement — a pending AI reply cannot be sent after a merchant has already answered — is
met in the normal case.**

### F-12 (P2) — the suppression write is fire-and-forget and swallows errors

`conversation.controller.js:425`:

```js
cacheRedis.setex(`ai:pause:${conversationId}`, AI_PAUSE_TTL_SECS, '1').catch(() => {});
```

Two consequences:

1. **Not awaited.** A burst-flush firing in the same instant can read `ai:pause` before
   the write lands and send an AI reply on top of the merchant's. The window is small but
   real, and 8s coalescing makes concurrent flush-vs-reply plausible in an active chat.
2. **Errors are discarded.** If Redis rejects the write, suppression silently does not
   apply for the full 30 minutes — the AI keeps auto-replying over a human agent with no
   log, no alert, and no UI indication.

**Remediation:** `await` the `setex` before responding, and on failure either fail the
request or set `conversation.hitl` as a durable fallback (Guard 2 is DB-backed and would
then cover it).

**Not verified at runtime.** Reproducing this race needs a live Redis, a live worker, and
concurrent traffic — unavailable here. Reported as a source-verified defect, not a
runtime-confirmed one.

### F-13 (P2) — delivery result is fire-and-forget

`deliverViaMetaIfApplicable(...)` is called without `await` (line 427) and the HTTP `201`
returns immediately, so the agent sees "sent" before delivery is attempted. Failure does
reach the DB (`delivery_status: 'failed'`) and an SSE event, so it is **not** a silent
failure — but both `updateDeliveryStatus(...)` calls end in `.catch(() => {})`, so if the
status write itself fails the message is left looking sent.
