# ADR-0002: Runtime Boundary Test Instead Of Dependency-Cruiser

Status: Accepted<br>
Date: 2026-08-22<br>
Owners: Engineering + Security

## Context

`AGENT_ACTION_POLICY.md` §3.3 declares a dependency-cruiser import rule as a MUST. The repository does not currently carry dependency-cruiser or an approved configuration, while `test:security` already runs source-boundary tests in the established `route-perimeter.test.js` style.

## Decision

Satisfy the current boundary requirement with `src/security/__tests__/ai-mutation-boundary.security.test.js`, registered in `test:security`, and enforce the runtime mutation boundary with `verifyAuthorization()` tests at the order and courier mutation services. The test scans every JavaScript file under `modules/ai/**` plus `message-worker.js` and rejects direct mutation-service imports.

The allowed-adapter list remains explicit. It MUST name each authorized adapter and MUST NOT become a wildcard. This ADR records the toolchain deviation; it does not weaken the requirement that mutation services reject missing, invalid, expired, tenant-mismatched, action-mismatched, or evidence-mismatched authorizations.

## Alternatives Considered

- Add dependency-cruiser immediately: stronger graph enforcement, but introduces a new toolchain and would duplicate the existing security-suite boundary receipt without a configured allowlist owner.
- Rely only on unit tests: insufficient because an import path can bypass a unit seam.

## Consequences

- Positive: no new dependency, existing CI security command owns the receipt, and the test covers the runtime boundary that a static graph cannot observe.
- Negative: the source scan is narrower than a full dependency graph and must be maintained when mutation namespaces change.
- Required follow-up: adopt dependency-cruiser only with an explicit configuration and a migration plan that preserves this runtime authorization test.
