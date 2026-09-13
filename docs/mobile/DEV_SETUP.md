# Mobile Dev Environment Setup

Status: Living document (Phase 0 baseline)<br>
Date: 2026-09-13

All of this is **session-scoped** — no step here changes a machine-wide default (no global Node
version switch, no global `JAVA_HOME`/`ANDROID_HOME` edit in a shell profile beyond what the
project's own scripts set for their own process). See `CURRENT_STATE.md` §13 for the verified
workstation inventory this responds to.

## 1. Toolchain layout

```
D:/easymod/.tools/
├── node-22/        portable Node 22 LTS — used only inside EasyMod-mobile/
├── node-20/        portable Node 20 LTS — used for EasyMod-backend/frontend/growth suites,
│                    matching the root package.json engines pin
└── maestro/         Maestro CLI, unzipped
```

`EasyMod-mobile/scripts/dev-env.ps1` prepends the correct tool paths to `PATH` for the current
PowerShell process only, and sets, for that process only:

- `JAVA_HOME` → the existing JDK 17 install at `C:/Program Files/Java/jdk-17` (the machine's
  current global `JAVA_HOME` points elsewhere and is left untouched).
- `ANDROID_HOME` → `D:\Android\Sdk` (already present on this workstation with platform 36,
  build-tools 36, NDK, and API 24/30/37 system images).

Every terminal used for mobile work runs `. EasyMod-mobile/scripts/dev-env.ps1` (or the bash
equivalent) first; nothing here is installed into Windows' system environment variables.

## 2. Emulator

**Correction from Phase 1 (2026-09-14):** no API 24 AVD actually exists on this workstation yet —
only `Medium_Phone`/`Medium_Phone_2`/`Pixel_8_Pro` (all API 37.x). The API 24 system image is
present under the SDK; create an AVD from it (`avdmanager create avd -n <name> -k
"system-images;android-24;..."`) before relying on the plan below.

Use an API 24 (Android 7) AVD as the primary low-end test target (`MOBILE_PRODUCT_SPEC.md` §4's
perf budgets are measured against it). A higher API-level AVD (30 or 37 — `Medium_Phone` etc.,
already present) is used only for verifying nothing regresses on newer Android, not as the primary
target.

## 3. Dev backend

Mobile development runs against a disposable backend, not the pilot production database:

- Postgres 16 and Redis 7 via Docker (tmpfs-backed, matching the pattern already used by the
  repo's own integration test harness, `docker-compose.test.yml`).
- Migrations run, then a demo shop is seeded with representative orders, products, and
  conversations.
- The AI provider and the Meta channel provider are both stubbed for this dev backend — no dev
  workflow ever sends a live Meta message or calls a live AI provider with production credentials
  (see the Meta constraint in `CURRENT_STATE.md` §14).
- The Android dev build reaches this backend through `adb reverse`, so the device/emulator talks
  to `localhost` on the host machine. Cleartext HTTP is allowed **only** in the `.dev` app variant
  (ADR-referenced in Phase 1); the `.preview`/production variants require HTTPS, enforced by env
  validation at build time.

**Phase 1 addendum (learned while scaffolding, not previously documented):** the env-validation
check above (`app.config.ts` throwing on a non-HTTPS URL for `preview`/`production`) is necessary
but not sufficient for the `.dev` variant to actually reach `localhost` over `adb reverse` on a
real device. Android 9+ (API 28+) blocks cleartext traffic by default at the OS level regardless
of what the JS-level config says, and this app's target SDK is 36. Making the `.dev` variant's
`adb reverse` workflow work on a real device/AVD will additionally need either
`expo-build-properties`'s `android.usesCleartextTraffic` option or a network-security-config XML —
neither is wired up yet, since Phase 1 does no device/emulator run. Whoever first does a real
`.dev` build against `adb reverse` (Phase 2+) should expect to add this.

## 4. What this environment is never used for

No dev-environment step in this document touches the pilot production database, the production
Meta app, or any production secret. Firebase/push testing before the Phase 2 human gate (a real
Firebase project + `google-services.json`) uses the stubbed FCM sender described above, not a real
Firebase project.
