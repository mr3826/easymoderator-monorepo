#!/usr/bin/env node
'use strict';

// Structural isolation guard for .github/workflows/mobile-ci.yml (ADR M-009).
// Fails the run if that workflow ever grows a capability the mobile program
// is forbidden from giving mobile CI: repo secrets, a deployment environment,
// workflow_dispatch, a trigger that reaches `main`, or a deploy/SSH/registry-
// push-shaped step. Deliberately dependency-free (plain text scanning, no
// YAML parser) so this guard has nothing else to install or compromise.

const fs = require('fs');
const path = require('path');

const WORKFLOW_PATH = path.join(__dirname, '..', 'workflows', 'mobile-ci.yml');
const failures = [];

const raw = fs.readFileSync(WORKFLOW_PATH, 'utf8');

// Strip full-line and trailing comments and blank lines so a `# secrets.FOO`
// comment can't hide a real problem and blank lines don't complicate the
// indentation-based block scanning below.
const code = raw
  .split('\n')
  .map((line) => line.replace(/#.*$/, ''))
  .filter((line) => line.trim().length > 0)
  .join('\n');

// Finds `key:` at ANY indentation level and returns its nested block (the
// lines more indented than the key itself), stopping at the first line whose
// indentation is less-or-equal to the key's own — i.e. a sibling or
// higher-level key, at whatever depth the key was found at. Returns the
// inline value instead if the key has one (e.g. `permissions: read-all`).
function extractTopLevelBlock(text, key) {
  const lines = text.split('\n');
  const keyPattern = new RegExp(`^(\\s*)${key}\\s*:`);
  let idx = -1;
  let indent = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(keyPattern);
    if (match) {
      idx = i;
      indent = match[1].length;
      break;
    }
  }
  if (idx === -1) return null;
  const inline = lines[idx].replace(new RegExp(`^\\s*${key}\\s*:\\s*`), '').trim();
  if (inline) return inline;
  const blockLines = [];
  for (let i = idx + 1; i < lines.length; i += 1) {
    const lineIndent = lines[i].match(/^\s*/)[0].length;
    if (lineIndent <= indent) break; // dedent to a sibling or higher-level key
    blockLines.push(lines[i]);
  }
  return blockLines.join('\n');
}

// 1. No workflow_dispatch, anywhere in the file.
if (/\bworkflow_dispatch\b/.test(code)) {
  failures.push('workflow_dispatch trigger is forbidden in mobile-ci.yml');
}

// 2. No secrets.* reference anywhere in the file.
if (/\bsecrets\s*\.\s*[A-Za-z0-9_]+/.test(code) || /\$\{\{\s*secrets\b/.test(code)) {
  failures.push('a secrets.* reference is forbidden in mobile-ci.yml');
}

// 3. No `environment:` deployment block, at any nesting level.
if (/^\s*environment\s*:/m.test(code)) {
  failures.push('an `environment:` block is forbidden in mobile-ci.yml');
}

// 4. Top-level permissions must be exactly `contents: read`, nothing else.
const permissionsBlock = extractTopLevelBlock(code, 'permissions');
if (!permissionsBlock) {
  failures.push('no top-level `permissions:` block found in mobile-ci.yml');
} else {
  const permLines = permissionsBlock.split('\n').map((l) => l.trim()).filter(Boolean);
  if (permLines.length !== 1 || !/^contents\s*:\s*read$/.test(permLines[0])) {
    failures.push('top-level `permissions:` must be exactly `contents: read` with no other scopes');
  }
}
// Belt and suspenders: no `*: write` permission anywhere, top-level or per-job.
if (/permissions\s*:[\s\S]{0,200}?:\s*write\b/.test(code)) {
  failures.push('a `*: write` permission is forbidden anywhere in mobile-ci.yml');
}

// Mobile CI has no release side effect, so superseded branch validation must
// not consume another runner while a newer push or PR update is available. But
// the group must be scoped per event type and PR number so a branch push never
// cancels that same branch's open-PR merge gate (they are different scopes and
// the PR gate must remain a reliable required check).
const concurrencyBlock = extractTopLevelBlock(code, 'concurrency') || '';
if (!/cancel-in-progress\s*:\s*true\b/.test(concurrencyBlock)) {
  failures.push('mobile-ci.yml must cancel superseded validation runs');
}
if (!/github\.event_name/.test(concurrencyBlock)) {
  failures.push('mobile-ci.yml concurrency group must be keyed by github.event_name so a push cannot cancel a PR gate');
}
if (!/github\.event\.pull_request\.number/.test(concurrencyBlock)) {
  failures.push('mobile-ci.yml concurrency group must key pull_request runs by github.event.pull_request.number so same-named PRs do not cancel each other');
}

// 5. Every push/pull_request trigger must carry an explicit, non-wildcard
// `branches:` list that does not include `main`. This is stricter than a
// literal "no `main` substring" check: a `branches:` list is REQUIRED (an
// absent one defaults to "every branch", which includes main) and a bare
// `'*'`/`'**'` entry is rejected even though it never spells out "main",
// because it matches main too.
const onBlock = extractTopLevelBlock(code, 'on') || '';
if (/\bmain\b/.test(onBlock)) {
  failures.push('a trigger referencing `main` is forbidden in mobile-ci.yml — this workflow must never run against main');
}
for (const triggerName of ['push', 'pull_request']) {
  const triggerBlock = extractTopLevelBlock(onBlock, triggerName);
  if (triggerBlock === null) continue; // trigger not used
  const branchesBlock = extractTopLevelBlock(triggerBlock, 'branches');
  if (branchesBlock === null) {
    failures.push(`the \`${triggerName}:\` trigger must specify an explicit \`branches:\` list in mobile-ci.yml (an absent list defaults to every branch, including main)`);
    continue;
  }
  const branchEntries = branchesBlock
    .split('\n')
    .map((l) => l.trim().replace(/^-\s*/, '').trim())
    .filter(Boolean);
  const wildcardEntries = branchEntries.filter((entry) => /^['"]?\*+['"]?$/.test(entry));
  if (wildcardEntries.length > 0) {
    failures.push(`the \`${triggerName}:\` trigger's \`branches:\` list contains a bare wildcard (${wildcardEntries.join(', ')}), which also matches main`);
  }
}

// 6. No SSH / registry-push / deploy/dispatch-shaped step content anywhere.
const forbiddenStepPatterns = [
  [/ssh-agent|appleboy\/ssh-action|webfactory\/ssh-agent/i, 'an SSH action/step'],
  [/docker\/login-action|docker\s+push\b/i, 'a container-registry login/push step'],
  [/gh\s+workflow\s+run|gh\s+api\s+[^\n]*\/dispatches/i, 'a step that dispatches another workflow'],
];
for (const [pattern, label] of forbiddenStepPatterns) {
  if (pattern.test(code)) {
    failures.push(`${label} is forbidden in mobile-ci.yml`);
  }
}

if (failures.length > 0) {
  console.error('mobile-ci.yml isolation guard FAILED:');
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log(
  'mobile-ci.yml isolation guard passed: no secrets, no environment, no workflow_dispatch, ' +
    'no main-reaching trigger, no deploy-shaped step.',
);
