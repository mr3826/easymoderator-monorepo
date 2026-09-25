#!/usr/bin/env node
'use strict';

// Plan M-12 contract drift check. The backend integration suite regenerates
// EasyMod-backend/.../__fixtures__/native-auth-responses.json on every run, and
// the mobile suite parses the committed copy with its production schemas. This
// compares the regenerated file with the committed one by *shape* only (keys,
// nesting and value types — ids, emails and timestamps legitimately differ), so
// a backend response change that was never re-committed for mobile fails CI.
// Dependency-free: git + Node built-ins.

const { execFileSync } = require('child_process');
const fs = require('fs');

const FIXTURE = 'EasyMod-backend/src/modules/auth/native/__tests__/__fixtures__/native-auth-responses.json';

function shape(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length === 0 ? ['empty'] : [shape(value[0])];
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => !key.startsWith('_') && key !== 'capturedAt')
        .sort()
        .map((key) => [key, shape(value[key])]),
    );
  }
  return typeof value;
}

const committed = JSON.parse(execFileSync('git', ['show', `HEAD:${FIXTURE}`], { encoding: 'utf8' }));
const regenerated = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const expected = JSON.stringify(shape(committed), null, 2);
const actual = JSON.stringify(shape(regenerated), null, 2);

if (expected !== actual) {
  console.error('Native auth contract drift: the backend now returns a different response shape than the');
  console.error(`committed ${FIXTURE}. Re-run the backend integration suite, commit the fixture, and`);
  console.error('update the mobile schemas (EasyMod-mobile/src/auth/auth-client.ts) if needed.');
  console.error(`--- committed shape\n${expected}\n--- regenerated shape\n${actual}`);
  process.exit(1);
}
console.log('Native auth contract fixture shape: unchanged.');
