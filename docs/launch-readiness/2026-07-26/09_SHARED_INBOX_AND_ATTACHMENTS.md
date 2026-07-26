# 09 — Shared Inbox and Attachments (Workstream H)

**Verdict for this workstream: BLOCKED for the round-trip; PASS on the security controls.**

The 22-point round-trip in the brief requires a live Meta tester Page and a real customer
account. **No message round-trip was performed.** Launch gate 9 ("Shared Inbox attachment
round-trip passes") therefore remains **unverified**.

## Round-trip matrix

| # | Check | Status |
|---|---|---|
| 1-4 | Customer text → merchant → reply → customer receives | **BLOCKED** (no tester Page) |
| 5-8 | Image both directions | **BLOCKED** |
| 9-12 | PDF / file both directions | **BLOCKED** |
| 13 | Refresh does not lose messages | PASS (source) — messages are DB-persisted, SSE is additive |
| 14 | Duplicate webhook ≠ duplicate message | **PASS** — `external_id UNIQUE` + Redis dedup |
| 15 | Failed send shows an honest error | **PASS** — `delivery_status: 'failed'` + `delivery_failed` SSE with reason |
| 16 | Retry produces one fresh outbound send | PASS (source) |
| 17 | Attachment metadata correct | PASS (source) |
| 18 | **Public attachment URL uses HTTPS** | **PASS** — verified: Caddy serves `/uploads/*` over TLS on the apex |
| 19 | Upload volume persists across restart | PASS (source) — named volume in `docker-compose.prod.yml`; **not restart-tested** |
| 20 | Unsupported file type rejected | **PASS** — MIME allowlist + magic-byte validation |
| 21 | Oversized file rejected | **PASS** — byte caps; `BODY_SIZE_LIMIT=35mb` |
| 22 | Another shop cannot access private attachment metadata | **PASS** — `shop_id` bound from the token |
| 23 | Non-connected Page cannot inject messages | **PASS** — signature check + `status: 'CONNECTED'` resolution |

## Attachment security — strong

`utils/safe-media-fetch.js`, exercised by `safe-media-fetch.test.js` (passing):

- DNS pinning (resolve once, connect to the resolved address — closes DNS-rebinding)
- Private/link-local CIDR rejection
- MIME allowlist
- Byte caps
- **Magic-byte signature validation** — content is checked, not just the declared type
- Strict `data:` URI decoding

`self-mfs-handler.service.js` (payment screenshot OCR) was moved onto `safeFetchMedia`,
closing what the PR describes as the last unguarded SSRF path.
`self-mfs-handler.media-security.test.js` passing.

### One residual raw-fetch path — dormant

`modules/ai/voice-processing.service.js:95-125` (`downloadMediaFromMeta`) fetches Graph
media with bare `axios`, no `safeFetchMedia`, no `appsecret_proof`, no size cap, and
`responseType: 'arraybuffer'`.

**It is unreachable.** Its only caller is `processVoiceMessage` (line 44), which is
exported but called from nowhere in the tree. The mounted `/api/voice/*` routes use
`transcribe`, which takes `audioBase64` from the request body and never touches
`downloadMediaFromMeta`.

Because the host is hardcoded to `graph.facebook.com`, the SSRF surface would be limited
even if reached. Recorded as **F-28 (P3)** — delete the dead function or route it through
`safeFetchMedia` before anything wires it up.

## F-19 (P2) — `/api/voice/transcribe` is an unmetered AI-cost vector

`voice-processing.routes.js` mounts `POST /api/voice/transcribe` behind `authenticate`
only. The controller (`voice-processing.controller.js:22-47`):

- accepts arbitrary `audioBase64` with **no size limit** beyond the global body limit (35 MB),
- does **not** scope anything to `req.user.shopId` — `messageId` is echoed back, never
  looked up,
- calls Gemini transcription directly on every request.

Any authenticated user can burn AI spend at will, and there is no per-shop metering on
this path. No tenant data leaks (nothing is read from the DB), so this is a **cost/abuse**
issue, not an isolation issue.

**Also check whether voice is in launch scope at all** — it is not mentioned in the
locked scope in the brief. If out of scope, unmount the router.

## Storage, retention, backup

| Item | Status |
|---|---|
| Upload volume | named Docker volume, mounted at `/app/uploads` |
| Public exposure | `/uploads/*` proxied by Caddy over HTTPS; filenames generated server-side, no user-controlled directory paths (`app.js:232-234`) |
| Included in backup | **yes** — `backup.yml` tars `/app/uploads` alongside the DB dump |
| Off-site | **no** — see `13_BACKUP_RESTORE_AND_DR.md` |
| Retention | 7 days for backups; no documented retention policy for the uploads themselves |
| Capacity monitoring | **none found** — no disk-space alert. **F-20 (P2)**: attachments accumulate on a single droplet volume with no capacity alarm. |
