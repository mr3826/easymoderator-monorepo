# Browser Extension

This document describes the current `EasyMod-extension` Chromium MV3 companion
for Growth OS. It is an operator-triggered handoff tool, not a scraper, CRM,
API client, or merchant application. Current code in `manifest.json`,
`manifest.dev.json`, `popup.js`, `background.js`, `content-bridge.js`, and
`lib/capture.js` is authoritative.

## Release And Development Manifests

Both manifests are MV3 version `0.1.0` and use the exact extension permission
set:

```text
activeTab, scripting, storage
```

| Manifest | Host permissions | Content-script matches |
| --- | --- | --- |
| `manifest.json` release | `https://growth.easymod.tech/*` only | `https://growth.easymod.tech/*` only |
| `manifest.dev.json` development | Release host plus `http://127.0.0.1:5175/*` | Release host plus `http://127.0.0.1:5175/*` |

There is no `history`, `cookies`, `<all_urls>`, optional permission, alarm,
notification, or broad social-platform host grant. The service worker is
`background.js`; the action popup is `popup.html`.

The release manifest is the production artifact. Chrome loads the manifest
named `manifest.json`, so local development must use a disposable copy of the
extension directory: place a copy of `manifest.dev.json` at the copy's
`manifest.json`, and serve the Growth SPA on `http://127.0.0.1:5175`. The
popup detects the loopback host permission and selects the local handoff
automatically. Do not replace the tracked release manifest or ship the
development manifest.

## Local Installation

1. Start the local Growth SPA on port `5175` and ensure the backend/auth
   session used by that SPA is available.
2. Prepare the disposable development copy as described above.
3. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
   and select the disposable copy containing the development `manifest.json`.
4. Open a normal business page, click the extension toolbar action, review/edit
   the preview, and continue in Growth OS.

For the release target, load the directory with the original `manifest.json`
and use `https://growth.easymod.tech/capture`. The repository provides
`npm run validate:extension` for bounded source/manifest validation rather than
creating a distributable package.

## Manual Capture Flow

Capture is manual and occurs only after the operator clicks the toolbar action:

1. The popup reads the active tab once with `activeTab` and `scripting`. The
   injected collector reads only the page title, URL, current text selection,
   up to 100 `mailto:`/`tel:` anchors, and the first 20,000 characters of
   visible text.
2. The pure capture logic extracts a business name from the title, the page
   URL/host, the first valid phone from `tel:` links, and up to three
   conservative email candidates from `mailto:` links or visible text. Manual
   capture rejects Facebook, Instagram, Messenger, WhatsApp, and equivalent
   social-platform roots/subdomains while retaining ordinary public web pages.
   The operator can edit the preview before handoff.
3. Field limits are enforced before handoff: business name 255, page URL 2,048,
   source website 255, selected text 8,000, phone 64, email 320, and note
   4,000 characters. HTTP(S) username/password components are stripped from
   page URLs before relay storage and before the Growth create request. A
   business name and at least one of phone, email, or page URL are required.
4. **Continue in Growth OS** creates a random 128-bit, 32-hex-character nonce
   and stores the sanitized payload in the extension's session-scoped
   `chrome.storage.session`. It opens only the first-party `/capture` path with
   `?captureNonce=<nonce>`; no payload data is placed in the URL.
5. The Growth-origin bridge runs only in the top frame at the exact `/capture`
   path with one valid nonce. It asks the service worker to claim the payload
   with the nonce, target origin, and target path. The worker validates the
   extension sender, frame 0, sender tab URL, origin/path, nonce, and created
   target-tab binding.
6. Claim operations serialize get/validate/remove. A matching claim removes the
   pending entry once; nonce, origin, path, or target-tab mismatches do not
   consume it. Malformed or expired entries are removed. The pending relay TTL
   is at most five minutes.
7. The bridge writes the payload to the Growth SPA's own
   `sessionStorage['growth-os.capture-payload.v1']` and sends a same-origin
   `window.postMessage` secondary signal containing the nonce and target
   origin/path. The SPA validates those fields, consumes an asynchronous
   message when needed, and retains the storage fallback before presenting the
   editable review form.
8. The SPA performs the canonical `POST /api/internal/growth-os/prospects/duplicate-check`
   preflight, then creates the prospect only after explicit confirmation. The
   created record uses source `browser_extension` and preserves the captured
   source website as source detail. The SPA clears its session value after a
   successful create; the backend owns authentication, CSRF, uniqueness, and
   audit writes.

The extension never calls a Growth API, stores an access/refresh token, or
performs the prospect write itself. It hands data to the already-authenticated
Growth SPA.

## Hard Boundaries

- No cookies or browser history is read or written, and no arbitrary visited-page
  local/session storage is read or written. The only session-storage write is
  the explicit first-party capture handoff described above.
- No background polling, DOM observer, crawl, automatic extraction loop, or
  silent navigation exists. The only new tab is the fixed first-party capture
  handoff after an operator click.
- `chrome://`, `chrome-extension://`, `file://`, Growth-origin pages, and other
  non-HTTP(S) pages are refused. Protected browser pages may also reject the
  one-time script injection and show a retry message.
- Facebook, Instagram, Messenger, WhatsApp, and equivalent social-platform
  roots/subdomains are refused; ordinary public web hosts remain eligible.
- The service worker performs no network request and has no merchant/social
  platform credentials. Payload content is not logged or transmitted by the
  extension.
- The nonce URL is path/origin-bound and contains no PII. This protects the
  extension-to-SPA handoff; it does not make the captured page content itself
  non-sensitive while it is held in browser-memory session storage.

## Audit And Known Limitations

The extension has no audit store of its own. Once the operator confirms,
Growth OS writes the prospect creation and later lifecycle/audit records. The
pending extension copy lasts no longer than the five-minute relay TTL; the SPA
session-storage copy can remain until the record is created, discarded, the tab
session ends, or logout cleanup runs.

The handoff is deliberately not a force-create path. A duplicate preflight can
be stale, and the server/database uniqueness check remains authoritative. The
capture UI blocks duplicate matches and offers review/update actions only.
Dynamic pages that hide contact data from visible text or links are not enriched
by background requests; the operator must edit the preview.

The current release is pre-release `0.1.0`, has no shipped custom icons, and
requires an unpacked Chromium installation. Local development must not be
validated with the release manifest's production-only content-script match.

## Deployment Receipt

```text
DEPLOYMENT_STATUS=NOT_DEPLOYED_TO_PRODUCTION
PRODUCTION_MUTATED=NO
META_REVIEW_CONFIGURATION_CHANGED=NO
PRODUCTION_WORKFLOW_OR_CONFIG_MUTATED=NO
```

No production deployment, production workflow/configuration mutation, or
merchant-platform operation is part of this extension handoff.
