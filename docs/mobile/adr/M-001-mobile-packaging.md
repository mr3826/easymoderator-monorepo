# ADR-M-001: Mobile App Packaging (Standalone, Not a Workspace Member)

Status: Accepted<br>
Date: 2026-09-13<br>
Owners: Mobile Program Orchestrator

## Context

The root `package.json` declares npm workspaces for `EasyMod-backend`, `EasyMod-frontend`, and
`EasyMod-growth`, pinned to Node 20. Expo SDK 57 (the current stable release, React Native 0.86)
requires Node ≥ 22.13. The repo's existing Security Scan workflow runs gitleaks across full
history on **all** branches (`--log-opts=--all`), and its dependency-audit step scans the root
lockfile. Root `.gitignore`/`.gitattributes` are tuned for the existing three apps and do not
account for Android/Expo build artifacts or credential-shaped files. See
`docs/mobile/CURRENT_STATE.md` §1–2.

## Decision

`EasyMod-mobile/` is a **standalone** npm package: its own `package-lock.json`, its own
`.nvmrc` pinned to Node 22, and module-local `.gitignore` (`google-services.json`, `*.keystore`,
`*.jks`, `*.p8`, `*.p12`, `*.pem`, `*.key`, `credentials.json`, `.expo/`, `android/`, `ios/`,
`*.apk`, `*.aab`, `.env*`) and `.gitattributes` (`* text=auto eol=lf`). It is **not** listed in
the root `workspaces` array. Metro is configured with `disableHierarchicalLookup: true` and an
explicit `nodeModulesPaths` limited to `EasyMod-mobile/node_modules`, so it never resolves
dependencies from the root `node_modules` tree and the root lockfile never changes when mobile
dependencies change.

Removal is: delete `EasyMod-mobile/`, `.github/workflows/mobile-ci.yml`, `docs/mobile/`, and
revert the additive, flag-gated backend delta described in `MOBILE_EXECUTION_STATE.md`'s ledger.
Nothing else in the repo references `EasyMod-mobile/` by path.

## Assumptions

- The three existing apps' CI, Docker builds, and dependency audits must show zero diff in
  behavior whether or not `EasyMod-mobile/` exists. This is verified per phase (see
  `CURRENT_STATE.md` §16) rather than assumed once.
- A second, independent Node 20 install remains available on the orchestrator's workstation for
  running backend/frontend/growth suites unmodified.

## Alternatives Rejected

- **Add `EasyMod-mobile` to the root workspaces array.** Rejected: forces the whole repo onto one
  Node version (either breaking Expo 57's Node ≥22.13 floor, or moving backend/frontend/growth off
  their verified Node 20 baseline), and ties mobile's dependency tree into the root lockfile the
  Security Scan's dependency audit already covers — a mobile-only dependency bump would then show
  up as a root-repo change reviewers must reason about.
- **A separate sibling repository.** Rejected by the brief: the mobile app must live inside
  `mr3826/easymoderator-monorepo` so it can share documentation, ADR history, and the same
  pull-request/branch-protection posture as the rest of the codebase, and so backend contract
  changes land in the same PR review as the mobile code that depends on them.

## Consequences

- Positive: root lockfile, Dockerfiles, and the existing Security Scan's dependency-audit scope
  are provably untouched by any mobile-only change.
- Positive: Node-version isolation removes an entire class of "works on backend's Node, breaks on
  mobile's Node" failures without either side compromising.
- Negative: mobile cannot import shared TypeScript types or utilities from `EasyMod-frontend`
  without a deliberate, reviewed publishing step (there is none in Phase 0–8 — see ADR M-003,
  which chooses a mobile-owned typed client instead).
- Required follow-up: `mobile-ci.yml` (ADR M-009) must include a check that the root lockfile is
  byte-identical to `origin/main` on every mobile-branch push, so a violation of this ADR fails CI
  immediately rather than being caught only at review time.
