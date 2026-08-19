# EasyModerator Monorepo Architecture

## Scope

The monorepo groups the independently understandable EasyModerator modules in one Git repository. This is a repository and delivery migration; it does not merge runtime code or create application-level imports between modules.

```text
EasyModerator/
├── EasyMod-backend/     # Express API, workers, migrations, integrations
├── EasyMod-frontend/    # React/Vite merchant and marketing application
├── EasyMod-growth/      # Independent React/Vite TS Growth OS staff frontend
├── .github/workflows/   # All active GitHub Actions workflows
├── docs/                # Canonical product, security, launch, and operations docs
├── scripts/             # Root-level repository utilities
└── package.json         # npm workspace orchestration only
```

## Module boundaries

- `EasyMod-backend` keeps its own `package.json`, lockfile, tests, migrations, Dockerfiles, and runtime entrypoints.
- `EasyMod-frontend` keeps its own `package.json`, lockfile, Vite configuration, tests, and deployment assets.
- `EasyMod-growth` keeps its own `package.json`, lockfile, Vite configuration, Dockerfile, and API namespace contract. It relies on EasyModerator session authentication but owns no merchant business logic. Its backend counterpart is `EasyMod-backend/src/modules/growth-os/`, reached only through `/api/internal/growth-os/*`.
- There are no workspace package imports between the modules. Root workspace scripts invoke module-owned commands without changing their deployment boundaries.

## Workspace commands

From the repository root:

```sh
npm run install:all
npm run test:backend
npm run test:frontend
npm run test:growthos
npm run build:backend
npm run build:frontend
npm run build:growthos
npm run test:all
npm run build:all
```

The backend is JavaScript and has no compilation step; `build:backend` is a syntax smoke check. Growth OS is TypeScript and has no unit-test suite, so `test:growthos` runs `tsc --noEmit`. That is a real type gate rather than a build aliased as a test, but it is not behavioural coverage and is not presented as such. Its authorization rules are covered on the backend side by `growth-os.authz.test.js`.

## History and rollback

The backend-led EasyModerator history remains the local baseline. The private `mr3826/growth-os` repository was first imported as `GrowthOS/`, a frontend with no backend behind it. `EasyMod-growth/` supersedes it together with the `growth-os` backend module that serves its API namespace; the retired `GrowthOS/` tree stays reachable in history and at the `archive/growth-os-mvp2` tag. The original backend, frontend, and growth-os repositories remain unchanged and are the rollback sources.

The new repository does not silently change production deployment. Existing production workflows and infrastructure are validated in this repository first; a production repository switch requires a separate authorized deployment decision.

## Workflow ownership

- `ci-cd.yml` is the backend/frontend production gate and deployment path.
- `growth-os.yml` independently typechecks, builds, and publishes the Growth OS image from `EasyMod-growth/`. `ci-cd.yml` never rebuilds it; it only carries the running digest forward so Compose stays resolvable.
- Backup, administrative, purge, and backend load-testing workflows live only under root `.github/workflows/`.
- Module-local `.github/workflows` directories are not active GitHub workflow locations and are not retained as duplicate configuration.

The monorepo publishes its own GHCR images (`easymoderator-backend`, `easymoderator-frontend`, and `easymoderator-growth-os`) so a new repository cannot overwrite packages owned by a source repository. The production deploy job is additionally gated by the `PRODUCTION_DEPLOY_ENABLED` repository variable; it remains disabled until deploy credentials, the production environment, and rollback evidence are explicitly configured.
