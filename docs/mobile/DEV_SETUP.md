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

`EasyMod-mobile/scripts/dev-env.ps1` (bash equivalent: `EasyMod-mobile/scripts/dev-env.sh`)
prepends the correct tool paths to `PATH` for the current shell process only, and sets, for that
process only:

- `JAVA_HOME` → the existing JDK 17 install at `C:/Program Files/Java/jdk-17` (the machine's
  current global `JAVA_HOME` points elsewhere and is left untouched).
- `ANDROID_HOME` → `D:\Android\Sdk` (already present on this workstation with platform 36,
  build-tools 36, NDK, and API 24/30/37 system images).

Every terminal used for mobile work runs `. EasyMod-mobile/scripts/dev-env.ps1` (or `source
scripts/dev-env.sh` in bash) first; nothing here is installed into Windows' system environment
variables.

**Phase 2 correction:** the portable `D:/easymod/.tools/node-22`/`node-20`/`maestro` layout
described above was never actually provisioned on this workstation — only planned. The Phase 2
Lane 0 dev/build session (`npm install`, `tsc --noEmit`, `expo prebuild`, the Gradle build) ran
against the workstation's global Node (`v25.6.1`, not the `.nvmrc`-pinned `22`) with no observed
problems for `EasyMod-mobile`'s own toolchain; nothing in this phase depended on the portable
Node-20 copy used for backend/frontend/growth suites either. Provisioning the actual portable
toolchain (or pinning via a version manager) remains open for whoever needs strict Node-22
reproducibility.

## 2. Emulator

**Phase 2 update (2026-09-14/15):** the API 24 AVD now exists — `Nexus_5_API_24`, created from
`system-images;android-24;google_apis_playstore;x86` (Play Services present, needed for FCM
later). `Medium_Phone`/`Medium_Phone_2`/`Pixel_8_Pro` (all API 37.x) remain available as the
higher-API fallback target described below.

Use `Nexus_5_API_24` as the primary low-end test target (`MOBILE_PRODUCT_SPEC.md` §4's perf
budgets are measured against it). The higher-API AVDs are used only for verifying nothing
regresses on newer Android, not as the primary target.

**Build verification against `Nexus_5_API_24` (Lane 0, 2026-09-15):** the AVD boots cleanly —
Windows Hypervisor Platform (WHPX) acceleration engages automatically for this x86 image
(confirmed in the emulator log: "Windows Hypervisor Platform accelerator is operational"), so cold
boot is hardware-accelerated, not emulated in software, and `adb`/`getprop sys.boot_completed`
confirmed a full boot to Android 7.0 in a few minutes. `npx expo prebuild --platform android`
against the current `app.config.ts` was already present in `EasyMod-mobile/android/` from this
lane's earlier interrupted session and was spot-checked, not regenerated: `AndroidManifest.xml`
carries `android:usesCleartextTraffic="true"` and `build.gradle` carries `applicationId
'tech.easymod.merchant.dev'`, both matching the `.dev`-variant config exactly — no drift.

`./gradlew assembleDebug` was then run against the booted emulator (min/target/compile SDK
24/36/36, NDK 27.1.12297006, no ABI restriction encountered). **This did not reach a pass/fail
result within this lane's time-boxed session.** The build was not stuck or crashed — the Gradle
worker JVM's CPU time and heap kept climbing over the whole run (confirmed via repeated
`Get-Process` samples) — it was simply slower than the ~20-minute budget this lane allotted for
AVD/build verification, most plausibly because this workstation runs the shared repo across ~10
concurrent git worktrees (`easymod-worktrees` note) and several other active sessions were doing
their own disk-heavy work (npm installs, other test runs) at the same time; unrelated filesystem
scans in this same session (`rg`, `find`) were independently timing out during this window, pointing
at host-level disk I/O contention rather than an RN 0.86-on-x86 incompatibility. **Net: the emulator
itself is proven good (boots, hardware-accelerated, correct `.dev` manifest/package), but a full
native compile against it was not completed, so the cold-start perf budget in
`MOBILE_PRODUCT_SPEC.md` §4 is explicitly UNVERIFIED — not confirmed passing, not confirmed
failing.** Whoever picks this up next should re-run `./gradlew assembleDebug` (from
`EasyMod-mobile/android`, with `scripts/dev-env.sh`/`.ps1` sourced first) on a less contended
machine/window; if RN 0.86 turns out to genuinely reject the 32-bit x86 image, fall back to one of
the already-present API-37 AVDs (`Medium_Phone`, `Medium_Phone_2`, or `Pixel_8_Pro`) as the
higher-API target and re-document the perf budget against that instead. This is the first time
this program has attempted a native build against the API-24 target rather than assuming RN
0.86/New Architecture would accept it, and that attempt is still open.

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

**Phase 2 Lane 0 verification (2026-09-15):** `EasyMod-backend/scripts/seed-mobile-dev.js` was run
end to end against a real, freshly-migrated disposable Postgres 16 container (all 34 migrations
applied cleanly) rather than only reviewed by reading the source. Result: `MOBILE_DEV_SEED=PASS`,
and a direct query of the seeded rows confirmed every Phase-2 attention tier the Home screen (Lane
3) needs to render against is present — two draft orders at different ages/values (৳450 / 30h old,
৳3200 / 3h old), a messenger conversation needing a reply and a separate `hitl:true` Instagram
handoff, one `courier_dispatch` row with `status='FAILED'` (steadfast) and one with
`status='INDETERMINATE'` (pathao), a third confirmed order left undispatchable because the shop
has zero `DeliveryIntegration` rows (`courier-readiness.service.js` correctly reports
`status=SETUP_INCOMPLETE, missing=[provider_not_connected]`), two tracked/active/low-stock products
plus one untracked+inactive decoy that correctly does **not** qualify, and one customer whose phone
`RtoShieldService.checkPhone()` classifies `tier=verify` (`risk_score=55`). No gaps found; no
changes were needed to the seed script itself. See ADR `M-008-attention-and-today.md`'s Assumptions
section for a related open finding on whether `low_stock_threshold`'s default value of `5` reflects
real merchant behavior (spot-checked against code/fixtures only — the pilot production database was
correctly not touched by this lane).

## 4. What this environment is never used for

No dev-environment step in this document touches the pilot production database, the production
Meta app, or any production secret. Firebase/push testing before the Phase 2 human gate (a real
Firebase project + `google-services.json`) uses the stubbed FCM sender described above, not a real
Firebase project.
