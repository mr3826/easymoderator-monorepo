'use strict';

/**
 * Test-discovery guard.
 *
 * The invariant this exists to defend:
 *
 *     tracked test file
 *       → belongs to exactly one explicit suite
 *       → that suite actually discovers it
 *       → that suite runs in CI
 *       → its failure blocks build/deploy
 *
 * Why it exists: for months `npm test` reported green while jest.config.js
 * quietly removed 18 test files through testPathIgnorePatterns. Nothing was
 * marked `.skip`, so every "list the skipped tests" check answered "none" —
 * truthfully, and uselessly. A grep for `.skip` cannot see a config exclusion,
 * a testMatch that misses, or a file nobody ever committed.
 *
 * So this asks jest itself, once per configured suite, and compares the answer
 * against what is actually in the repository.
 *
 * Detects:
 *   - ignored by config      tracked, matches a suite's testMatch, excluded
 *   - no matching config     tracked, discovered by nobody
 *   - accidental orphan      on disk but never committed (runs unreviewed, or
 *                            is dead weight nobody can see)
 *   - duplicate home         discovered by more than one suite
 *   - disabled suite         a configured suite that discovers nothing
 *   - skipped tests          .skip/.todo/xit inside a required suite
 *
 * Run directly (`npm run test:discovery`) or through
 * tests/__tests__/test-discovery.test.js, which fails the unit gate on the
 * same conditions.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '..');

/**
 * Every execution home a backend test may have. A test file that is not
 * discovered by exactly one of these has no home, and does not count as
 * coverage no matter what it asserts.
 */
const SUITES = [
    {
        name: 'unit',
        config: 'jest.config.js',
        command: 'npm test',
        ciJob: 'Test & Build Gate',
        ciRequired: true,
    },
    {
        name: 'integration',
        config: 'jest.integration.config.js',
        command: 'npm run test:integration',
        ciJob: 'Backend integration (PostgreSQL + Redis)',
        ciRequired: true,
    },
    {
        name: 'meta-e2e',
        config: 'jest.meta-e2e.config.js',
        command: 'npm run test:meta:e2e',
        ciJob: 'Meta-shaped E2E (AI trust boundary)',
        ciRequired: true,
    },
    {
        // Tracked, real, and NOT YET REPAIRED. Runs in CI for visibility only.
        // A file here has a home but does NOT count as coverage — which is the
        // whole distinction this script exists to keep honest.
        name: 'quarantine',
        config: 'jest.quarantine.config.js',
        command: 'npm run test:quarantine',
        ciJob: 'Backend quarantine (reported, not gating)',
        ciRequired: false,
        isCoverage: false,
    },
];

const QUARANTINE = require('../tests/quarantine.json');

/** Matches a disabled test at its call site, not the word "skip" in prose. */
const SKIP_CALL = /(?:^|[^.\w])(?:x(?:it|test|describe)|(?:it|test|describe)\.(?:skip|todo))\s*\(/;

const toPosix = (p) => p.split(path.sep).join('/');

/** Repo-relative, posix — the one shape everything below is compared in. */
const normalize = (absOrRel) => {
    const abs = path.isAbsolute(absOrRel) ? absOrRel : path.join(BACKEND_DIR, absOrRel);
    return toPosix(path.relative(BACKEND_DIR, abs));
};

const isTestFile = (p) => p.endsWith('.test.js');

/** Test files git knows about. These are the ones that must have a home. */
const trackedTestFiles = () => execFileSync('git', ['ls-files', '*.test.js'], {
    cwd: BACKEND_DIR,
    encoding: 'utf8',
})
    .split('\n')
    .map((l) => l.trim())
    .filter(isTestFile)
    .map(normalize)
    .sort();

/** Test files present on disk, tracked or not. */
const onDiskTestFiles = () => {
    const found = [];
    const skipDir = new Set(['node_modules', '.git', 'coverage', '.codex-worktrees']);
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                if (!skipDir.has(entry.name)) walk(path.join(dir, entry.name));
            } else if (isTestFile(entry.name)) {
                found.push(normalize(path.join(dir, entry.name)));
            }
        }
    };
    walk(BACKEND_DIR);
    return found.sort();
};

/**
 * Ask jest — not a reimplementation of jest — which files a suite runs.
 * Anything else would be a second source of truth, free to drift from the
 * first, which is the bug class this guard exists to catch.
 */
