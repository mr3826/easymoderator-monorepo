# EasyModerator Lead Capture (Chrome MV3 extension)

A minimal, privacy-bounded browser companion for the **EasyModerator Growth OS**
lead-capture flow. It lets an operator manually capture a business page being
viewed in Chrome and hand it to the Growth OS review page
(`https://growth.easymod.tech/capture`) where duplicate preflight, explicit
confirmation, and record creation already live inside the authenticated SPA.

- Version: `0.1.0` (pre-release)
- Target: Chromium Manifest V3, loaded unpacked by the internal Growth team
- Payload contract: `EasyMod-growth/src/pages/CapturePage.tsx`
  (`businessName`, `pageUrl`, `sourceWebsite`, `selectedText`, `contactPhone`,
  `contactEmail`, `note` in sessionStorage key
  `growth-os.capture-payload.v1`) — field names mirror it verbatim.

## Manual-only operating model

Capture happens **only** when the operator clicks the toolbar action on a page:

1. The popup reads the **active tab once** (title, URL, current text
   selection, visible `mailto:`/`tel:` link values, capped visible text) using
   the `activeTab` + `scripting` grants that a toolbar click arms.
2. The operator reviews and edits every field. **Nothing is sent until
   "Continue in Growth OS" is clicked.**
3. The popup generates a random 128-bit nonce and stores it with the payload in
   `chrome.storage.session` (session-scoped, browser memory only), then opens
   `/capture?captureNonce=<nonce>`. The URL contains only that nonce, never PII,
   so business data never enters browser history, server access logs, or Referer
   headers.
4. `content-bridge.js` is injected on the first-party Growth hosts but is inert
   unless the top-frame pathname is exactly `/capture` and the URL has one
   valid nonce-only query. It asks the service worker to `claim` with the nonce
   and its target origin/path. The worker validates the sender extension,
   origin, exact path, nonce, and frame 0, and binds to the created tab when its
   id is available.
5. Claim operations serialize storage get/validate/remove, so concurrent
   claims deliver **once**. Nonce or target-tab mismatches do not consume the
   pending entry; malformed and payloads older than **5 minutes** are discarded.
6. The bridge writes `sessionStorage['growth-os.capture-payload.v1']` (the
   key the SPA already reads — primary mechanism) and also dispatches a
   same-origin `window.postMessage` carrying the nonce, target origin/path, and
   payload as a secondary signal. The SPA validates those message fields before
   accepting an asynchronously delivered payload.
7. The SPA performs the canonical duplicate preflight and creates the record
   only after explicit confirmation, then clears the sessionStorage entry.

The extension **never calls Growth APIs**. Authentication, CSRF, and the ledger
stay entirely in the SPA's own session, exactly as in `docs/growth-os`.

## Boundaries enforced by the manifest

| Boundary | Mechanism |
| --- | --- |
| No background scraping / browsing | No `background` polling, alarms, or navigation code; worker only answers `claim` messages |
| No history access | No `history` permission (asserted in `test/manifest.test.js`) |
| No cookies/tokens of any kind | No `cookies` permission; popup collector only reads `document.title`, selection, `mailto:`/`tel:` hrefs, and capped visible text |
| No broad host access | No `<all_urls>`; the release `host_permissions` + `content_scripts.matches` contain ONLY `https://growth.easymod.tech/*`; localhost exists only in `manifest.dev.json` |
| No social-platform capture | Exact social roots and subdomains, including Facebook, Instagram, Messenger, WhatsApp, LinkedIn, X, and other listed social hosts, are refused; deceptive suffixes such as `facebook.com.example` remain ordinary web hosts |
| No credentials or PII in stored URLs | HTTP(S) username/password components are stripped before the page URL enters the relay or Growth create request; the hand-off URL carries only `captureNonce=<32 hex chars>` |
| Relay target boundary | The bridge is runtime-guarded to top-frame `/capture` with one valid nonce; the worker checks the exact sender origin/path and frame 0 |
| No page reads on protected pages | `chrome://`/`chrome-extension://`/`file://` and the Growth host itself are refused in `lib/capture.js` + popup with an explanation |
| No unbounded data | Strict allow-list + length caps (`businessName` 255, `pageUrl` 2048, `note` 4000, etc.); email regex capped to the first 3 candidates; phones from `tel:` links only |
| Single delivery / expiry | `createPendingCaptureStore()` serializes claim-once get/validate/remove; nonce/target mismatches return `null` without consuming; malformed/expired entries are cleared; 5-minute TTL |
| Exact permission set is a tested invariant | `test/manifest.test.js` deep-equality guards the security boundary |

