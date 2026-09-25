#!/usr/bin/env node
'use strict';

/**
 * Verifies an Android release build and writes its artifact manifest (plan M-6):
 *
 *   node scripts/verify-android-artifact.js --apk <apk> [--aab <aab>] --package <id> \
 *     --abis armeabi-v7a,arm64-v8a,x86,x86_64 --out <dir> \
 *     [--mapping <R8 mapping.txt>] [--expect-signer <release certificate SHA-256>]
 *
 * Fails (exit 1) unless every requested ABI ships the React Native/Hermes native
 * libraries in the APK (and AAB), the package id matches, the manifest is not
 * debuggable, does not allow cleartext traffic and disables backup, no blocked
 * permission is requested, native libraries are 16 KB page-aligned, and the APK (and
 * AAB) verify with exactly one signer. `--mapping` requires a non-empty R8 mapping file
 * (the build was minified). An artifact is DISTRIBUTABLE only when `--expect-signer` is
 * given and both the APK and the AAB are signed by that certificate; with
 * `--expect-signer`, any other signer (the debug certificate included) fails the run.
 * Without it the artifact is recorded as NOT_DISTRIBUTABLE. Dependency-free: unzip, the
 * JDK and Android build-tools.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Bad argument near "${key}"`);
    options[key.slice(2)] = value;
  }
  for (const required of ['apk', 'package', 'abis', 'out']) {
    if (!options[required]) throw new Error(`--${required} is required`);
  }
  return options;
}

function buildTool(name) {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error('ANDROID_HOME is not set');
  const root = path.join(sdk, 'build-tools');
  const versions = fs.readdirSync(root).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const version of versions.reverse()) {
    const candidate = path.join(root, version, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`${name} not found under ${root}`);
}

// Permissions the app never uses; app.config.ts `android.blockedPermissions` removes them.
const FORBIDDEN_PERMISSIONS = [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
];

// Windows can only spawn a .bat build tool (apksigner.bat) through cmd.exe; CI runs on Linux.
const run = (command, args) => (process.platform === 'win32' && command.endsWith('.bat')
  ? execFileSync('cmd.exe', ['/d', '/s', '/c', command, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  : execFileSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const zipEntries = (file) => run('unzip', ['-Z1', file]).split('\n').filter(Boolean);
const normalizeDigest = (value) => (value || '').replace(/[^0-9a-f]/gi, '').toLowerCase();

function jdkTool(name) {
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  const candidate = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', executable) : null;
  return candidate && fs.existsSync(candidate) ? candidate : executable;
}

/**
 * The AAB's JAR signers. jarsigner checks integrity (without -strict, which rejects every
 * self-signed certificate, i.e. every Android signing key); keytool lists each signer.
 */
