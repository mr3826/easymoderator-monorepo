#!/usr/bin/env node
'use strict';

/**
 * Install + cold launch + relaunch proof for a release APK on a connected
 * emulator/device (no backend needed: a fresh install must reach the login
 * screen without crashing).
 *
 *   node scripts/android-install-launch-check.js <apk> <package> <artifact-dir>
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const [apk, packageName, outDir] = process.argv.slice(2);
if (!apk || !packageName || !outDir) {
  console.error('usage: android-install-launch-check.js <apk> <package> <artifact-dir>');
  process.exit(2);
}

const adb = process.env.ADB_BIN || 'adb';
const run = (args, options = {}) => execFileSync(adb, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
const tryRun = (args) => {
  try {
    return run(args);
  } catch (error) {
    return String(error.stdout || '');
  }
};
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function waitFor(description, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    sleep(1000);
  }
  throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${description}`);
}

function loginScreenVisible() {
  tryRun(['shell', 'uiautomator', 'dump', '/sdcard/window.xml']);
  return /login-email-input/.test(tryRun(['shell', 'cat', '/sdcard/window.xml']));
}

function assertNoCrash(stage) {
  const crash = tryRun(['logcat', '-d', '-b', 'crash']);
  if (crash.includes(packageName)) {
    throw new Error(`${stage}: the app crashed:\n${crash.slice(-4000)}`);
  }
  if (!tryRun(['shell', 'pidof', packageName]).trim()) {
    throw new Error(`${stage}: the app process is not running`);
  }
}

function coldLaunch(stage) {
  const started = run(['shell', 'am', 'start', '-W', '-n', `${packageName}/.MainActivity`]);
  if (!/Status: ok/.test(started)) throw new Error(`${stage}: am start failed:\n${started}`);
  const totalTime = (started.match(/TotalTime: (\d+)/) || [])[1] || 'unknown';
  waitFor(`${stage}: login screen`, loginScreenVisible, 120000);
  assertNoCrash(stage);
  return totalTime;
}

function main() {
  fs.mkdirSync(outDir, { recursive: true });
  run(['logcat', '-c']);
  const installed = run(['install', '-r', apk]);
  if (!/Success/.test(installed)) throw new Error(`install failed:\n${installed}`);

  const packageInfo = run(['shell', 'dumpsys', 'package', packageName]);
  const field = (name) => (packageInfo.match(new RegExp(`${name}=(\\S+)`)) || [])[1] || 'unknown';

  const coldStartMs = coldLaunch('cold launch');
  fs.writeFileSync(path.join(outDir, 'launch-login.png'), run(['exec-out', 'screencap', '-p'], { encoding: 'buffer' }));

  run(['shell', 'am', 'force-stop', packageName]);
  const relaunchMs = coldLaunch('relaunch');

  const lines = [
    `PACKAGE=${packageName} VERSION=${field('versionName')} (${field('versionCode')})`,
    `DEVICE=${tryRun(['shell', 'getprop', 'ro.product.model']).trim()} SDK=${tryRun(['shell', 'getprop', 'ro.build.version.sdk']).trim()} ABI=${tryRun(['shell', 'getprop', 'ro.product.cpu.abi']).trim()}`,
    `INSTALL=PASS COLD_LAUNCH=PASS (TotalTime ${coldStartMs} ms) RELAUNCH=PASS (TotalTime ${relaunchMs} ms) LOGIN_SCREEN=VISIBLE CRASHES=0`,
  ];
  fs.writeFileSync(path.join(outDir, 'install-launch.txt'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}

try {
  main();
} catch (error) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'install-launch.txt'), `RESULT=FAIL ${error.message}\n`);
  try {
    fs.writeFileSync(path.join(outDir, 'install-launch-logcat.txt'), tryRun(['logcat', '-d', '-v', 'threadtime']).slice(-2_000_000));
  } catch {
    // best effort
  }
  console.error(`ANDROID_INSTALL_LAUNCH=FAILED ${error.message}`);
  process.exit(1);
}
