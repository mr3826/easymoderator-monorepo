'use strict';

/**
 * The guard that makes `npm test` mean something.
 *
 * A green unit gate is only evidence about the files the unit gate RUNS. For
 * months this repository's gate was green while jest.config.js removed 18 test
 * files — every order, shop and product suite among them — through
 * testPathIgnorePatterns. Nothing was marked `.skip`, so every audit that
 * looked for disabled tests reported none.
 *
 * This test asks jest which files each suite actually discovers and compares
 * that against what is in the repository. It fails if a tracked test has no
 * home, has two homes, was never committed, or is disabled in place.
 *
 * The logic lives in scripts/check-test-discovery.js so it can also run
 * standalone as `npm run test:discovery`.
 */

const { analyse, violations, report, SUITES, SKIP_CALL } = require('../../scripts/check-test-discovery');

// Each suite is a separate `jest --listTests` process (~2.5s apiece).
jest.setTimeout(60000);

describe('test discovery', () => {
    let result;

    beforeAll(() => { result = analyse(); });

    it('gives every tracked test file exactly one execution home', () => {
        const problems = violations(result);
        // The report is the useful part of the failure: it names the files.
        expect(problems.join('\n') || report(result)).toBe(report(result));
    });

    it('has no orphaned test files', () => {
        expect(result.orphans).toEqual([]);
    });

    it('has no test file claimed by two suites', () => {
        expect(result.duplicates).toEqual([]);
    });

    it('has no test file on disk that was never committed', () => {
        // The failure mode this catches: a batch of test files written, never
        // added to git, and reported as coverage by whoever wrote them.
        expect(result.untracked).toEqual([]);
    });

    it('has no configured suite that discovers nothing', () => {
        expect(result.emptySuites).toEqual([]);
    });

    it('has no disabled tests inside a suite that runs', () => {
        expect(result.skipped).toEqual([]);
    });

    it('checks every suite a backend test can belong to', () => {
        expect(SUITES.map((s) => s.name).sort())
            .toEqual(['integration', 'meta-e2e', 'quarantine', 'unit']);
    });

    it('requires every coverage-bearing suite to be a CI gate', () => {
        // If a suite stops blocking the build, a failure in it stops mattering,
        // and the tests it holds are back to being decoration. Quarantine is the
        // deliberate exception: it does not gate because it does not count.
        const notGating = SUITES.filter((s) => s.isCoverage !== false && !s.ciRequired);
        expect(notGating).toEqual([]);
    });

    describe('quarantine', () => {
        it('never counts a quarantined file as coverage', () => {
            for (const file of result.quarantined) {
                expect(result.counted).not.toContain(file);
            }
        });

        it('stays within its ceiling — the number only goes down', () => {
            expect(result.quarantineOverCeiling).toBe(false);
        });

        it('states a cause and a repair for every entry', () => {
            // Without both, this is an ignore list with extra steps.
            expect(result.quarantineUndocumented).toEqual([]);
        });

        it('lists only files that still exist in git', () => {
            expect(result.quarantineMissing).toEqual([]);
        });

        it('keeps a quarantined file out of the unit gate', () => {
            const unit = result.suites.find((s) => s.name === 'unit');
            for (const file of result.quarantined) {
                expect(unit.files).not.toContain(file);
            }
        });
    });

    describe('the skip detector', () => {
        // The fixtures below are assembled from fragments on purpose. Written
        // literally, each one IS a disabled-test call site, and the scan above
        // — which reads this file like any other — would report all eight.
        // Splitting them keeps the detector free of self-exemptions; an
        // exemption list is how the original exclusions grew.
        const dot = (fn, mod) => `${fn}.${mod}("x", () => {})`;
        const pre = (fn) => `x${fn}("x", () => {})`;

        // It has to see the real call shapes, and not fire on prose — a comment
        // saying "we skip empty carts" must not be reported as a disabled test.
        it.each([
            dot('it', 'skip'),
            dot('test', 'skip'),
            dot('describe', 'skip'),
            pre('it'),
            pre('describe'),
            pre('test'),
            `${'it'}.todo("later")`,
            `    ${'it'}.skip( "indented", () => {})`,
        ])('flags %s', (line) => expect(SKIP_CALL.test(line)).toBe(true));

        it.each([
            '// we skip empty carts here',
            'const skipped = list.filter(x => x.skip);',
            'expect(res.skip).toBe(true);',
            'it("does not skip valid orders", () => {})',
            'await queue.skip();',
        ])('does not flag %s', (line) => expect(SKIP_CALL.test(line)).toBe(false));
    });
});
