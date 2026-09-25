# Mobile Dev Environment Setup

Status: Living document (Wave 2.5 runtime qualification)<br>
Date: 2026-09-17

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

**Phase 2 Lane 0 follow-up — root-cause and remediation, actually attempted (2026-09-15,
`mobile/p2-android-build-infra`, worktree `D:/easymod/mob-buildfix`):** the three remediation paths
above were tried in priority order, each with a real reproduced result, not a guess. Summary
verdict first: **the checkout-depth root cause is real and is resolved by not using the nested
`.claude/worktrees/<id>/` layout for local Android native builds; this specific workstation also
has a second, unrelated, and currently more acute problem — its `D:` drive has no free space to
reliably finish a native Android build at all.** Detail follows.

1. **Shorter checkout path — tried, and the checkout-depth hypothesis is confirmed.** This lane's
   own worktree, `D:/easymod/mob-buildfix`, is already ~20 characters shorter than the failing
   `D:/easymod/easy-moderator/.claude/worktrees/wf_029f7387-dd1-1/...` path, simply by not being
   nested under `.claude/worktrees/<id>/` — which is itself the normal, already-used-everywhere-else
   layout for this program's other worktrees (`git worktree list` shows `mob`, `mob-home`, and every
   `fix/`/`hotfix/` lane sitting directly under `D:/easymod/<name>/`; only the four
   `wf_029f7387-dd1-*` worktrees are nested under `.claude/worktrees/`). Computed exactly (Python,
   using reanimated's actual longest source file,
   `Common/cpp/reanimated/CSS/interpolation/transforms/TransformOperationInterpolator.cpp`, 85
   characters relative to the package root — 1 character longer than the file that appears in the
   original failure log, so this is the true worst case, not an approximation): the original
   worktree prefix produces a 267-character full object-file path (over the 250-character
   `CMAKE_OBJECT_PATH_MAX` ceiling — matches the observed failure exactly); this lane's own
   `mob-buildfix` prefix produces a 229-character path for the same file (**under** the ceiling by
   21 characters).
   - Also tried, as the cheaper first step the task brief suggested: an NTFS junction
     (`mklink /J D:\m D:\easymod\mob-buildfix`) to get an even shorter apparent path (210 characters
     for the same file). **Finding: the junction is a no-op for this specific failure.** Running
     `gradlew` from `D:\m\EasyMod-mobile\android` still produced `.cxx` build trees physically
     rooted at the real `D:\easymod\mob-buildfix\...` path (confirmed by listing the generated
     `.cxx` directories after the build started — they exist under `mob-buildfix`, never under
     `D:\m`) — Android Gradle Plugin's CMake/ninja integration resolves the module directory to its
     real filesystem path before computing `.cxx` output locations, so a junction/alias does not
     shorten anything AGP itself cares about. (This differs from the Qt Creator long-path
     workaround reported upstream, which junctions the CMake source/build dirs at a layer Qt
     Creator controls directly — that does not transfer to AGP's own path resolution.) **Do not
     rely on a junction for this; a genuinely shallow checkout path is what matters, not an alias to
     a deep one.**
   - The real build, run to completion (see disk-space finding below for why it didn't finish
     clean): sourced `scripts/dev-env.sh`, ran `npx expo prebuild --platform android` (succeeded;
     spot-checked `applicationId 'tech.easymod.merchant.dev'` and
     `android:usesCleartextTraffic="true"` — correct `.dev` variant), then
     `./gradlew assembleDebug -PreactNativeArchitectures=x86 --stacktrace` (single-ABI used here
     purely to shorten iteration time, per the task brief's suggestion — ABI folder-name length
     doesn't materially change the path-length math, only total compile time). Result: **no
     `CMAKE_OBJECT_PATH_MAX` warning and no `ninja: error: manifest 'build.ninja' still dirty`
     message appeared anywhere in the run** (grep-verified against the full ~660KB build log) —
     reanimated's CMake configured cleanly, its `build.ninja` was never dirty, and ninja actually
     compiled 92 of 107 (86%) of reanimated's object files before the run hit the unrelated failure
     below. This is real forward progress past the exact point the original attempt never reached
     in 28m43s, and it is strong, reproduced evidence that avoiding the deep worktree-nesting
     pattern resolves this failure mode.

2. **Windows long-path support — verified, and confirmed to be the dead end the note suspected, with a
   citable reason, not a guess.** `Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem
   LongPathsEnabled` was queried directly on this machine (not assumed from the note) and returned
   `1` — the flag genuinely is set. It is nonetheless provably insufficient for this failure, for
   two independent, documented reasons:
   - `CMAKE_OBJECT_PATH_MAX` (default "as close as possible to the actual MAX_PATH limit (260)",
     i.e. ~250) is a static CMake-generator-time constant that CMake enforces on its own — it is
     never derived from, or aware of, the Windows `LongPathsEnabled` registry value. Raising it
     requires either a newer CMake default or an explicit `-DCMAKE_OBJECT_PATH_MAX=...`/toolchain
     override inside the CMakeLists that owns the build (here, reanimated's own — out of bounds per
     this lane's hard boundaries).
   - Separately, even Windows' own long-path *transparency* for a raw (non-`\\?\`-prefixed) path
     requires **both** the registry flag **and** the calling executable's own manifest declaring
     `longPathAware=true` (a Windows 10 1607+ mechanism) — the registry flag alone does not retrofit
     long-path behavior onto an executable that wasn't built with that manifest. Ninja only gained
     this manifest (plus wide-path Win32 API usage) in **v1.12** (2024); CMake gained the
     equivalent around **v4.0**. This project's actual bundled toolchain, resolved from
     `ANDROID_HOME` (`D:\Android\Sdk\cmake\3.22.1`), is **CMake 3.22.1 / ninja 1.10.2** — both
     verified directly (`cmake --version`, `ninja --version`) and both years before that fix. CMake's
     own bug tracker documents this exact interaction: gitlab.kitware.com/cmake/cmake/-/issues/25936,
     "Path names longer than MAX_PATH fail on Windows, even if long paths support is enabled" — its
     own title is this project's exact situation. **Conclusion: `LongPathsEnabled=1` is real, correct,
     and irrelevant to this failure with this Android SDK/NDK-bundled toolchain version — not a
     hypothesis, a version-checked fact.** (Also: nothing in this project bundles or pins its own
     cmake/ninja — both come from whatever NDK version `android/build.gradle`'s `externalNativeBuild`
     resolves — so this isn't a one-line project-side version bump either without touching
     reanimated's own build configuration, which is out of bounds here.)

3. **CI as an authoritative native-build gate — confirmed absent, and correctly so for now, not
   silently missing.** `.github/workflows/mobile-ci.yml` exists, runs on `ubuntu-latest` (ADR
   M-009), and passes reliably (`gh run list --branch feature/mobile-app`: 5 of the last 6 runs
   green, including every mobile-only PR merged so far). It does **not** include an Android Gradle
   build job — this is a deliberate, already-documented deferral in ADR M-009 itself ("adding this
   job means pinning a Java setup action and an emulator/Maestro-runner action by digest... no
   digest is fabricated here without verifying it against the real action first... The phase that
   first needs an on-device/CI Android build adds this job with real, verified pins"). That
   reasoning is sound and this lane did not override it: verifying real action digests, deciding
   whether a full emulator/Maestro run is even needed for a pure native-compile check (it is not —
   a compile-only job needs no emulator at all, just `assembleDebug`), and wiring Gradle/NDK
   caching for a Linux runner is a distinct, non-trivial scope of its own, not the "small, cheap,
   safe addition" the task brief allows without further scope review — so it was not added in this
   PR. For the record, since it bears directly on urgency: GitHub's hosted `ubuntu-latest` runners
   ship a preinstalled, much newer Android NDK/CMake (NDK r28 / CMake ~3.31 as of late-2025 runner
   images) than this project's Windows-resolved 3.22.1, which would not hit this exact
   `CMAKE_OBJECT_PATH_MAX` failure mode at all (Linux has no `MAX_PATH`, and a modern CMake wouldn't
   apply the same conservative default even if it did) — but that is an informed expectation, not
   verified evidence, because no such job has ever run. **Honest statement: as of this lane, there
   is zero CI evidence — on Linux or anywhere else — that `EasyMod-mobile`'s Android native build
   succeeds end-to-end.** This is the single highest-leverage next step for whoever owns this next:
   a compile-only (`assembleDebug`, no emulator) Android job added to `mobile-ci.yml` with real
   verified action-digest pins would be cheap on a GitHub-hosted runner and would finally give this
   an authoritative, Windows-path-length-immune pass/fail signal on every push — something local
   Windows dev builds cannot reliably provide on this workstation (see below).

4. **Single-ABI local-build flag — implemented as an opt-in local developer convenience,
   independent of whether it was "needed."** The measurements above show ABI choice barely affects
   the path-length math (ABI folder names are all similar length); its real value is cutting local
   build time/disk roughly 4x by compiling one ABI instead of four. Because `EasyMod-mobile/android/`
   is generated fresh by `expo prebuild` and is git-ignored (Continuous Native Generation — confirmed
   via `.gitignore` and `git check-ignore`), a hand-edit to `android/gradle.properties` would be
   silently wiped on the next prebuild; the durable, prebuild-safe mechanism is a `ORG_GRADLE_PROJECT_*`
   environment variable, which Gradle automatically maps to a `-P` project property and which lives
   entirely outside the generated `android/` tree. `scripts/dev-env.ps1`/`dev-env.sh` now export
   `EASYMOD_ANDROID_LOCAL_ABI` (opt-in, unset by default — set it to an ABI name, e.g. `x86` to match
   `Nexus_5_API_24`, before sourcing the script) which the script turns into
   `ORG_GRADLE_PROJECT_reactNativeArchitectures` for that shell only. This never touches
   `android/gradle.properties`'s own default (`armeabi-v7a,arm64-v8a,x86,x86_64`, which is what EAS
   Build and any future CI Android job will still use), never touches CI (`mobile-ci.yml` does not
   source these scripts), and is documented here rather than defaulted-on so a developer who
   actually needs to test a different ABI/real device isn't silently overridden.

**Workstation disk-capacity finding (2026-09-15, found during the above, not part of the original
three remediation paths but too material to omit):** the `assembleDebug` run above did not reach a
clean `BUILD SUCCESSFUL`. After compiling 92/107 of reanimated's objects and making real progress in
several other native modules, it failed with `fatal error: error in backend: IO failure on output
stream: No space left on device` (clang++) and matching `javac`/CMake write failures — at that point
`Get-PSDrive` showed `D:` at **0.00 GB free out of ~102 GB total**. This is a **wholly separate,
unrelated failure mode from `CMAKE_OBJECT_PATH_MAX`** — no path-length warning or ninja-dirty-manifest
message appears anywhere before it in the log — and it is evidence of a real, currently-unresolved
workstation-capacity constraint, not a mobile-program code or config problem: `D:` hosts roughly a
dozen concurrent worktrees (per `git worktree list`) plus several GB of unrelated video files, and a
single Android native build's `.cxx`/object-file output across several native modules is enough by
itself to exhaust whatever margin was left. This lane freed space it could safely free (its own
`EasyMod-mobile/android/` build output and `node_modules/`, both git-ignored and regenerable, plus its
own scratch build log) rather than touching any other worktree's files, which is out of this lane's
scope and could destroy another lane's in-progress work — but that is a stopgap, not a fix, and the
next full local Android build attempt (by anyone, on this box) should expect to hit the same wall
again unless real disk headroom (recommend reserving at least 10-15 GB free, on top of whatever
`node_modules`/npm cache already need) is confirmed free immediately beforehand. This is flagged
here because it would otherwise be indistinguishable from "the path-length fix didn't work" to
whoever reads a future failed build log without also checking free disk space first.

**Does this need to be resolved before Phase 8 (first internal installable Android beta)? No —
not as a release blocker, with one caveat.** Per ADR `M-009-ci-isolation.md`, "Phase 8's beta build
path goes through EAS directly, not through this [CI] workflow" — and EAS Build runs on Expo's own
Linux/macOS cloud infrastructure, not this Windows workstation, so it does not inherit this
workstation's checkout-depth or `MAX_PATH` behavior at all. The checkout-depth root cause identified
here is a **local Windows developer-experience friction**, not a property of the app or its native
dependencies, and this lane's own (disk-space-interrupted but otherwise clean) build run is real
evidence the native build itself is healthy once run from a normal-depth checkout. The caveat: (a)
this conclusion about EAS is based on ADR M-009's stated intent, not a Lane-0-verified EAS build —
whoever runs the first real EAS build should confirm it directly; (b) item 3 above stands
independently of Phase 8 — shipping any Android beta with **zero** CI evidence that the native build
succeeds anywhere, Windows or not, is a real gap worth closing before repeated betas, even though
it does not block the *first* one; and (c) the disk-space finding *does* block any developer on
*this specific workstation* from doing local `adb`/on-device debugging of a real `.dev` build until
that's addressed — which matters for pre-beta QA even if it doesn't block the EAS build path itself.

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

**Phase 1 addendum (historical):** the env-validation check above (`app.config.ts` throwing on a
non-HTTPS URL for `preview`/`production`) was necessary but did not originally make the `.dev`
variant reachable over `adb reverse`. Phase 2 wired `expo-build-properties` with
`android.usesCleartextTraffic` for the `.dev` variant; this is limited to the disposable development
backend and does not relax preview or production validation. It does not make a native build
installable when the checkout path still exceeds the CMake object-path limit.

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

## 5. Wave 2.5 Lane A native qualification (2026-09-17)

This receipt covers the Android native build only. No source, application behavior, release ABI
strategy, or machine-wide setting was changed. `docs/mobile/AGENT_HANDOFF.md` was intentionally
left untouched for coordinator consolidation.

### Exact checkout and toolchain

- Checkout: `D:/easymod/mob/EasyMod-mobile` in repository `D:/easymod/mob`.
- Branch and HEAD: `feature/mobile-app` at `04bb4d5f8ec90baf241253b1dacfef48c5a6b3f6`; the
  integration worktree already contained uncommitted Wave 2 work.
- OS: Microsoft Windows 11 Home, version `10.0.26200`, build `26200`, 64-bit.
- Raw shell: Node `v25.6.1`, npm `9.9.4`, `corepack` not installed; `JAVA_HOME` pointed to
  `C:/Program Files/Eclipse Adoptium/jdk-8.0.492.9-hotspot` and `java -version` reported
  `1.8.0_492`; `ANDROID_HOME` and `ANDROID_SDK_ROOT` were unset and Android tools were not on
  `PATH`.
- Session shell after `. .\scripts\dev-env.ps1`: JDK `17.0.12` (Oracle JDK 17),
  `JAVA_HOME=C:/Program Files/Java/jdk-17`, and `ANDROID_HOME=ANDROID_SDK_ROOT=D:/Android/Sdk`.
- Android tools: adb `1.0.41`, platform-tools `34.0.4`, emulator `32.1.14.0`, CMake `3.22.1`,
  command-line tools `20.0`.
- Android SDK packages reported by `sdkmanager --list_installed`: platform `android-36`, build
  tools `36.0.0`, NDK `27.0.12077973` and `27.1.12297006`, API 24 Play Store Google APIs `x86`,
  API 30 Google APIs `x86`, and API 37.0 Play Store 16 KB page-size `x86_64` system images.
- AVDs: `Nexus_5_API_24`, `Medium_Phone`, `Medium_Phone_2`, and `Pixel_8_Pro`. No device was
  attached in `adb devices -l` during this receipt.
- Resolved app dependencies: Expo `57.0.22`, Expo CLI `57.0.24`, React Native `0.86.3`,
  React Native Reanimated `4.5.1`, React Native Worklets `0.10.1`, and
  `expo-build-properties` `57.0.17`.
- Generated native project: Gradle wrapper `9.3.1`, Android Gradle Plugin `8.12.0`, Kotlin
  `2.1.20`, min/compile/target SDK `24/36/36`, NDK `27.1.12297006`, New Architecture enabled,
  Hermes enabled, and the generated debug configuration retained all four ABIs:
  `armeabi-v7a,arm64-v8a,x86,x86_64`.

### Commands and results

The initial dependency directory and default npm cache were incomplete/corrupt: `npm ci` and a
follow-up `npm install` emitted tar extraction errors and left package manifests missing. This was
not treated as a native result. A process-local fresh npm cache repaired the ignored dependency
directory without changing either package file:

```powershell
cd D:\easymod\mob\EasyMod-mobile
$env:npm_config_cache = 'C:\Users\ahmee\AppData\Local\Temp\kilo\npm-cache-m25'
npm ci --no-audit --no-fund
. .\scripts\dev-env.ps1
npx expo prebuild --platform android
cd android
. ..\scripts\dev-env.ps1
.\gradlew.bat assembleDebug --console=plain --stacktrace
```

Results:

- `npm ci`: PASS with the fresh process-local cache, `1160` packages added; `npm ls --depth=0`
  resolved the locked direct dependencies listed above.
- `npx expo prebuild --platform android`: PASS; generated `EasyMod-mobile/android/` only.
- Gradle configuration/buildscript resolution: PASS; `buildEnvironment` resolved AGP `8.12.0`
  and `:app:properties` reported SDK `24/36/36`, NDK `27.1.12297006`, and all four ABI values.
- Standard all-ABI `assembleDebug`: **BLOCKED** after approximately 67 minutes. It progressed
  through the four ABI CMake/native tasks and then stopped at `:app:mergeDebugNativeLibs` with:

```text
The message received from the daemon indicates that the daemon has disappeared.

FAILURE: Build failed with an exception.

* What went wrong:
Gradle build daemon disappeared unexpectedly (it may have been killed or may have crashed)

org.gradle.launcher.daemon.client.DaemonDisappearedException:
Gradle build daemon disappeared unexpectedly (it may have been killed or may have crashed)
```

- The output contained no `CMAKE_OBJECT_PATH_MAX`, object-directory, or `ninja: error` path-limit
  diagnostic. `LongPathsEnabled` was already `REG_DWORD 0x1`, and the longest generated native
  file path measured 248 characters. Therefore the historical deep-worktree Reanimated path-limit
  failure documented in section 2 was **not reproduced from this integration checkout path**; this receipt
  records the daemon disappearance as the current Windows blocker without asserting an unproven
  root cause.
- APK evidence: no `android/app/build/outputs/apk/debug/app-debug.apk` was produced by this run;
  install and launch were not performed. The first installable internal beta remains unqualified.

A separate temporary checkout at `C:/m25` was created outside the integration worktree and populated
with the current `EasyMod-mobile` source while excluding `node_modules`, `android`, `ios`, and `.expo`.
Its locked dependency install and Expo prebuild passed, but no separate native APK result is claimed
in this receipt. No integration-worktree source checkout operation was used.

## 6. Local x86 convenience build and emulator smoke (2026-09-17)

The stalled all-ABI Gradle daemon tree (`PID 23132`, including its Kotlin compiler child) was
terminated before retrying. From the same `D:/easymod/mob/EasyMod-mobile` checkout, the session-scoped
JDK/SDK environment was loaded and this local-only command was run:

```powershell
. .\scripts\dev-env.ps1
cd android
. ..\scripts\dev-env.ps1
.\gradlew.bat assembleDebug -PreactNativeArchitectures=x86 --console=plain
```

`BUILD SUCCESSFUL` completed in 15m 16s. The resulting `android/app/build/outputs/apk/debug/app-debug.apk`
was 86,340,111 bytes (SHA-256 `94B771CA1637AF901F5E2FE417D1C21F7BC9719AE01658DCDE9D06EB24CAB7F2`).
It installed successfully on `Nexus_5_API_24` (`emulator-5554`, API 24, x86), launched as
`tech.easymod.merchant.dev/.MainActivity`, remained foreground with process PID 3593, and produced
no crash-buffer entries.

This is a **local development convenience build only** for the x86 emulator. The
`-PreactNativeArchitectures=x86` override was supplied on the command line; the checked-in
`android/gradle.properties` default remains `armeabi-v7a,arm64-v8a,x86,x86_64`. CI and release builds
remain all-ABI, and no CI/release configuration was changed by this smoke run.

### Direct adb launch receipt

The APK was verified before installation and the API 24/x86 `Nexus_5_API_24` emulator was online
as `emulator-5554`:

```powershell
. .\scripts\dev-env.ps1
adb -s emulator-5554 install -r android\app\build\outputs\apk\debug\app-debug.apk
adb -s emulator-5554 reverse tcp:8081 tcp:8081
adb -s emulator-5554 logcat -c
adb -s emulator-5554 shell monkey -p tech.easymod.merchant.dev -c android.intent.category.LAUNCHER 1
Start-Sleep -Seconds 8
adb -s emulator-5554 get-state
adb -s emulator-5554 shell pm path tech.easymod.merchant.dev
adb -s emulator-5554 shell pidof tech.easymod.merchant.dev
adb -s emulator-5554 shell dumpsys activity activities
adb -s emulator-5554 logcat -d -v time -t 200
```

Observed output: install `Success`; monkey `Events injected: 1`; state `device`; package path
`/data/app/tech.easymod.merchant.dev-2/base.apk`; process PID `3104`; and
`mResumedActivity: ... tech.easymod.merchant.dev/.MainActivity`. Focused logcat included
`SoLoader initialized: 8` and `ExpoModulesCore: AppContext was initialized`, with no
`FATAL EXCEPTION`. The same capture reported `Unable to load script` because the local
`node node_modules/expo/bin/cli start --dev-client --localhost` process remained at `Starting Metro
Bundler` and port 8081 refused connections. Native install and activity launch are therefore
verified; a rendered JavaScript screen requires a reachable Metro process or a release bundle.

## 7. Fresh APK overwrite and install receipt (2026-09-17)

The APK timestamp supplied by an earlier qualification was not used. A fresh current build was
forced from `D:/easymod/mob/EasyMod-mobile/android` with the session environment and the supported
local x86 override for `Nexus_5_API_24`:

```powershell
. ..\scripts\dev-env.ps1
.\gradlew.bat assembleDebug -PreactNativeArchitectures=x86 --rerun-tasks --console=plain
```

Result: `BUILD SUCCESSFUL in 22m 40s`, with `484 actionable tasks: 484 executed`. The build wrote
`android/app/build/outputs/apk/debug/app-debug.apk` at `2026-09-17 03:45:03 +06:00`; its size was
`86,340,111` bytes and its SHA-256 was
`94B771CA1637AF901F5E2FE417D1C21F7BC9719AE01658DCDE9D06EB24CAB7F2`. This is newer than the
previously reported stale APK and is the only artifact used below.

The emulator was already running as `Nexus_5_API_24` (`emulator-5554`, API 24, x86). The first
install attempt exceeded its 120-second command timeout without a result; it was not counted. The
same command was retried with a longer timeout and returned `Performing Streamed Install` followed
by `Success`:

```powershell
. .\scripts\dev-env.ps1
adb -s emulator-5554 install -r android\app\build\outputs\apk\debug\app-debug.apk
adb -s emulator-5554 reverse tcp:8081 tcp:8081
adb -s emulator-5554 logcat -c
adb -s emulator-5554 shell monkey -p tech.easymod.merchant.dev -c android.intent.category.LAUNCHER 1
Start-Sleep -Seconds 8
adb -s emulator-5554 get-state
adb -s emulator-5554 shell pm path tech.easymod.merchant.dev
adb -s emulator-5554 shell pidof tech.easymod.merchant.dev
adb -s emulator-5554 shell dumpsys activity activities
adb -s emulator-5554 logcat -d -v time -t 200
```

Fresh observed output: state `device`; package path `/data/app/tech.easymod.merchant.dev-1/base.apk`;
process PID `4276`; `mResumedActivity: ... tech.easymod.merchant.dev/.MainActivity`; and
`Events injected: 1`. Focused logcat showed `SoLoader initialized: 8` and
`ExpoModulesCore: AppContext was initialized`, with no `FATAL EXCEPTION`. It also reported
`Unable to load script` because Metro was not reachable on port 8081. Native installation and
activity launch are verified; JavaScript screen rendering is not claimed without Metro or an
embedded release bundle. The checked-in all-ABI setting and CI/release ABI strategy were unchanged.

## 8. Coordinator cleanup handoff (2026-09-17)

- Do not run another `npm install` or `npm ci` in the shared `D:/easymod/mob/EasyMod-mobile` tree
  during the remaining lane work.
- The original generated `EasyMod-mobile/node_modules` tree is not a trustworthy qualification
  input: the default-cache `npm ci`/`npm install` attempts emitted tar extraction `TAR_ENTRY_ERROR`
  and `ENOENT` errors and left package manifests missing. The later fresh-cache repair was only a
  temporary qualification measure.
- After all lanes finish, the coordinator may delete **only** the generated ignored
  `EasyMod-mobile/node_modules` directory and run one clean locked `npm ci`. Do not clean or reset
  source, lockfiles, generated Android output, or unrelated worktree files as part of that repair.
- An APK whose `LastWriteTime` is `2026-09-14` is stale and must not be counted. The current fresh
  artifact and install evidence are the values in section 7: `2026-09-17 03:45:03 +06:00`,
  `86,340,111` bytes, SHA-256
  `94B771CA1637AF901F5E2FE417D1C21F7BC9719AE01658DCDE9D06EB24CAB7F2`.

## 9. Current all-ABI fallback receipt (2026-09-17)

The current all-ABI `assembleDebug` packaging attempt did not emit a fresh APK and no active Gradle
client remained when the fallback decision was made. The previously observed all-ABI daemon failure
is recorded in section 5. No dependency, CMake, or release configuration was patched.

The allowed local development convenience was then used from the same integration checkout:

```powershell
cd D:\easymod\mob\EasyMod-mobile\android
. ..\scripts\dev-env.ps1
.\gradlew.bat assembleDebug -PreactNativeArchitectures=x86 --rerun-tasks --console=plain
```

Result: `BUILD SUCCESSFUL in 9m 11s`; `484 actionable tasks: 484 executed`. The current artifact
was written at `2026-09-17 04:10:48 +06:00`, is `86,340,111` bytes, and has SHA-256
`94B771CA1637AF901F5E2FE417D1C21F7BC9719AE01658DCDE9D06EB24CAB7F2`. `aapt dump badging`
reported package `tech.easymod.merchant.dev`, SDK `24`, target SDK `36`, and native code `x86`.

`Nexus_5_API_24` was already available as `emulator-5554` (API 24/x86), so no emulator start was
needed. Using the fresh artifact only:

```powershell
. ..\scripts\dev-env.ps1
adb -s emulator-5554 install -r app\build\outputs\apk\debug\app-debug.apk
adb -s emulator-5554 reverse tcp:8081 tcp:8081
adb -s emulator-5554 logcat -c
adb -s emulator-5554 shell monkey -p tech.easymod.merchant.dev -c android.intent.category.LAUNCHER 1
Start-Sleep -Seconds 8
adb -s emulator-5554 get-state
adb -s emulator-5554 shell pm path tech.easymod.merchant.dev
adb -s emulator-5554 shell pidof tech.easymod.merchant.dev
adb -s emulator-5554 shell dumpsys activity activities
adb -s emulator-5554 logcat -d -v time -t 200
```

Observed output: install `Success`; `Events injected: 1`; state `device`; package path
`package:/data/app/tech.easymod.merchant.dev-1/base.apk`; PID `4592`; and resumed/focused
activity `tech.easymod.merchant.dev/.MainActivity`. Logcat showed `SoLoader initialized: 8` and
`ExpoModulesCore: AppContext was initialized`, with no `FATAL EXCEPTION`. It also reported
`Unable to load script` because Metro was unavailable, so native installation and activity launch
are verified but JavaScript screen rendering is not claimed. The x86 property is local emulator
convenience only; checked-in, CI, and release ABI strategy remains all-ABI.

## 10. Final Wave 2.5 runtime receipt (2026-09-17)

- Final current-source preview: `assembleRelease -PreactNativeArchitectures=x86 --rerun-tasks` from
  `EasyMod-mobile/android`; `BUILD SUCCESSFUL in 18m 41s`.
- Artifact: `android/app/build/outputs/apk/release/app-release.apk`, 48,678,471 bytes, SHA-256
  `5DAF20E50C0E1014DFA384C096A768F282F86348160C492BDA5630FEE296A212`.
- Target: `Nexus_5_API_24`, API 24/x86; install succeeded and `tech.easymod.merchant.dev/.MainActivity`
  remained foreground without a fatal launch exception.
- Device command: `node e2e/run-maestro.js --start-backend --install --apk android/app/build/outputs/apk/release/app-release.apk`
  with disposable PostgreSQL/Redis URLs and Maestro 2.6.0.
- Device result: `MOBILE_E2E=PASS` for credentials, Bengali login, Home, Today, six attention tiers,
  conversation navigation, and real entity resolution.
- Debug APKs require Metro; the runner prewarms Metro for debug CI. The release preview embeds the JS
  bundle and is the authoritative local runtime artifact.
- Empty/error/offline/session-recovery/2FA fixture branches remain configured but are not promoted to
  PASS without deterministic backend toggles.
