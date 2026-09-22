'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionRoot = path.join(__dirname, '..');
const manifestPath = path.join(extensionRoot, 'manifest.json');
const manifestText = fs.readFileSync(manifestPath, 'utf8');
const bridgeText = fs.readFileSync(path.join(extensionRoot, 'content-bridge.js'), 'utf8');
const manifest = JSON.parse(manifestText);

// Security boundary: this is the exact allowed permission set from the product
// contract. Anything added here must go through review - no cookies, no
// history, no broad host access.
const ALLOWED_PERMISSIONS = ['activeTab', 'scripting', 'storage'];
const ALLOWED_HOSTS = ['https://growth.easymod.tech/*'];

test('manifest basics: MV3, identity, action popup, no fabricated icons', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'EasyModerator Lead Capture');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.equal('default_icon' in manifest.action, false);
  assert.equal('icons' in manifest, false);
});

test('permissions are EXACTLY the allowed set (security boundary)', () => {
  assert.equal(Array.isArray(manifest.permissions), true);
  assert.deepEqual([...manifest.permissions].sort(), [...ALLOWED_PERMISSIONS].sort());
});

test('forbidden permissions never appear anywhere in the manifest', () => {
  const forbidden = /"(cookies|history|tabs|webRequest|debugger|management|notifications)"/;
  assert.equal(forbidden.test(manifestText), false);
  assert.equal(manifestText.includes('<all_urls>'), false);
  assert.equal(manifestText.includes('optional_host_permissions'), false);
  assert.equal(manifestText.includes('permission_defaults'), false);
});

test('host_permissions are only first-party Growth OS origins', () => {
  assert.equal(Array.isArray(manifest.host_permissions), true);
  assert.deepEqual([...manifest.host_permissions].sort(), [...ALLOWED_HOSTS].sort());
  for (const pattern of manifest.host_permissions) {
    assert.match(pattern, /^(https:\/\/growth\.easymod\.tech\/\*|http:\/\/127\.0\.0\.1:5175\/\*)$/);
  }
});

test('release manifest never grants localhost access', () => {
  assert.equal(manifestText.includes('127.0.0.1'), false);
  assert.equal(manifestText.includes('localhost'), false);
});

test('development manifest keeps localhost isolated from the release manifest', () => {
  const devManifest = JSON.parse(
    fs.readFileSync(path.join(extensionRoot, 'manifest.dev.json'), 'utf8'),
  );
  assert.deepEqual([...devManifest.permissions].sort(), [...ALLOWED_PERMISSIONS].sort());
  assert.deepEqual(
    [...devManifest.host_permissions].sort(),
    ['https://growth.easymod.tech/*', 'http://127.0.0.1:5175/*'].sort(),
  );
});

test('content_scripts run only the bridge stack on the Growth OS hosts', () => {
  assert.equal(manifest.content_scripts.length, 1);
  const [entry] = manifest.content_scripts;
  assert.deepEqual([...entry.matches].sort(), [...ALLOWED_HOSTS].sort());
  assert.deepEqual(entry.js, ['lib/capture.js', 'content-bridge.js']);
  assert.equal(entry.run_at, 'document_idle');
  assert.equal('css' in entry, false);
  assert.equal('all_frames' in entry, false);
});

test('bridge runtime guard narrows Growth host matches to nonce-bound /capture', () => {
  assert.match(bridgeText, /window\.location\.pathname !== API\.CAPTURE_PAGE_PATH/);
  assert.match(bridgeText, /API\.parseCapturePageUrl\(window\.location\.href\)/);
  assert.match(bridgeText, /!captureTarget \|\| !captureTarget\.nonce/);
  assert.match(bridgeText, /targetOrigin: captureTarget\.origin/);
  assert.match(bridgeText, /targetPath: captureTarget\.pathname/);
});

test('background is the minimal claim-relay service worker', () => {
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal('type' in manifest.background, false);
});

test('all files referenced by the manifest exist', () => {
  const referenced = [
    'popup.html',
    'background.js',
    'lib/capture.js',
    'content-bridge.js'
  ];
  for (const file of referenced) {
    assert.equal(fs.existsSync(path.join(extensionRoot, file)), true, file + ' missing');
  }
});
