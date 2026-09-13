#!/usr/bin/env node
'use strict';

// Enforces the mobile-program isolation boundary (docs/mobile/CURRENT_STATE.md
// §15) on every mobile-ci run: diffs the current ref against origin/main and
// hard-fails if anything outside the mobile program's allowed surface changed.
// This does not judge WHETHER a backend change is additive — that is a human
// reviewer's job — it only (a) blocks changes to files this program must never
// touch under any circumstance, and (b) reports whether EasyMod-backend/ was
// touched at all, so the backend-regression job knows whether to run.
// Dependency-free: only Node's built-in child_process and fs.

const { execSync } = require('child_process');
const fs = require('fs');

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

sh('git fetch origin main --quiet');
const mergeBase = sh('git merge-base origin/main HEAD');
const diffOutput = sh(`git diff --name-only ${mergeBase} HEAD`);
const changedPaths = diffOutput.split('\n').filter(Boolean);

// Anything matching one of these patterns is forbidden outright, regardless
// of the mobile program's additive-backend-delta allowance — these are files
// no phase of this program may ever change.
const NEVER_TOUCH = [
  /^package\.json$/,
  /^package-lock\.json$/,
  /^Dockerfile/i,
  /docker-compose.*\.ya?ml$/i,
  /^Caddyfile/i,
  // Any workflow file except mobile-ci.yml itself.
  /^\.github\/workflows\/(?!mobile-ci\.yml$).+/,
  /^EasyMod-frontend\//,
  /^EasyMod-growth\//,
];

const hardFailures = changedPaths.filter((p) => NEVER_TOUCH.some((pattern) => pattern.test(p)));

console.log(`Changed paths relative to origin/main (${changedPaths.length}):`);
changedPaths.forEach((p) => console.log(`  - ${p}`));

if (hardFailures.length > 0) {
  console.error('\nProtected-path violation — this program must never touch:');
  hardFailures.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}

// Not a hard failure — the mobile program legitimately needs to be able to
// fix and extend its own CI tooling — but a change to the isolation guards
// themselves is exactly the kind of diff a reviewer should read line-by-line
// rather than skim, so it's called out loudly here instead of silently
// passing alongside everything else.
const guardFilesTouched = changedPaths.filter(
  (p) => p === '.github/workflows/mobile-ci.yml' || p.startsWith('.github/scripts/'),
);
if (guardFilesTouched.length > 0) {
  console.warn('\n⚠ This diff changes the isolation guard(s) themselves — review these line-by-line, not just the aggregate pass/fail:');
  guardFilesTouched.forEach((p) => console.warn(`  - ${p}`));
}

const backendTouched = changedPaths.some((p) => p.startsWith('EasyMod-backend/'));
console.log(`\nbackend_touched=${backendTouched}`);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `backend_touched=${backendTouched}\n`);
}
