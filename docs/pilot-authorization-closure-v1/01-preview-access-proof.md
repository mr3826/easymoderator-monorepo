# 01 — Founder-accessible preview: access-chain proof (Gate A)

## Why the previous state failed the criterion

The closure Compose declares `127.0.0.1:54643:3000` for the backend, but the backend is attached **only** to `internal: true` network `closure-internal`. Docker does not materialize host port bindings for containers without a gateway network — the mapping silently never existed (`docker port` empty on 2026-10-27 and re-confirmed 2026-10-30). This is deterministic, not a Docker Desktop flake: the 10-27 attestation recorded it as publication failure. The runner-based rehearsal kept all traffic inside one container network namespace, which is invisible to Windows by construction.

## Alternatives considered

- **(A) Explicit loopback publication + loopback relays in the distro namespace — chosen.** No firewall change, no LAN exposure, no TLS/cookie-policy weakening, no repository Compose modification; the declared ports stay untouched.
- (B) Approved internal staging route — none exists; the production Caddy origin is `api.easymod.tech` (public), which would expose dev infrastructure and require production access. Rejected by mission constraint.
- (C) In-container browser evidence — already attested for the journey but explicitly does not satisfy founder accessibility. Retained only as corroboration.

## Access chain as built (2026-10-30)

```
Windows browser → https://127.0.0.1:54680 (Vite, closure-dedicated HTTPS config, loopback bind, external self-signed cert)
  → same-origin /api,/health proxy with X-Forwarded-Proto=https (Secure cookies preserved; CORS/CSRF origin exact match)
  → http://127.0.0.1:54643 (user-space Node relay in the WSL distro namespace, loopback bind, backend container IP resolved at connect time)
  → backend container 3367c27e GIT_SHA=04b07134 (unchanged, internal network, no egress, worker stopped)
```

Components (all outside the repository except the dedicated Vite config the candidate already ships):
- Relay: `D:\easymod\_pilot-authorization-closure-v1-local\preview-forwarder.cjs` (binds `127.0.0.1:54643` only; logs method+path, never bodies/cookies/tokens).
- Preview server: `vite.operational-gate-closure.config.ts` run in the durable byte-verified mirror `/root/pilot-preview/raw` (2,920/2,920 manifest match), Node v20.20.2, TLS material at `/root/pilot-preview/tls` (`notAfter=Nov 6 2026`, regenerated per run; cert/key outside repo per the config's own guard).
- Frontend dependency tree installed with `npm ci --ignore-scripts` + `--no-save` platform natives (`@tailwindcss/oxide-linux-x64-gnu@4.1.12`); tracked tree unaffected.

## Acceptance results (receipts on NTFS)

| Criterion | Result | Evidence |
|---|---|---|
| Preview opens on supported path | **PASS** from Windows | `Invoke-WebRequest https://127.0.0.1:54680/ → 200 text/html`; `/health/ready → 200 database:connected redis:connected` (`00` §identity; post-reset re-probe 2026-10-30T19:0xZ) |
| Synthetic merchant sign-in | **PASS** | `preview-walkthrough-20261030.json`: Shop A `/api/auth/signin 200`, `/api/auth/me 200`, Shop B `200` (HTTP-only Secure cookie issued over the HTTPS origin; password never printed) |
| Tenant isolation | **PASS** | Shop B reading Shop A's conversation → `404`; Shop B reading Shop A's order → `404`; Shop B conversation list does not contain Shop A's id |
| Inbox / Customers / Orders available | **PASS** | `/api/conversation 200`, `/api/customer 200`, `/api/order 200` with data; SPA routes `/`, `/signin`, `/inbox` → 200 |
| Action Queue | **PASS — truthful failure state** | `/api/inbox/actions → 409 FEATURE_DISABLED "Action queue is not enabled for this shop"` — exactly the pilot-safe OFF presentation, not a silent empty list |
| No commerce automation enabled | **PASS** | Same 409 + preflight attestations (`providerKeys synthetic-marker-only`, external sinks disabled, flags off) |
| Browser journeys on the same fresh DB | **PASS** | `playwright-chromium-pilot.log` 1 passed 58.5s; `playwright-firefox-pilot.log` 1 passed 1.3m — run on pilot evidence path so 10-28 attested closure receipts were not overwritten |

## Founder startup / credentials

- Start: run `up-closure-stack.sh`, `reset-reseed-pilot.sh` (clean demo state), then the relay + Vite servers (scripts in `D:\easymod\_pilot-authorization-closure-v1-local\`). Keeper process must stay alive; the distro `/tmp` is volatile by design — everything durable lives under `/root/pilot-preview` and `D:\easymod\_pilot-*`.
- URL: `https://127.0.0.1:54680` (loopback only; self-signed cert — accept warning for this rehearsal, or import `tls/localhost.crt`).
- Accounts (synthetic, no PII): `closure.a.owner@ops.easymod.test` / `closure.b.owner@ops.easymod.test`; password stored in `D:\easymod\_operational-gate-closure-v1-local\ops-browser.env` (`OPS_E2E_PASSWORD`, 14+ chars) — never committed.
- Teardown: stop relay + Vite, `dc stop backend` … `dc down` **without** `-v` (volumes hold attested restore fixtures).

## Gate verdict

`FOUNDER_ACCESS=PASS (path proven end-to-end from the Windows host)`. Founder's own click-through remains the human confirmation recorded via the authorization package (`08`); nothing was exposed beyond loopback, no authentication or cookie policy was weakened, and no candidate source changed.
