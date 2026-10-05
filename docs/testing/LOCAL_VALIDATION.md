# Local validation

The root package is an npm workspace for `EasyMod-backend`, `EasyMod-frontend`,
and `EasyMod-growth`. `EasyMod-mobile` is intentionally a standalone Expo
package with its own lockfile. Use Node 20 for the root workspace and the
Node version declared by the mobile workflow for mobile work.

## Install

```bash
npm ci
cd EasyMod-mobile && npm ci
```

Run the mobile install separately because it is not a root workspace.

## Fast checks

```bash
npm run test:backend
npm run test:frontend
npm run test:growthos
npm run test:extension
npm run build:all
```

The repository does not currently define a backend or frontend lint script.
The backend build is a Node syntax check, the frontend build is the Vite
production build, and Growth OS tests include its configured type checks.

For mobile changes:

```bash
cd EasyMod-mobile
npm run typecheck
npm run lint
npm test -- --runInBand
npx expo-doctor
npm audit --json > "$TEMP/easymod-mobile-audit.json"
npx expo export --platform android --output-dir "$TEMP/easymod-mobile-export" --clear --no-bytecode --source-maps true
node scripts/mobile-audit-policy.js "$TEMP/easymod-mobile-audit.json" <android-source-map-path>
```

The audit policy records direct/transitive advisories and rejects critical
findings or any reviewed build-only advisory that appears in the shipped
Android bundle. `npm audit fix --force` is not an approved remediation because
Expo and React Native compatibility must be evaluated before changing versions.

## Backend integration

The supported integration command provisions disposable PostgreSQL 16 and
Redis 7 containers, applies migrations, runs the integration suite, and tears
the containers down even when a test fails:

```bash
npm run test:backend:integration:docker
```

The wrapper uses loopback ports `55432` and `56379` by default. Set
`TEST_POSTGRES_PORT` or `TEST_REDIS_PORT` when another local service owns a
port. The test database name must remain an `e2e` or `test` database.

## Focused coverage

```bash
npm run test:backend:meta:e2e:docker
npm run test:growthos:e2e
npm --prefix EasyMod-frontend run test:e2e
```

The frontend Playwright suite is mock-only. It proves controlled UI behavior,
not backend integration. The backend Meta-shaped suite uses disposable stores
and is the local reproduction of the trust-boundary CI gate.

## CI ownership

| Check | Local command | Remote owner |
| --- | --- | --- |
| Root install | `npm ci` | `CI / CD` quality job |
| Backend unit/security | `npm run test:backend` | `CI / CD` quality job |
| Backend integration/migrations | `npm run test:backend:integration:docker` | `CI / CD` integration job |
| Meta trust boundary | `npm run test:backend:meta:e2e:docker` | `CI / CD` Meta-shaped E2E |
| Frontend unit/build | `npm run test:frontend`, `npm run build:frontend` | `CI / CD` quality job |
| Frontend browser behavior | frontend Playwright command | `CI / CD` frontend E2E |
| Growth build/browser | Growth package scripts | `growth-os.yml` |
| Mobile typecheck/lint/unit/audit | mobile commands above | `mobile-ci.yml` |
| Android compile/device proof | local native build when needed | `mobile-ci.yml` / `mobile-release.yml` |
| Dependency and history scan | package-specific audit | `security-scan.yml` |
| Image build | Docker locally when needed | `release.yml` and PR Docker validation |
| Production deploy/smoke | never from local pre-push | guarded `release.yml` path |
