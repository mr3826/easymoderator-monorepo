# ADR-M-013: Release Signing on `main`, R8, and Mobile CI After Integration

Status: Accepted<br>
Date: 2026-09-26<br>
Owners: Mobile Program Orchestrator (upload-key creation approved by the owner, 2026-09-26)

Amends ADR M-009 (mobile CI isolation). Implements plan items M-5/M-6 (release build, signing policy).

## Context

- Wave 2.5 was complete on `feature/mobile-app`, but every Android build was signed with the Android
  debug certificate and marked `NOT_DISTRIBUTABLE`. No signing identity existed anywhere: no keystore,
  no EAS/Expo account or `EXPO_TOKEN`, no GitHub signing secret. The app has never been published to
  Google Play (no listing for `tech.easymod.merchant` or `.preview`).
- ADR M-009 assumed a later EAS build path. Creating an Expo account is an external-account decision
  that nobody has made, so that path is unavailable.
- R8 was off in every release build (`MOBILE_AUDIT.md`, "Known limitations").
- The mobile program is joining `main`. ADR M-009's rule "mobile CI never runs against main" was about
  a workflow on an unprotected integration branch reaching secrets or a deployment environment. Once
  mobile lives on `main`, its pull requests target `main`.

## Decision

### Upload key

- One RSA-4096 key (PKCS12, alias `easymod-upload`, SHA256withRSA, valid until 2054-02-10) was
  generated on 2026-09-25 and written directly into the GitHub environment **`mobile-release`** as two
  secrets: `ANDROID_UPLOAD_KEYSTORE_BASE64` and `ANDROID_UPLOAD_KEYSTORE_PASSWORD`.
- No copy was kept anywhere else (owner decision). The local files were deleted after upload.
- The environment's deployment branch policy admits **`main` only**, so no pull-request or
  feature-branch run can receive the key.
- The public metadata (DN, SHA-256/SHA-1 fingerprints, serial number, validity) is committed in
  `EasyMod-mobile/release-signing.json`. The pinned certificate SHA-256 is
  `9d8e323ca0fd9a2bc174b957e631e492c1919443c251872df587b11f046a382b`.
- When the app is enrolled in Play App Signing, this key becomes the **upload key**; Google holds the
  app signing key.

### Signing pipeline

`.github/workflows/mobile-release.yml` runs for pushes to `main` that change `EasyMod-mobile/`:

1. It builds the `preview` APK and AAB for all four ABIs with R8, **without** any secret in the
   environment.
2. Only the step named "Sign with the upload key" receives the two secrets.
   `scripts/sign-android-release.sh` re-signs the APK with `apksigner` (v2 + v3, one signer, zip
   alignment preserved). It strips Gradle's debug JAR signature from the AAB and signs it once with
   `jarsigner`. If key material is missing, the step fails; there is no debug-signing fallback.
3. `scripts/verify-android-artifact.js --expect-signer <pinned SHA-256>` fails unless both the APK and
   the AAB are signed by exactly that certificate. It also re-checks:
   - all four ABIs;
   - the manifest flags;
   - blocked permissions;
   - 16 KB page alignment;
   - that the R8 mapping exists.
4. The signed APK is installed and cold-launched on an API 24 emulator.
5. Only then is `mobile-release-<sha>` uploaded: APK, AAB, manifest, mapping and `SHA256SUMS`.

The version code is `git rev-list --count HEAD`, which is monotonic on `main` and reproducible per SHA.
The version name is `EasyMod-mobile/package.json`'s `version`.

Keeping the key out of the build step means the npm install scripts and the Gradle and Expo plugins
never run while the key exists.

### Fail-closed controls

- The release verifier treats an artifact as `DISTRIBUTABLE` only when the pinned signer matches.
  Without `--expect-signer`, every artifact is recorded as `NOT_DISTRIBUTABLE`.
- On every mobile PR, Mobile CI's `android-release` job:
  - proves that a debug-signed build fails release verification (a negative control);
  - runs the same signing script with a throwaway CI-generated key (never a release key);
  - installs the re-signed APK.
- `verify-mobile-ci-isolation.js` now also pins `mobile-release.yml`'s shape:
  - push to `main` is the only trigger;
  - `contents: read`;
  - the job is bound to the `mobile-release` environment;
  - only the two upload-key secrets, and only in the signing step;
  - no GitHub-release, store or other distribution step.

### R8

`expo-build-properties` enables `enableMinifyInReleaseBuilds` and `enableShrinkResourcesInReleaseBuilds`
for every release build. That includes the release-mode development build that the Maestro E2E job
runs, so every device flow exercises minified code. No project keep rules were added:

- React Native, Expo modules and the other native dependencies ship consumer rules;
- the template keeps its Reanimated/TurboModule rules.

### Mobile CI on `main` (amends M-009)

- `mobile-ci.yml` validates pull requests **into `main`** that touch any of:
  - the mobile app;
  - `docs/mobile/`;
  - the dedicated backend modules (`modules/mobile`, `modules/auth/native`, the mobile client-context
    middleware);
  - the mobile workflows and scripts.
- It also validates pushes to `mobile/**` branches. It never runs for a push to `main`.
- It still carries no secret, no environment and no `workflow_dispatch`; the guard enforces this.
- `main`'s required checks (`PR Merge Gate`, `Security Scan`) keep covering every PR, including the
  backend suites that exercise the shared auth middleware.
- `feature/mobile-app` is retired once this integration merges. Mobile work branches from `main`.

### Distribution

No automated distribution. The established channel is internal QA sideloading of the signed `preview`
APK (plan §12) from the `mobile-release-<sha>` artifact. Google Play or EAS submission needs its own
owner decision and credentials, and is deliberately outside `mobile-release.yml`.

## Rotation, recovery and compromise response

| Situation | Before Play enrollment | After Play App Signing enrollment |
|---|---|---|
| Key lost | Generate a new key with the same procedure, replace both secrets, update `release-signing.json` in a PR. Testers uninstall and reinstall once (signature change). | Request an upload-key reset in Play Console, register the new upload certificate, then rotate as on the left. The app signing key (Google's) is unaffected. |
| Key suspected compromised | Delete both secrets at once (`gh secret delete … --env mobile-release`). Release builds then fail closed. Rotate as above. | Same, plus the Play upload-key reset. |
| Planned rotation | Same procedure as a lost key. | Play Console upload-key reset. |

- GitHub secrets cannot be read back. Moving signing to EAS later means creating a new upload key there,
  not exporting this one.
- Key generation, for the record (run by whoever rotates, never committed):
  `keytool -genkeypair -storetype PKCS12 -alias easymod-upload -keyalg RSA -keysize 4096 -sigalg SHA256withRSA -validity 10000`.
  The password is read from an environment variable (`-storepass:env`). Upload with
  `gh secret set … --env mobile-release` from stdin.

## Consequences

- Positive:
  - Distributable, verifiable release artifacts exist.
  - A debug-signed or foreign-signed artifact cannot be recorded as distributable.
  - The key never meets pull-request code, never meets third-party build scripts, and never leaves
    GitHub.
- Negative:
  - Anyone who can merge a workflow change to `main` could exfiltrate the key. `main` requires a
    pull request, and the guard and review cover `mobile-release.yml`. The residual risk is the same
    as for every repository secret.
  - The environment has no required reviewer, so releases need no manual approval click. The owner
    can add one later without changing the workflow.
  - There is no offline backup of the key (owner decision). Recovery is by rotation, which is cheap
    before Play enrollment and a Play Console reset after it.
