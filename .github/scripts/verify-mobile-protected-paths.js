#!/usr/bin/env node
'use strict';

// Enforces the mobile-program isolation boundary (docs/mobile/CURRENT_STATE.md
// §15) on every pull request: non-mobile diffs report not-applicable, while a
// mobile-relevant diff hard-fails if anything outside the allowed surface
// changed. This does not judge WHETHER a backend change is additive — that is a
// human reviewer's job — it only blocks files this program must never touch and
// reports whether a consumed backend contract changed.
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

const MOBILE_RELEVANT = [
  /^EasyMod-mobile\//,
  /^docs\/mobile\//,
  /^EasyMod-backend\/src\/modules\/mobile\//,
  /^EasyMod-backend\/src\/modules\/auth\//,
  /^EasyMod-backend\/src\/modules\/notification\//,
  /^EasyMod-backend\/src\/middleware\/auth\.middleware\.js$/,
  /^EasyMod-backend\/src\/middleware\/mobile-client-context\.middleware\.js$/,
  /^EasyMod-backend\/src\/config\/config\.js$/,
  /^\.github\/workflows\/mobile-ci\.yml$/,
  /^\.github\/scripts\/verify-mobile-(?:ci-isolation|protected-paths)\.js$/,
];

const mobileRelevant = changedPaths.some((p) =>
  MOBILE_RELEVANT.some((pattern) => pattern.test(p)),
);

// Anything matching one of these patterns is forbidden outright, regardless
// of the mobile program's additive-backend-delta allowance — these are files
// no phase of this program may ever change.
const NEVER_TOUCH = [
  /^package\.json$/,
  /^package-lock\.json$/,
  /^Dockerfile/i,
  /docker-compose.*\.ya?ml$/i,
  /^Caddyfile/i,
  // Any workflow file except this program's own two (ADR M-009 / M-013).
  /^\.github\/workflows\/(?!mobile-(?:ci|release)\.yml$).+/,
  /^EasyMod-frontend\//,
  /^EasyMod-growth\//,
];

const hardFailures = changedPaths.filter((p) => NEVER_TOUCH.some((pattern) => pattern.test(p)));

console.log(`Changed paths relative to origin/main (${changedPaths.length}):`);
changedPaths.forEach((p) => console.log(`  - ${p}`));

console.log(`\nmobile_relevant=${mobileRelevant}`);

if (!mobileRelevant) {
  console.log('Mobile CI: not applicable for this diff; skipping mobile build/test jobs.');
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'mobile_relevant=false\nbackend_touched=false\n');
  }
  process.exit(0);
}

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
  (p) => /^\.github\/workflows\/mobile-(?:ci|release)\.yml$/.test(p) || p.startsWith('.github/scripts/'),
);
if (guardFilesTouched.length > 0) {
  console.warn('\n⚠ This diff changes the isolation guard(s) themselves — review these line-by-line, not just the aggregate pass/fail:');
  guardFilesTouched.forEach((p) => console.warn(`  - ${p}`));
}

const backendTouched = changedPaths.some((p) =>
  p.startsWith('EasyMod-backend/') && MOBILE_RELEVANT.some((pattern) => pattern.test(p)),
);
console.log(`\nbackend_touched=${backendTouched}`);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `mobile_relevant=${mobileRelevant}\nbackend_touched=${backendTouched}\n`,
  );
}
