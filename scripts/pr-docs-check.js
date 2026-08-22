#!/usr/bin/env node
/**
 * pr-docs-check.js — the validation the universal PR gate runs on documentation.
 *
 * A docs-only diff skips the backend/frontend/Growth suites by design, so
 * without this the required PR context would pass having checked nothing. This
 * is what it actually checks:
 *
 *   1. unresolved merge-conflict markers in any changed text file
 *   2. relative Markdown links in changed .md files that point at a path which
 *      does not exist in the tree
 *
 * Trailing-whitespace / CRLF is left to `git diff --check`, which the gate runs
 * alongside this and which already knows the repo's .gitattributes.
 *
 * Usage: node scripts/pr-docs-check.js <file>...   (defaults to every tracked .md)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
// Anything that is not a repo-relative path: absolute URLs, mailto:, protocol-
// relative, pure in-page anchors, and templated paths a build step fills in.
const NOT_A_PATH = /^([a-z][a-z0-9+.-]*:|\/\/|#|<|\{)/i;
const MD_LINK = /(!?)\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
const CONFLICT_MARKER = /^(<{7}|={7}|>{7})(?: |$)/;

function tracked(patterns) {
    const out = execFileSync('git', ['ls-files', '-z', ...patterns], { cwd: REPO_ROOT });
    return out.toString('utf8').split('\0').filter(Boolean);
}

function readIfText(file) {
    const abs = path.resolve(REPO_ROOT, file);
    // A path outside the repo, or one the caller named but git already deleted,
    // is skipped rather than read — but never silently: main() reports it.
    if (!abs.startsWith(REPO_ROOT + path.sep)) return undefined;
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return undefined;
    const buf = fs.readFileSync(abs);
    if (buf.includes(0)) return null; // binary
    return buf.toString('utf8');
}

function checkConflictMarkers(file, text, problems) {
    text.split(/\r?\n/).forEach((line, i) => {
        if (CONFLICT_MARKER.test(line)) {
            problems.push(`${file}:${i + 1}: unresolved merge-conflict marker: ${line.slice(0, 40)}`);
        }
    });
}

function checkMarkdownLinks(file, text, problems) {
    const dir = path.dirname(path.join(REPO_ROOT, file));
    for (const [, , rawTarget] of text.matchAll(MD_LINK)) {
        const target = rawTarget.trim();
        if (!target || NOT_A_PATH.test(target)) continue;
        // Strip the anchor: README.md#section resolves to README.md.
        const filePart = target.split('#')[0];
        if (!filePart) continue;
        const resolved = filePart.startsWith('/')
            ? path.join(REPO_ROOT, filePart.slice(1))
            : path.resolve(dir, decodeURIComponent(filePart));
        if (!fs.existsSync(resolved)) {
            problems.push(`${file}: broken relative link -> ${target}`);
        }
    }
}

function main() {
    const args = process.argv.slice(2);
    const files = args.length ? args : tracked(['*.md', '**/*.md']);
    const problems = [];

    let checked = 0;
    for (const file of files) {
        const text = readIfText(file);
        if (text === undefined) {
            // Only an explicitly named file is worth complaining about; a file
            // deleted by the diff is expected and harmless.
            if (args.length) console.log(`pr-docs-check: skipped (not a readable file in repo): ${file}`);
            continue;
        }
        if (text === null) continue; // binary
        checked += 1;
        checkConflictMarkers(file, text, problems);
        if (file.toLowerCase().endsWith('.md')) checkMarkdownLinks(file, text, problems);
    }

    if (problems.length) {
        console.error(`pr-docs-check: ${problems.length} problem(s) in ${checked} file(s)`);
        problems.forEach((p) => console.error(`  ${p}`));
        process.exit(1);
    }
    console.log(`pr-docs-check: OK (${checked} file(s) checked)`);
}

main();
