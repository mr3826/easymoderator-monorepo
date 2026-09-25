#!/usr/bin/env node
'use strict';

/**
 * Verifies an Android release build and writes its artifact manifest (plan M-6):
 *
 *   node scripts/verify-android-artifact.js --apk <apk> [--aab <aab>] --package <id> \
 *     --abis armeabi-v7a,arm64-v8a,x86,x86_64 --out <dir>
 *
 * Fails (exit 1) unless every requested ABI ships the React Native/Hermes native
 * libraries in the APK (and AAB), the package id matches, the manifest is not
 * debuggable, does not allow cleartext traffic and disables backup, and the APK
 * verifies with apksigner. A debug-certificate signature is recorded as
 * NOT_DISTRIBUTABLE rather than hidden. Dependency-free: unzip + Android build-tools.
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

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const zipEntries = (file) => run('unzip', ['-Z1', file]).split('\n').filter(Boolean);

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

  const manifestTree = run(aapt2, ['dump', 'xmltree', '--file', 'AndroidManifest.xml', options.apk]);
  const attribute = (name) => {
    const match = manifestTree.match(new RegExp(`android:${name}\\([^)]*\\)=\\(type 0x12\\)(0x[0-9a-f]+)`, 'i'));
    return match ? match[1] !== '0x0' : null;
  };
  const debuggable = attribute('debuggable');
  const cleartext = attribute('usesCleartextTraffic');
  const allowBackup = attribute('allowBackup');
  check(debuggable !== true, 'manifest sets android:debuggable=true');
  check(cleartext !== true, 'manifest allows cleartext traffic (android:usesCleartextTraffic=true)');
  check(allowBackup === false, `manifest android:allowBackup is ${allowBackup}, expected false`);

  const apksigner = buildTool(process.platform === 'win32' ? 'apksigner.bat' : 'apksigner');
  let signerDigest = null;
  let signerDn = null;
  try {
    const certs = run(apksigner, ['verify', '--print-certs', options.apk]);
    signerDigest = (certs.match(/certificate SHA-256 digest: ([0-9a-f]+)/) || [])[1] || null;
    signerDn = (certs.match(/certificate DN: (.+)/) || [])[1] || null;
  } catch (error) {
    failures.push(`apksigner verify failed: ${error.message.split('\n')[0]}`);
  }
  const debugSigned = /CN=Android Debug/.test(signerDn || '');

  const manifest = {
    sourceSha: process.env.GIT_SHA || process.env.GITHUB_SHA || 'unknown',
    buildProfile: process.env.APP_VARIANT || 'unknown',
    package: packageName,
    versionName,
    versionCode,
    minSdk,
    targetSdk,
    nativeCode,
    requestedAbis: abis,
    apk: { file: path.basename(options.apk), size: fs.statSync(options.apk).size, sha256: sha256(options.apk), abis: apkAbis },
    aab: options.aab
      ? { file: path.basename(options.aab), size: fs.statSync(options.aab).size, sha256: sha256(options.aab), abis: aabAbis }
      : null,
    manifestFlags: { debuggable, usesCleartextTraffic: cleartext, allowBackup },
    signing: {
      certificateDn: signerDn,
      certificateSha256: signerDigest,
      distributable: !debugSigned,
      note: debugSigned ? 'NOT_DISTRIBUTABLE: signed with the Android debug certificate (no release keystore is provisioned)' : null,
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
    `APK=${manifest.apk.file} SIZE=${manifest.apk.size} SHA256=${manifest.apk.sha256}`,
    manifest.aab ? `AAB=${manifest.aab.file} SIZE=${manifest.aab.size} SHA256=${manifest.aab.sha256} ABIS=${aabAbis.join(',')}` : 'AAB=none',
    `DEBUGGABLE=${debuggable} CLEARTEXT=${cleartext} ALLOW_BACKUP=${allowBackup}`,
    `SIGNER=${signerDn} SHA256=${signerDigest} ${manifest.signing.note || 'DISTRIBUTABLE'}`,
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
