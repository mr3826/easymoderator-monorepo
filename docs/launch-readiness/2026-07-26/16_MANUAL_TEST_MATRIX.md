# 16 — Manual Browser and Device Test Matrix

Performed against **live production** (`https://easymod.tech`) using a Chromium-based
browser. Read-only: no account created, **no credentials entered**, no form submitted, no
data written.

## Viewport results

| Viewport | `scrollWidth` | `innerWidth` | Horizontal overflow | Status |
|---|---|---|---|---|
| 360 × 800 (small Android) | 360 | 360 | **none** | PASS |
| 375 × 812 (iPhone) | 375 | 375 | **none** | PASS |
| 768 × 1024 (tablet) | 768 | 768 | **none** | PASS |
| 1280 × 800 (desktop) | — | — | none observed | PASS |

## Checks

| Check | Status | Evidence |
|---|---|---|
| No clipped navigation | PASS | header renders at all widths |
| No horizontal overflow | **PASS** | measured at 360/375/768 — see table |
| **Bengali text does not break layout** | **PASS** | language toggled to বাংলা at 360px: `scrollWidth 360 === innerWidth 360`, full Bengali UI renders (`আবার স্বাগতম! 👋`, `আপনার EasyModerator অ্যাকাউন্টে লগইন করুন`, `লগইন করুন →`) |
| Bilingual toggle works | **PASS** | `Switch to Bengali` button flips the entire login page |
| Touch targets usable | PASS (visual) | not measured against a 44px minimum |
| **No critical console errors** | **PASS** | `read_console_messages(onlyErrors)` → none |
| **No CSP violations** | **PASS** | no CSP errors in console |
| No sensitive data in browser logs | **PASS** | console empty |
| Loading states | PARTIAL | observed on SPA route transitions |
| Empty states | **BLOCKED** | requires an authenticated session |
| Error states | PARTIAL | login page renders; error paths not exercised (would require credentials) |
| Offline / network error handling | **BLOCKED** | not exercised |
| Session expiration / reauthentication | **BLOCKED** | requires a session |
| Browser back/forward | PASS | SPA routing behaved correctly across the pages visited |
| Refresh during OAuth callback | **BLOCKED** | requires Meta tester access |
| Refresh during inbox operation | **BLOCKED** | requires a session |
| Inaccessible modal | **BLOCKED** | modals are behind auth |
| Safari / WebKit compatibility | **BLOCKED** | no WebKit engine available in this environment |

## Pages exercised

| URL | Result |
|---|---|
| `/` | 200, full landing page renders, no console errors |
| `/login` | 200, renders, bilingual, "Private BD seller pilot" badge |
| `/privacy-policy` | 200, **complete policy renders without authentication** |
| `/terms` | 200 |
| `/app/channels/oauth-callback` | 200 (SPA shell) |

## Live API surface exercised (read-only)

| Request | Result |
|---|---|
| `GET /api/health` | 404 — backend JSON error envelope with `requestId` (proves the API is alive) |
| `GET /health`, `/health/ready`, `/health/detailed` | 200 from the **nginx stub**, not the backend — see `12_` |
| `POST /api/webhooks/meta` with `x-hub-signature-256: sha256=deadbeef` | **403** |
| `POST /api/webhooks/meta/data-deletion` unsigned | `{"error":"Missing signed_request"}` |
| `POST /api/webhooks/meta/data-deletion` with `signed_request=AAAA.BBBB` | `{"error":"Invalid signed_request signature"}` |
| `POST /api/webhooks/meta/deauthorize` unsigned | `{"error":"Missing signed_request"}` |
| `GET /api/analytics/growth` | **401** (correctly requires auth) |

No request mutated production state. All were GETs or deliberately-invalid POSTs designed
to confirm fail-closed rejection.

## What was deliberately NOT done

- **No account creation, no login, no credential entry.** Prohibited, and unnecessary for
  this audit's conclusions.
- **No merchant journey executed end-to-end** — it would create real shop/customer rows in
  the production database.
- **No Meta OAuth flow** — no tester access.
- **No message send** — would deliver a real Messenger message.
- **No droplet SSH** — outside the read-only remit and would require handling the private key.
- **No screenshots captured to disk.** Layout evidence is recorded as measured
  `scrollWidth`/`innerWidth` values and extracted page text, which is more precise than an
  image for the overflow question and avoids storing any rendered PII.

## Coverage honesty

The manual matrix covers the **unauthenticated** surface thoroughly and the
**authenticated** surface not at all. Every authenticated row above is marked BLOCKED
rather than assumed. Closing them requires a pilot merchant account and a Meta tester
Page — both founder-provisioned. See `18_FOUNDER_ACTION_CHECKLIST.md`.
