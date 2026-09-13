# ADR-M-004: Additive Native Auth Endpoints (Body Tokens, Rotating Refresh, Per-Device Sessions)

Status: Accepted<br>
Date: 2026-09-13<br>
Owners: Mobile Program Orchestrator + Security

## Context

`CURRENT_STATE.md` §3 documents the blocker precisely: web `signin`/`signup`/`refresh` return
tokens only as httpOnly cookies (`auth.controller.js:22,52,54,80`); `refresh` reads its token only
from a cookie (`:71-75`); the global CSRF double-submit check applies to authenticated Bearer
requests exactly as it applies to cookie requests (`csrf-middleware.js:73-159`), and even the
narrow anonymous-auth exemption requires a trusted `Origin` header in production
(`:12-17,93-106`) — something a native HTTP client does not send the way a browser does. Refresh
tokens are stored in a single non-rotating slot per user (`auth.service.js:224,364`), so a second
concurrent login silently invalidates the first session's refresh. A `Session`/`user_sessions`
table, service, and controller already exist but are wired to nothing (`session.entity.js`, not
called from `auth.service.js`) and are reachable only via a double-mounted, effectively dead route
(`auth.routes.js:137` + `session.routes.js`'s own `/sessions` prefix). `authenticate` already
accepts `Authorization: Bearer` (`auth.middleware.js:18-19`), so the read side needs no change.

## Decision

Add a new, additive route group under `modules/auth`, gated by `MOBILE_API_ENABLED` (ADR M-010):

- `POST /api/auth/native/signin`
- `POST /api/auth/native/2fa/verify`
- `POST /api/auth/native/refresh`
- `POST /api/auth/native/logout`
- `POST /api/auth/native/switch-shop`
- `GET /api/auth/native/sessions`
- `DELETE /api/auth/native/sessions/:id`

These reuse `auth.service`'s existing password verification, lockout, TOTP, and `tokenVersion`
logic — no parallel identity model. **Do not create `MobileUser`, `MobileRole`, or
`MobileAuthService`**; the identity, shop membership, and role model stays exactly what it is
today.

Tokens are returned in the **response body**, never as cookies, and native endpoints set no
cookies of any kind:

- **Access token**: 15 minutes, carries a new `sid` (session id) claim referencing the row created
  for this device.
- **Refresh token**: rotates on every use (old token invalidated the moment a new one is issued);
  reuse of an already-rotated refresh token is treated as compromise — it revokes the entire
  session family, not just that token, and is audit-logged.
- Both are stored per device by **repairing and extending the existing (currently dead)
  `user_sessions` table** — fixing its double-mount (native routes are new paths, so this is a
  clean fix, not a behavior change to any live route) and actually populating it from the native
  signin/refresh path. Each row records device fingerprint, `sid`, current refresh-token hash,
  rotation lineage, and last-seen metadata, reusing `MAX_CONCURRENT_SESSIONS` from
  `session.service.js` as the per-user device cap.
- Refresh re-validates shop membership and `tokenVersion` on every call (a revoked/removed user
  cannot silently keep refreshing). `authenticate` gains one additive check: if a token carries a
  `sid` claim, that `sid` must not be revoked in the sessions table; tokens with no `sid` (i.e.,
  every existing web token) are unaffected — this is a pure addition to a branch that today never
  executes for web traffic.

CSRF is skipped for a request **only when all of the following hold**: the request carries
`Authorization: Bearer`, it carries **no** `access_token`/`refresh_token`/session cookies at all,
and `MOBILE_API_ENABLED=true`. A request that carries both a Bearer header and a cookie is treated
as a possible session-riding attempt and is still CSRF-checked — this exemption cannot be used to
bypass CSRF for a browser session. The native endpoints are additionally exempted from the
`isTrustedAuthOrigin` check (`csrf-middleware.js:12-17`), since they set no cookies for an
`Origin`-spoofing attack to ride on.

Client side (Phase 1): refresh token in Expo SecureStore, access token in memory only, a
single-flight refresh guard so concurrent 401s trigger one refresh call, not N.

Existing web behavior — `signin`, `signup`, cookie-based `refresh`, the single web refresh slot,
`csrf-middleware.test.js`, `auth.security.test.js` — must remain byte-for-byt behaviorally
unchanged and green. This ADR adds branches; it does not edit existing ones.

## Assumptions

- Security accepts extending `user_sessions` (currently inert) rather than introducing a new
  table, since the schema (device fingerprint, per-user cap, revocation) already matches the
  native session model's needs almost exactly.
- Fixing the `/api/auth/sessions/sessions` double-mount is in scope as part of "extending" this
  table (it is dead code with no caller today, so there is no behavior to preserve) but is called
  out explicitly to the reviewer as a pre-existing-bug fix riding inside an ADR about new
  functionality, not hidden inside it.
- No native client ever needs a session cookie; if a future requirement needs cookie+native mixed
  auth, that is a new ADR, not an extension of this exemption.

## Alternatives Rejected

- **Give native clients a cookie jar and have them send a spoofed `Origin` header.** Rejected:
  this is exactly the hack that produced the earlier native-reply rejection referenced in program
  memory. It also could not survive a future tightening of `isTrustedAuthOrigin` without silently
  breaking mobile, and it teaches the codebase that `Origin` is an unreliable signal — actively
  worse than not having native auth at all.
- **Reuse the web `signin`/`refresh` endpoints directly, adding a `client=native` body flag to
  switch their cookie behavior.** Rejected: this branches one endpoint's fundamental transport
  contract (cookie vs. body) on a client-supplied flag, which is easy to get wrong once and hard
  to reason about in every subsequent change to that endpoint. Separate endpoints keep the
  cookie-based web contract untouched by construction, not by discipline.
- **Non-rotating refresh tokens for native, matching the current single-slot web behavior.**
  Rejected: the web behavior it would match is itself a known defect (a second login silently
  kills the first session); replicating it into a brand-new code path only doubles the surface
  area of the same bug instead of fixing it where it's cheap to fix (a table with no live callers yet).

## Consequences

- Positive: native auth is fully additive — no edit to any line of `auth.controller.js`,
  `auth.service.js`'s existing exports, `csrf-middleware.js`'s existing branches, or
  `cors-options.js`. New branches only.
- Positive: multi-device login (phone + web simultaneously) becomes correct for the first time in
  the codebase, for both native and — trivially, later, if desired — web, since the underlying
  table now actually works.
- Required test (Phase 1, before this ADR is considered closed): a request carrying **both** a
  valid `Authorization: Bearer` header and a valid `access_token`/session cookie must still be
  CSRF-checked exactly as today — the exemption is defined by "no cookies present," and this
  specific hybrid case is the one most likely to regress silently if the condition is ever
  simplified to "has a Bearer header" during a later refactor. This is a named integration test in
  `csrf-middleware.test.js`, not left to the general flag-off/flag-on test matrix.
- Negative: `authenticate` gains one more conditional check on every request (the `sid` revocation
  lookup) — mitigated by keeping it a cheap, indexed lookup and by only being consulted at all when
  a `sid` claim is present (never for existing web tokens).
- Required follow-up: `MOBILE_API_ENABLED=false` must make every `/api/auth/native/*` route 404,
  verified by an integration test in the same PR (ADR M-010).
