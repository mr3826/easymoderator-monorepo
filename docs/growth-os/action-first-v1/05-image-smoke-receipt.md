# Growth image smoke receipt (2026-10-20)

`npm run test:growthos:image` (`scripts/run-growth-image-smoke.js`) at
branch head:

- First attempt: the production Docker image BUILT successfully from this
  branch (Vite 7.3.6, 1648 modules, 406.41 kB JS / 20.82 kB CSS) but the
  smoke container's `/health/ready` wait timed out while the shared Docker
  VM was saturated by concurrent builds. No product defect.
- Retry with cached layers: **`Growth image smoke passed for
  easymod-growth-smoke:17576`** — static serving, SPA fallback,
  `build-info.json` commit reproducibility, and security headers all
  verified by the canonical script. The exited smoke container was removed
  (self-owned).

The founder-review stack additionally proves the same Dockerfiles run as
live frontend+backend containers behind the loopback-only review proxy.
