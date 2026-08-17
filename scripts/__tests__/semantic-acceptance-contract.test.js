'use strict';

const fs = require('fs');
const path = require('path');

const contract = require('../semantic-acceptance-contract');
const fixtures = require('../semantic-calibration-fixtures');

const identity = {
    provider: contract.ACCEPTANCE_PROVIDER,
    model: contract.ACCEPTANCE_MODEL,
    dimensions: contract.ACCEPTANCE_DIMENSIONS,
    embedding_space_version: contract.ACCEPTANCE_EMBEDDING_SPACE_VERSION,
};

function readyContract(overrides = {}) {
    return {
        ...contract.PROOF_ACCEPTANCE_CONTRACT,
        status: 'READY',
        negative_ceiling: 0.62,
        positive_floor_p05: 0.78,
        calibration_run_id: '32037101526',
        calibration_commit_sha: 'a'.repeat(40),
        workflow_run_id: '32037101526',
        generated_at: '2026-08-17T00:00:00.000Z',
        threshold_derivation: {
            ...contract.PROOF_ACCEPTANCE_CONTRACT.threshold_derivation,
            status: 'READY',
            negativeMaximum: 0.57,
            candidateCeiling: 0.62,
            positiveFloorP05: 0.78,
        },
        ...overrides,
    };
}

