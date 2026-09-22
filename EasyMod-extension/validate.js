'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const extensionRoot = __dirname;
const allowedPermissions = ['activeTab', 'scripting', 'storage'];
const releaseHosts = ['https://growth.easymod.tech/*'];
const developmentHosts = [...releaseHosts, 'http://127.0.0.1:5175/*'];
const requiredFiles = [
  'manifest.json',
  'manifest.dev.json',
  'popup.html',
  'popup.css',
  'popup.js',
  'background.js',
  'content-bridge.js',
  'lib/capture.js',
];
const javascriptFiles = ['popup.js', 'background.js', 'content-bridge.js', 'lib/capture.js'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sorted(values) {
  return [...values].sort();
}

function readManifest(filename) {
  const filePath = path.join(extensionRoot, filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function validateManifest(manifest, expectedHosts, label) {
  assert(manifest.manifest_version === 3, `${label} must use Manifest V3`);
  assert(
    JSON.stringify(sorted(manifest.permissions || [])) === JSON.stringify(sorted(allowedPermissions)),
    `${label} permissions exceed the bounded extension contract`,
  );
  assert(
    JSON.stringify(sorted(manifest.host_permissions || [])) === JSON.stringify(sorted(expectedHosts)),
    `${label} host permissions exceed the bounded Growth origins`,
  );
  assert(!('optional_permissions' in manifest), `${label} must not add optional permissions`);
  assert(!('optional_host_permissions' in manifest), `${label} must not add optional host permissions`);
}

for (const filename of requiredFiles) {
  assert(fs.existsSync(path.join(extensionRoot, filename)), `${filename} is missing`);
}

validateManifest(readManifest('manifest.json'), releaseHosts, 'release manifest');
validateManifest(readManifest('manifest.dev.json'), developmentHosts, 'development manifest');

for (const filename of javascriptFiles) {
  const result = spawnSync(process.execPath, ['--check', path.join(extensionRoot, filename)], {
    encoding: 'utf8',
  });
  assert(result.status === 0, `${filename} failed syntax validation: ${result.stderr || 'unknown error'}`);
}

console.log('Browser extension source validation passed.');
