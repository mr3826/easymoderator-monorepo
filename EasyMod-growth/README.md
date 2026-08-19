# EasyMod Growth OS

Internal staff frontend for EasyModerator platform operations. Served on
`growth.easymod.tech`. Not a merchant surface and not reachable from the
merchant app.

## Boundaries

Growth OS owns no business logic. It reads the backend through one namespace,
`/api/internal/growth-os/*`, implemented in
`EasyMod-backend/src/modules/growth-os/`. Every route behind that namespace is
authenticated and then authorized by `requireGrowthOsAccess`; permissions and
role bindings live in `growth-os.permissions.js` and the
`growth_os_user_roles` table.

There are no workspace imports between this app and the other modules.

## Local development

```sh
npm install          # from the repository root — this is an npm workspace
npm run dev          # from this directory
```

`VITE_API_BASE_URL` is empty by default, so the app calls the API same-origin.
That is how it runs in production: Caddy terminates `growth.easymod.tech` and
proxies `/api/*` to the backend, so no cross-origin configuration is needed.
Set it only when pointing a local dev server at a remote API.

## Checks

```sh
npm run typecheck    # tsc --noEmit
npm run build
```

`npm test` is an alias for `typecheck`. There is no behavioural test suite here
— the authorization rules this app depends on are covered on the backend by
`growth-os.authz.test.js`. Treat the type gate as a type gate, not as coverage.

## Delivery

`.github/workflows/growth-os.yml` typechecks, builds, and publishes
`ghcr.io/mr3826/easymoderator-growth-os`. `ci-cd.yml` never rebuilds this image;
it carries the running digest forward so Compose stays resolvable. See
`docs/deployment/MONOREPO_CUTOVER_RUNBOOK.md` for the first rollout.