describe('semantic acceptance contract', () => {
    it('keeps positive rank correctness and score floor', () => {
        expect(contract.evaluatePositiveCase({ expectedRank: 1, expectedScore: 0.25 })).toEqual({
            pass: true,
            reason: 'NONE',
        });
        expect(contract.evaluatePositiveCase({ expectedRank: 2, expectedScore: 0.9 }).pass).toBe(false);
        expect(contract.evaluatePositiveCase({ expectedRank: 1, expectedScore: 0.24 }).pass).toBe(false);
    });

    it('uses a calibrated ceiling and lexical invariant for negatives', () => {
        const active = readyContract();
        expect(contract.evaluateNegativeCase({ topScore: 0.61, lexicalOverlap: false, contract: active })).toEqual({
            pass: true,
            reason: 'NONE',
        });
        expect(contract.evaluateNegativeCase({ topScore: 0.63, lexicalOverlap: false, contract: active }).reason)
            .toBe('NEGATIVE_RESULT_ABOVE_CALIBRATED_CEILING');
        expect(contract.evaluateNegativeCase({ topScore: 0.2, lexicalOverlap: true, contract: active }).reason)
            .toBe('NEGATIVE_FIXTURE_LEXICAL_OVERLAP');
    });

    it('fails closed while the checked-in contract is pending', () => {
        expect(contract.PROOF_ACCEPTANCE_CONTRACT.status).toBe('PENDING_RECALIBRATION');
        expect(contract.evaluateNegativeCase({ topScore: 0.1, lexicalOverlap: false }).reason)
            .toBe('SEMANTIC_CALIBRATION_NOT_READY');
        expect(() => contract.assertAcceptanceContract(contract.PROOF_ACCEPTANCE_CONTRACT, identity))
            .toThrow(expect.objectContaining({ code: 'SEMANTIC_CALIBRATION_NOT_READY' }));
    });

    it('rejects a ceiling without the required positive safety boundary', () => {
        expect(() => contract.assertAcceptanceContract(readyContract({
            negative_ceiling: 0.7,
            positive_floor_p05: 0.75,
            minimum_safe_gap: 0.1,
        }), identity)).toThrow(expect.objectContaining({ code: 'SEMANTIC_ACCEPTANCE_STALE' }));
    });

    it('rejects an active ceiling without calibration provenance', () => {
        expect(() => contract.assertAcceptanceContract(readyContract({
            calibration_commit_sha: null,
        }), identity)).toThrow(expect.objectContaining({ code: 'SEMANTIC_ACCEPTANCE_STALE' }));
    });

    it.each([
        ['provider', { identity: { provider: 'openai' } }, 'EMBEDDING_SPACE_MISMATCH'],
        ['model', { identity: { model: 'another-model' } }, 'EMBEDDING_SPACE_MISMATCH'],
        ['dimensions', { identity: { dimensions: 768 } }, 'EMBEDDING_SPACE_MISMATCH'],
        ['embedding space version', { identity: { embedding_space_version: 'old-space-v1' } }, 'EMBEDDING_SPACE_MISMATCH'],
        ['semantic acceptance version', { contract: { semantic_acceptance_version: 'old-acceptance-v1' } }, 'SEMANTIC_ACCEPTANCE_STALE'],
        ['fixture version', { contract: { fixture_version: 'sha256:stale' } }, 'SEMANTIC_ACCEPTANCE_STALE'],
    ])('rejects stale %s calibration', (_label, overrides, code) => {
        expect(() => contract.assertAcceptanceContract(readyContract(overrides.contract), {
            ...identity,
            ...overrides.identity,
        })).toThrow(expect.objectContaining({ code }));
    });

    it('derives no active ceiling from an undersized corpus', () => {
        const result = contract.deriveNegativeAcceptance({
            documents: [{ fixtureId: 'one' }],
            positiveCases: [{ expectedSourceExists: true, expectedRank: 1, expectedScore: 0.8 }],
            negativeCases: [{ topScore: 0.55, lexicalOverlap: [] }],
        });
        expect(result.status).toBe('INSUFFICIENT_CALIBRATION_EVIDENCE');
        expect(result.negativeCeiling).toBeNull();
    });

    it('requires a safety gap when deriving a ready ceiling', () => {
        const documents = Array.from({ length: 20 }, (_, index) => ({ fixtureId: `fixture-${index}` }));
        const positiveCases = Array.from({ length: 30 }, () => ({
            expectedSourceExists: true,
            expectedRank: 1,
            expectedScore: 0.82,
        }));
        const negativeCases = Array.from({ length: 30 }, () => ({
            topScore: 0.55,
            lexicalOverlap: [],
        }));
        const result = contract.deriveNegativeAcceptance({ documents, positiveCases, negativeCases });
        expect(result.status).toBe('READY');
        expect(result.negativeCeiling).toBe(0.6);
        expect(result.candidateSafetyGap).toBeGreaterThanOrEqual(contract.MINIMUM_SAFE_GAP);
    });

    it('builds a traceable active contract only from a ready candidate', () => {
        const candidate = {
            status: 'READY',
            negativeCeiling: 0.62,
            positiveFloorP05: 0.78,
            derivation: {
                method: 'controlled test derivation',
                negativeMaximum: 0.57,
                candidateCeiling: 0.62,
                positiveFloorP05: 0.78,
            },
        };
        const active = contract.createCalibratedContract({
            candidate,
            calibrationRunId: '32037101526',
            calibrationCommitSha: 'b'.repeat(40),
            workflowRunId: '32037101526',
            generatedAt: '2026-08-17T00:00:00.000Z',
        });
        expect(active.status).toBe('READY');
        expect(active.negative_ceiling).toBe(0.62);
        expect(active.calibration_commit_sha).toBe('b'.repeat(40));
        expect(active.threshold_derivation.candidateCeiling).toBe(0.62);
    });

    it('versions fixture content deterministically', () => {
        const input = {
            documents: fixtures.CONTROLLED_FIXTURE_DOCUMENTS,
            positiveQueries: fixtures.CONTROLLED_POSITIVE_QUERIES,
            negativeQueries: fixtures.CONTROLLED_NEGATIVE_QUERIES,
        };
        expect(fixtures.fixtureVersionFor(input)).toBe(fixtures.FIXTURE_VERSION);
        const changed = fixtures.fixtureVersionFor({
            ...input,
            documents: input.documents.map((document, index) => index === 0
                ? { ...document, content: `${document.content} Additional fictional detail.` }
                : document),
        });
        expect(changed).not.toBe(fixtures.FIXTURE_VERSION);
        expect(contract.CONTROLLED_FIXTURE_VERSION).toBe(fixtures.FIXTURE_VERSION);
    });

    it('is pure proof/calibration code with no Qdrant or database access', () => {
        const source = fs.readFileSync(path.resolve(__dirname, '../semantic-acceptance-contract.js'), 'utf8');
        expect(source).not.toMatch(/require\([^)]*(qdrant|pg|redis)/i);
        expect(source).not.toMatch(/fetch\s*\(|axios|docker\s+run|ssh\s+/i);
    });
});