function readBundleSigners(aab) {
  let verified = false;
  try {
    verified = /jar verified/.test(run(jdkTool('jarsigner'), ['-verify', aab]));
  } catch (_error) {
    verified = false;
  }
  const printed = run(jdkTool('keytool'), ['-printcert', '-jarfile', aab]);
  const signers = printed.split(/Signer #\d+:/).slice(1).map((block) => ({
    dn: ((block.match(/Owner: (.+)/) || [])[1] || '').trim() || null,
    sha256: normalizeDigest((block.match(/SHA256: ([0-9A-F:]+)/i) || [])[1]),
  }));
  return { verified, signers };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const abis = options.abis.split(',').map((abi) => abi.trim()).filter(Boolean);
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };

  const apkEntries = zipEntries(options.apk);
  for (const abi of abis) {
    for (const library of ['libreactnative.so', 'libhermesvm.so']) {
      const matches = apkEntries.some((entry) => entry === `lib/${abi}/${library}`)
        || (library === 'libhermesvm.so' && apkEntries.some((entry) => entry.startsWith(`lib/${abi}/libhermes`)));
      check(matches, `APK is missing lib/${abi}/${library}`);
    }
  }
  const apkAbis = [...new Set(apkEntries.filter((e) => e.startsWith('lib/')).map((e) => e.split('/')[1]))].sort();
  check(apkAbis.every((abi) => abis.includes(abi)), `APK ships unexpected ABIs: ${apkAbis.join(', ')}`);

  let aabAbis = null;
  if (options.aab) {
    const aabEntries = zipEntries(options.aab);
    aabAbis = [...new Set(aabEntries.filter((e) => e.startsWith('base/lib/')).map((e) => e.split('/')[2]))].sort();
    for (const abi of abis) {
      check(aabEntries.some((e) => e === `base/lib/${abi}/libreactnative.so`), `AAB is missing base/lib/${abi}/libreactnative.so`);
    }
  }

  const aapt2 = buildTool(process.platform === 'win32' ? 'aapt2.exe' : 'aapt2');
  const badging = run(aapt2, ['dump', 'badging', options.apk]);
  const field = (pattern) => (badging.match(pattern) || [])[1] || null;
  const packageName = field(/package: name='([^']+)'/);
  const versionCode = field(/versionCode='([^']+)'/);
  const versionName = field(/versionName='([^']*)'/);
  const minSdk = field(/(?:minSdkVersion|sdkVersion):'([^']+)'/);
  const targetSdk = field(/targetSdkVersion:'([^']+)'/);
  const nativeCode = field(/native-code: (.+)/);
  check(packageName === options.package, `package is ${packageName}, expected ${options.package}`);
  check(!/application-debuggable/.test(badging), 'APK is debuggable');
  const permissions = [...badging.matchAll(/uses-permission: name='([^']+)'/g)].map((match) => match[1]).sort();
  for (const permission of FORBIDDEN_PERMISSIONS) {
    check(!permissions.includes(permission), `APK requests ${permission} (blocked in app.config.ts)`);
  }

  const manifestTree = run(aapt2, ['dump', 'xmltree', '--file', 'AndroidManifest.xml', options.apk]);
  // Boolean application attributes: aapt2 prints `android:allowBackup(0x01010280)=false`; older
  // aapt printed `=(type 0x12)0x0`. Anything else (absent, or a resource reference) is null.
  const attribute = (name) => {
    const match = manifestTree.match(
      new RegExp(`android:${name}\\(0x[0-9a-f]+\\)=(?:(true|false)\\b|\\(type 0x12\\)(0x[0-9a-f]+))`, 'i'),
    );
    if (!match) return null;
    return match[1] !== undefined ? match[1] === 'true' : match[2] !== '0x0';
  };
  const debuggable = attribute('debuggable');
  const cleartext = attribute('usesCleartextTraffic');
  const allowBackup = attribute('allowBackup');
  check(debuggable !== true, 'manifest sets android:debuggable=true');
  check(cleartext !== true, 'manifest allows cleartext traffic (android:usesCleartextTraffic=true)');
  check(allowBackup === false, `manifest android:allowBackup is ${allowBackup}, expected false`);

  // Android 15+ devices with 16 KB memory pages need uncompressed native libraries aligned
  // to 16 KB; re-signing must not undo Gradle's alignment.
  const zipalign = buildTool(process.platform === 'win32' ? 'zipalign.exe' : 'zipalign');
  let pageAligned16k = false;
  try {
    run(zipalign, ['-c', '-P', '16', '4', options.apk]);
    pageAligned16k = true;
  } catch (_error) {
    pageAligned16k = false;
  }
  check(pageAligned16k, 'APK native libraries are not 16 KB page-aligned (zipalign -c -P 16)');

  let mapping = null;
  if (options.mapping) {
    const exists = fs.existsSync(options.mapping);
    const size = exists ? fs.statSync(options.mapping).size : 0;
    mapping = { file: path.basename(options.mapping), size, sha256: exists ? sha256(options.mapping) : null };
    check(size > 0, `R8 mapping ${options.mapping} is missing or empty: the release build was not minified`);
  }

  const apksigner = buildTool(process.platform === 'win32' ? 'apksigner.bat' : 'apksigner');
  let signerDigest = null;
  let signerDn = null;
  let signerCount = null;
  let signatureSchemes = [];
  try {
    const certs = run(apksigner, ['verify', '--print-certs', '-v', options.apk]);
    signerDigest = (certs.match(/certificate SHA-256 digest: ([0-9a-f]+)/) || [])[1] || null;
    signerDn = (certs.match(/certificate DN: (.+)/) || [])[1] || null;
    signerCount = Number((certs.match(/Number of signers: (\d+)/) || [])[1]) || null;
    signatureSchemes = [...certs.matchAll(/Verified using (v[0-9.]+) scheme[^:]*: true/g)].map((match) => match[1]);
  } catch (error) {
    failures.push(`apksigner verify failed: ${error.message.split('\n')[0]}`);
  }
  check(signerCount === 1, `APK has ${signerCount ?? 'no'} signers, expected exactly one`);

  let bundleSigning = null;
  if (options.aab) {
    try {
      bundleSigning = readBundleSigners(options.aab);
    } catch (error) {
      bundleSigning = { verified: false, signers: [], error: error.message.split('\n')[0] };
    }
    check(bundleSigning.verified, 'AAB JAR signature does not verify');
    check(bundleSigning.signers.length === 1, `AAB has ${bundleSigning.signers.length} signers, expected exactly one`);
  }

  const debugSigned = /CN=Android Debug/.test(signerDn || '');
  const expectedSigner = normalizeDigest(options['expect-signer']);
  if (options['expect-signer'] !== undefined) {
    check(expectedSigner.length === 64, '--expect-signer must be a SHA-256 certificate digest');
    check(!debugSigned, 'APK is signed with the Android debug certificate, not the release upload key');
    check(normalizeDigest(signerDigest) === expectedSigner,
      `APK signer ${signerDigest} is not the release upload key ${expectedSigner}`);
    if (bundleSigning) {
      check(bundleSigning.signers.every((signer) => signer.sha256 === expectedSigner),
        `AAB signer(s) ${bundleSigning.signers.map((signer) => signer.sha256).join(', ')} are not the release upload key`);
    }
  }
  const releaseSigned = expectedSigner.length === 64
    && normalizeDigest(signerDigest) === expectedSigner
    && (!bundleSigning || (bundleSigning.signers.length === 1 && bundleSigning.signers[0].sha256 === expectedSigner));
  const signingNote = !signerDn
    ? 'UNVERIFIED: the signing certificate could not be read'
    : debugSigned
      ? 'NOT_DISTRIBUTABLE: signed with the Android debug certificate'
      : !releaseSigned
        ? 'NOT_DISTRIBUTABLE: not signed with the pinned release upload key'
        : null;

  const manifest = {
    sourceSha: process.env.GIT_SHA || process.env.GITHUB_SHA || 'unknown',
    buildProfile: process.env.APP_VARIANT || 'unknown',
    package: packageName,
    versionName,
    versionCode,
    minSdk,
    targetSdk,
    nativeCode,
    permissions,
    requestedAbis: abis,
    apk: { file: path.basename(options.apk), size: fs.statSync(options.apk).size, sha256: sha256(options.apk), abis: apkAbis },
    aab: options.aab
      ? { file: path.basename(options.aab), size: fs.statSync(options.aab).size, sha256: sha256(options.aab), abis: aabAbis }
      : null,
    manifestFlags: { debuggable, usesCleartextTraffic: cleartext, allowBackup },
    pageAligned16k,
    r8Mapping: mapping,
    signing: {
      certificateDn: signerDn,
      certificateSha256: signerDigest,
      signerCount,
      signatureSchemes,
      bundleSigners: bundleSigning ? bundleSigning.signers : null,
      expectedCertificateSha256: expectedSigner || null,
      distributable: releaseSigned && failures.length === 0,
      note: signingNote,
    },
    toolchain: {
      node: process.version,
      java: process.env.JAVA_HOME || null,
      buildTools: path.basename(path.dirname(aapt2)),
    },
    result: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
  };

  fs.mkdirSync(options.out, { recursive: true });
  fs.writeFileSync(path.join(options.out, 'android-artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const lines = [
    `SOURCE_SHA=${manifest.sourceSha}`,
    `BUILD_PROFILE=${manifest.buildProfile} PACKAGE=${packageName} VERSION=${versionName} (${versionCode}) MIN_SDK=${minSdk} TARGET_SDK=${targetSdk}`,
    `ABIS=${apkAbis.join(',')} NATIVE_CODE=${nativeCode}`,
    `PERMISSIONS=${permissions.join(',')}`,
    `APK=${manifest.apk.file} SIZE=${manifest.apk.size} SHA256=${manifest.apk.sha256}`,
    manifest.aab ? `AAB=${manifest.aab.file} SIZE=${manifest.aab.size} SHA256=${manifest.aab.sha256} ABIS=${aabAbis.join(',')}` : 'AAB=none',
    `DEBUGGABLE=${debuggable} CLEARTEXT=${cleartext} ALLOW_BACKUP=${allowBackup} PAGE_ALIGNED_16K=${pageAligned16k}`,
    `R8_MAPPING=${mapping ? `${mapping.file} SIZE=${mapping.size}` : 'not checked'}`,
    `SIGNER=${signerDn} SHA256=${signerDigest} SIGNERS=${signerCount} SCHEMES=${signatureSchemes.join(',')}`
      + (bundleSigning ? ` AAB_SIGNERS=${bundleSigning.signers.map((signer) => signer.sha256).join(',')}` : ''),
    `SIGNING=${manifest.signing.distributable ? 'DISTRIBUTABLE' : signingNote || 'NOT_DISTRIBUTABLE: verification failed'}`,
    `RESULT=${manifest.result}${failures.length ? ` FAILURES=${failures.join(' | ')}` : ''}`,
  ];
  fs.writeFileSync(path.join(options.out, 'android-artifact-manifest.txt'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
  if (failures.length > 0) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(`ANDROID_ARTIFACT_VERIFY=FAILED ${error.message}`);
  process.exit(1);
}