## What this extension NEVER does

Mapped against the Growth OS "Explicit Do-Not-Build" boundaries
(`docs/growth-os/01-architecture-deployment-security-audit.md`, the product's
§27 do-not-build list):

- Never reads or writes **cookies**, local/session storage, or tokens of
  **visited pages** (the only storage it touches is its own
  `chrome.storage.session` and first-party Growth OS `sessionStorage`).
- Never accesses **history** and never performs **automatic navigation** — the
  only tab it opens is the fixed Growth OS `/capture` URL with a random nonce,
  on operator click.
- Never **scrapes** (no background fetch loop, no observer, no crawl), never
  touches Facebook/any social platform data, no **mass messaging**, no
  **auto-send** (Messenger/WhatsApp/email), **no workflow builder**,
  **no generic CRM** surface, **no broad export**, **no impersonation**,
  **no public signup**.
- Never sends a prospect anywhere before the operator confirms **inside
  Growth OS**; it performs no writes itself and holds no credentials.
- Never captures on non-`http(s)` pages or on Growth OS pages themselves.
- Never captures Facebook, Instagram, Messenger, WhatsApp, or equivalent social-platform hosts.
- Never logs or transmits payload contents.
- No `optional_permissions`/`permission_defaults` that could widen scope.

## Files

```
EasyMod-extension/
├── manifest.json        MV3 manifest — tested for the exact permission set
├── popup.html/css/js    Operator preview + editable fields + hand-off
├── background.js        Service worker: nonce/path-bound claim relay
├── content-bridge.js    Growth-origin /capture bridge: sessionStorage + postMessage
├── lib/capture.js       Pure extract/sanitize/validate/nonce/relay logic (UMD:
│                        window/globalThis + importScripts + Node for tests)
├── validate.js           Bounded manifest and JavaScript source validation
└── test/                node --test suites (Node stdlib only, no deps)
```

No icons are shipped: Chrome renders the default puzzle-piece glyph. Icons are
intentionally omitted rather than fabricated (see manifest test).

## Install (Load unpacked)

1. Build/serve Growth OS (production `https://growth.easymod.tech` or local
   dev on port **5175**).
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select this `EasyMod-extension/` folder.
4. On any business page, optionally select key text, click the toolbar icon,
   edit the preview, then **Continue in Growth OS**.

## Local dev / E2E note

The release `manifest.json` grants access only to
`https://growth.easymod.tech/*`. For local development, copy or load the
separate `manifest.dev.json`, which adds only the first-party
`http://127.0.0.1:5175/*` origin. Never ship the development manifest as the
production extension build.

The popup selects the loopback hand-off automatically when the disposable
development manifest includes `http://127.0.0.1:5175/*`; the release manifest
continues to target `https://growth.easymod.tech`.

## Privacy statement

The extension processes only a small draft of page content the operator is
already looking at. The draft lives in the popup (ephemeral) until continued;
post-continue it lives ≤5 minutes in browser-memory session storage and then
in the Growth OS tab's `sessionStorage` until the SPA creates (or discards)
it. No analytics, no remote endpoints, no telemetry, no third-party code —
all scripts are first-party and listed in the manifest.

## Tests

```
npm run validate:extension                         # manifest and source checks
npm run test:extension                             # all extension regressions
node --test "EasyMod-extension/test/*.test.js"    # direct equivalent
```

Coverage: exact manifest permission/host/content-script boundary, the bridge's
exact `/capture` + nonce runtime guard, growth-vs `chrome://` refusal, phone
from `tel:` links only, emails `mailto:` first + conservative visible-text
regex capped to 3 candidates, field truncation, unknown-key rejection,
nonce/path/origin and target-tab rejection, concurrent claim-once relay, and
TTL expiry with a fake clock.