const discoveredBy = (suite) => execFileSync(
    process.execPath,
    // 'jest/bin/jest' — the '.js' form is not in jest 30's package exports.
    [require.resolve('jest/bin/jest'), '--listTests', '--config', suite.config],
    { cwd: BACKEND_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
)
    .split('\n')
    .map((l) => l.trim())
    .filter(isTestFile)
    .map(normalize)
    .sort();

const analyse = () => {
    const tracked = trackedTestFiles();
    const onDisk = onDiskTestFiles();
    const trackedSet = new Set(tracked);

    const homes = new Map(tracked.map((f) => [f, []]));
    const suites = SUITES.map((suite) => {
        const files = discoveredBy(suite);
        for (const file of files) {
            if (!homes.has(file)) homes.set(file, []);
            homes.get(file).push(suite.name);
        }
        return { ...suite, files };
    });

    const homesOf = (f) => homes.get(f) || [];

    const orphans = tracked.filter((f) => homesOf(f).length === 0);
    const duplicates = tracked.filter((f) => homesOf(f).length > 1)
        .map((f) => ({ file: f, suites: homesOf(f) }));
    const untracked = onDisk.filter((f) => !trackedSet.has(f));
    const emptySuites = suites.filter((s) => s.files.length === 0).map((s) => s.name);

    // Quarantined files have a home but are not coverage. The ceiling is the
    // ratchet: it may be lowered as files are repaired, never quietly raised.
    const quarantined = QUARANTINE.files.map((f) => f.file);
    const quarantineOverCeiling = quarantined.length > QUARANTINE.ceiling;
    const quarantineUndocumented = QUARANTINE.files
        .filter((f) => !f.cause || !f.repair)
        .map((f) => f.file);
    const quarantineMissing = quarantined.filter((f) => !trackedSet.has(f));

    const coverageSuites = new Set(
        SUITES.filter((s) => s.isCoverage !== false).map((s) => s.name),
    );
    const counted = tracked.filter((f) => homesOf(f).some((n) => coverageSuites.has(n)));

    // A test disabled inside a suite that DOES run is the other half of the
    // same lie: discovered, reported as a suite, asserting nothing.
    const skipped = [];
    for (const file of tracked) {
        if (homesOf(file).length === 0) continue;
        const lines = fs.readFileSync(path.join(BACKEND_DIR, file), 'utf8').split('\n');
        lines.forEach((line, i) => {
            if (SKIP_CALL.test(line)) skipped.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }

    return {
        tracked, onDisk, suites, orphans, duplicates, untracked, emptySuites, skipped,
        counted, quarantined, quarantineOverCeiling, quarantineUndocumented,
        quarantineMissing, quarantineCeiling: QUARANTINE.ceiling,
    };
};

/** @returns {string[]} one line per violation; empty means the invariant holds. */
const violations = (result) => {
    const out = [];
    for (const f of result.orphans) {
        out.push(`ORPHAN            ${f} — tracked, but no suite discovers it. It does not count as coverage.`);
    }
    for (const { file, suites } of result.duplicates) {
        out.push(`DUPLICATE_HOME    ${file} — discovered by ${suites.join(' and ')}; it must have exactly one.`);
    }
    for (const f of result.untracked) {
        out.push(`UNTRACKED         ${f} — on disk but never committed.`);
    }
    for (const s of result.emptySuites) {
        out.push(`DISABLED_SUITE    ${s} — configured but discovers no tests.`);
    }
    for (const s of result.skipped) {
        out.push(`SKIPPED           ${s}`);
    }
    if (result.quarantineOverCeiling) {
        out.push(
            `QUARANTINE_GREW   ${result.quarantined.length} files vs ceiling `
            + `${result.quarantineCeiling}. The ceiling only goes down — repair the `
            + 'test rather than raising it.',
        );
    }
    for (const f of result.quarantineUndocumented) {
        out.push(`QUARANTINE_VAGUE  ${f} — needs both a "cause" and a "repair".`);
    }
    for (const f of result.quarantineMissing) {
        out.push(`QUARANTINE_STALE  ${f} — listed in quarantine.json but not tracked in git.`);
    }
    return out;
};

const report = (result) => {
    const lines = ['', 'Test discovery', ''];
    for (const s of result.suites) {
        const note = s.isCoverage === false ? '  (NOT coverage)' : '';
        lines.push(
            `  ${s.name.padEnd(12)} ${String(s.files.length).padStart(3)} files  `
            + `${s.command}${note}`,
        );
    }
    lines.push('');
    lines.push(`  tracked test files:  ${result.tracked.length}`);
    lines.push(`  with a home:         ${result.tracked.length - result.orphans.length}`);
    lines.push(`  counted as coverage: ${result.counted.length}`);
    lines.push(
        `  quarantined (debt):  ${result.quarantined.length} `
        + `of ${result.quarantineCeiling} allowed`,
    );
    lines.push('');
    return lines.join('\n');
};

module.exports = { SUITES, SKIP_CALL, analyse, violations, report };

if (require.main === module) {
    const result = analyse();
    process.stdout.write(report(result));
    const problems = violations(result);
    if (problems.length === 0) {
        process.stdout.write('  every tracked test has exactly one execution home.\n\n');
        process.exit(0);
    }
    process.stdout.write(`  ${problems.length} problem(s):\n\n`);
    for (const p of problems) process.stdout.write(`  ${p}\n`);
    process.stdout.write('\n');
    process.exit(1);
}
