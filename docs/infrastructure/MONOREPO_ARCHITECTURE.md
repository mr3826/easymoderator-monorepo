# EasyModerator Monorepo Architecture

## Scope

The monorepo groups the independently understandable EasyModerator modules in one Git repository. This is a repository and delivery migration; it does not merge runtime code or create application-level imports between modules.

```text
EasyModerator/
├── EasyMod-backend/     # Express API, workers, migrations, integrations
├── EasyMod-frontend/    # React/Vite merchant and marketing application
├── GrowthOS/            # Independent React/Vite platform-operations frontend
├── .github/workflows/   # All active GitHub Actions workflows
├── docs/                # Canonical product, security, launch, and operations docs
├── scripts/             # Root-level repository utilities
└── package.json         # npm workspace orchestration only
```

## Module boundaries

- `EasyMod-backend` keeps its own `package.json`, lockfile, tests, migrations, Dockerfiles, and runtime entrypoints.
- `EasyMod-frontend` keeps its own `package.json`, lockfile, Vite configuration, tests, and deployment assets.
- `GrowthOS` keeps its own `package.json`, lockfile, Vite configuration, Dockerfile, and API namespace contract. It relies on EasyModerator session authentication but owns no merchant business logic.
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

The backend is JavaScript and has no compilation step; `build:backend` is a syntax smoke check. GrowthOS currently has no unit-test suite, so `test:growthos` runs its production build as a smoke test. That gap remains visible rather than being represented as nonexistent coverage.

## History and rollback

The backend-led EasyModerator history remains the local baseline. The private `mr3826/growth-os` repository was imported into `GrowthOS/` with a non-squashed subtree merge so its source commits remain reachable. The original backend, frontend, and GrowthOS repositories remain unchanged and are the rollback sources until the new repository has passed clean-clone and required-CI validation.

The new repository does not silently change production deployment. Existing production workflows and infrastructure are validated in this repository first; a production repository switch requires a separate authorized deployment decision.

## Workflow ownership

- `ci-cd.yml` is the backend/frontend production gate and deployment path.
- `growth-os.yml` independently verifies and publishes the GrowthOS image from `GrowthOS/`.
- Backup, administrative, purge, and backend load-testing workflows live only under root `.github/workflows/`.
- Module-local `.github/workflows` directories are not active GitHub workflow locations and are not retained as duplicate configuration.
