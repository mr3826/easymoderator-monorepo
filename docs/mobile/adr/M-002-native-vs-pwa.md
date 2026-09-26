# ADR-M-002: Native App (Expo) Instead of a PWA

Status: Accepted<br>
Date: 2026-09-13<br>
Owners: Mobile Program Orchestrator + Product

## Context

EasyMod-frontend already has a working web app, and the backend already implements web push
(VAPID) end-to-end. A Progressive Web App wrapping the existing web app would reuse both with
close to zero new backend work. The master brief, however, specifies an Android-first native
merchant companion app built with Expo/React Native, positioned as "Web = configure the business;
Mobile = run the business" — a distinct, task-focused surface, not a resize of the web app.

## Decision

Build a native Expo application (development builds, Continuous Native Generation, New
Architecture, Android-first) per the brief. Record the PWA path here as the cheaper alternative
that was considered and explicitly not chosen, so a future reviewer does not have to re-derive
why the more expensive path was picked.

## Assumptions

- Product has already decided the "run the business" surface benefits from OS-level integration
  (lock-screen push actions, background reliability, one-handed use while a courier is at the
  door) enough to justify the added build/release/signing surface a native app carries. This ADR
  does not re-litigate that decision; it records the technical trade-off given the decision is made.
- Android-first is correct for the target merchant base; iOS is out of scope for this program.

## Alternatives Rejected

- **PWA on top of `EasyMod-frontend`, reusing existing VAPID web push.** Rejected for this
  program: no native module access (SecureStore-grade credential storage, native FCM data
  messages for silent background sync, deep native share targets for the "Photo → Draft" product
  flow), materially weaker background push reliability on Android OEM battery-management skins,
  and it would not exercise or harden the native-auth, native-push, or native-idempotency paths
  the backend needs regardless — those are needed for a true native app but not for a PWA, so
  building a PWA now would only defer the same work.
- **Hybrid WebView shell around the existing web app.** Rejected: inherits the PWA's native-module
  limitations while adding WebView-specific bugs (double back-stack, unreliable file/camera
  intents), without the code-sharing benefit a true PWA gets from the browser's own engine.

## Consequences

- Positive: full access to native modules used throughout the phases (SecureStore for refresh
  tokens, native FCM tokens for M-007, camera/gallery intents for Photo → Draft in P6).
- Negative: a real app-store release pipeline (signing, Play Console, EAS build profiles) is now
  in scope — gated as human decisions in `MOBILE_EXECUTION_STATE.md` and never automated by an agent.
- Negative: two client codebases (web, mobile) now independently consume the same backend
  contracts — mitigated by ADR M-003 (contract tests as the single source of truth) rather than a
  shared types package, per ADR M-001's isolation decision.
