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
24/36/36, NDK 27.1.12297006). It ran for 28m 43s and **BUILD FAILED** — a definitive result, not a
timeout. The failure has nothing to do with API 24, x86, the emulator, or RN 0.86/New Architecture
rejecting anything: it's a Windows path-length limit in `react-native-reanimated`'s native
(CMake/ninja) build, independent of which AVD or ABI is targeted. The log shows repeated CMake
warnings for the `arm64-v8a` variant:

```
CMake Warning in CMakeLists.txt:
  The object file directory
    D:/.../.claude/worktrees/wf_029f7387-dd1-1/EasyMod-mobile/node_modules/react-native-reanimated/android/.cxx/Debug/724n3c55/arm64-v8a/CMakeFiles/reanimated.dir/./
  has 180 characters. The maximum full path to an object file is 250
  characters (see CMAKE_OBJECT_PATH_MAX). Object file
    .../Common/cpp/reanimated/CSS/interpolation/styles/AnimationStyleInterpolatorFactory.cpp.o
  cannot be safely placed under this directory.
...
ninja: error: manifest 'build.ninja' still dirty after 100 tries
```

**Root cause: the git worktree checkout path itself is too deep for Windows' path-length limits
once `reanimated`'s `.cxx`/CMake object-file paths are appended on top of it.** This workstation
checks every branch out under `D:/easymod/easy-moderator/.claude/worktrees/<worktree-id>/...`
(`easymod-worktrees` note) — that prefix alone is long before `EasyMod-mobile/node_modules/...` is
even appended, and `reanimated`'s native build nests several more nested directory levels
(`android/.cxx/Debug/<hash>/<abi>/CMakeFiles/reanimated.dir/...`) on top of that. Gradle's default
`assembleDebug` also builds all four ABIs (`arm64-v8a`/`armeabi-v7a`/`x86`/`x86_64`) rather than
just the emulator's `x86`, so this is not gated by API level or emulator choice at all — the same
failure would very likely reproduce against the API-37 AVDs too, and switching AVDs is **not** a
fix for this specific failure (unlike the ABI-incompatibility scenario this doc originally
anticipated). **Net: the emulator itself is proven good (boots, hardware-accelerated, correct
`.dev` manifest/package), but no debug APK was ever produced, so nothing was installed, and the
cold-start perf budget in `MOBILE_PRODUCT_SPEC.md` §4 is explicitly UNVERIFIED — confirmed blocked
by this path-length issue, not confirmed passing or failing on its own merits.**

Whoever picks this up next has three independent remediation paths, none attempted in this
time-boxed lane: (1) enable Windows NTFS long-path support machine-wide
(`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled=1`, requires admin + reboot)
and confirm CMake/ninja actually honor it on this Windows build (not guaranteed — `CMAKE_OBJECT_PATH_MAX`
is a CMake-level guard, not just an OS one); (2) build from a shallower checkout path for local
Android dev work instead of the nested `.claude/worktrees/<id>/` layout (e.g. a short-path clone
dedicated to mobile native builds); or (3) restrict the build to one ABI via
`-PreactNativeArchitectures=x86` (matching the emulator) to shave a few path-length characters and
skip compiling the other three ABIs — worth trying first since it's the cheapest, but may not be
sufficient on its own given how much of the 250-character budget the worktree prefix alone
consumes. This is the first time this program has attempted a native build against the API-24
target, and it surfaced a real Windows-worktree environment constraint that will affect every
future native Android build from this checkout layout, not just this AVD — worth flagging to
whoever owns workstation/CI environment setup, independent of this lane.

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
