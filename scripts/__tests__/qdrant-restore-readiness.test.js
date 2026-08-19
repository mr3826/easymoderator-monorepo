'use strict';

const fs = require('fs');
const path = require('path');

const {
    formatReadinessResult,
    probeReadiness,
    waitForReadiness,
} = require('../qdrant-restore-readiness');

const WORKFLOW_PATH = path.resolve(__dirname, '../../.github/workflows/qdrant-migration.yml');

const response = (status) => ({
    ok: status >= 200 && status < 300,
    status,
});

describe('bounded Qdrant restore readiness', () => {
    it('aborts a hanging readiness request at the inner timeout', async () => {
        let signal;
        const result = await probeReadiness('http://restore:6333/readyz', {
            requestTimeoutMs: 10,
            fetchImpl: jest.fn((_url, options) => {
                signal = options.signal;
                return new Promise(() => {});
            }),
        });

        expect(result).toMatchObject({ ready: false, errorType: 'REQUEST_TIMEOUT' });
        expect(signal.aborted).toBe(true);
    });

    it('retries after a transient network failure', async () => {
        const fetchImpl = jest.fn()
            .mockRejectedValueOnce(new Error('connection refused'))
            .mockResolvedValueOnce(response(200));

        const result = await waitForReadiness('http://restore:6333/readyz', {
            fetchImpl,
            requestTimeoutMs: 20,
            deadlineMs: 100,
            retryIntervalMs: 1,
        });

        expect(result).toMatchObject({ ready: true, attempts: 2, httpStatus: '200' });
    });

    it('retries non-ready HTTP responses before succeeding', async () => {
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(response(503))
            .mockResolvedValueOnce(response(503))
            .mockResolvedValueOnce(response(200));

        const result = await waitForReadiness('http://restore:6333/readyz', {
            fetchImpl,
            requestTimeoutMs: 20,
            deadlineMs: 100,
            retryIntervalMs: 1,
        });

        expect(result).toMatchObject({ ready: true, attempts: 3, httpStatus: '200' });
    });

    it('passes when restore becomes ready before the deadline', async () => {
        const result = await waitForReadiness('http://restore:6333/readyz', {
            fetchImpl: jest.fn().mockResolvedValue(response(200)),
            requestTimeoutMs: 20,
            deadlineMs: 100,
            retryIntervalMs: 1,
        });

        expect(result.ready).toBe(true);
        expect(result.failureType).toBeNull();
        expect(result.elapsedMs).toBeLessThan(100);
    });

    it('returns a deterministic bounded timeout when readiness never arrives', async () => {
        const result = await waitForReadiness('http://restore:6333/readyz', {
            fetchImpl: jest.fn().mockResolvedValue(response(503)),
            requestTimeoutMs: 10,
            deadlineMs: 25,
            retryIntervalMs: 1,
        });

        expect(result).toMatchObject({
            ready: false,
            failureType: 'BOUNDED_TIMEOUT',
            httpStatus: '503',
            qdrantStatus: 'not_ready',
        });
        expect(result.attempts).toBeGreaterThan(1);
        expect(result.elapsedMs).toBeGreaterThanOrEqual(25);
    });

    it('retains sanitized HTTP and network diagnostics', async () => {
        const httpFailure = await probeReadiness('http://restore:6333/readyz', {
            requestTimeoutMs: 20,
            fetchImpl: jest.fn().mockResolvedValue(response(503)),
        });
        const networkFailure = await probeReadiness('http://restore:6333/readyz', {
            requestTimeoutMs: 20,
            fetchImpl: jest.fn().mockRejectedValue(new Error('secret-bearing transport detail')),
        });

        expect(httpFailure).toMatchObject({ httpStatus: '503', qdrantStatus: 'not_ready', errorType: 'HTTP_NOT_READY' });
        expect(networkFailure).toMatchObject({ httpStatus: 'UNAVAILABLE', qdrantStatus: 'unavailable', errorType: 'NETWORK_ERROR' });
        expect(networkFailure.errorSummary).not.toContain('secret-bearing');
    });

    it('reports request timeout separately from the overall deadline', async () => {
        const result = await waitForReadiness('http://restore:6333/readyz', {
            fetchImpl: jest.fn(() => new Promise(() => {})),
            requestTimeoutMs: 10,
            deadlineMs: 35,
            retryIntervalMs: 1,
        });

        expect(result).toMatchObject({ failureType: 'BOUNDED_TIMEOUT', errorType: 'REQUEST_TIMEOUT' });
        expect(result.elapsedMs).toBeGreaterThanOrEqual(35);
    });

    it('formats the required bounded failure evidence without the URL', () => {
        const output = formatReadinessResult({
            ready: false,
            attempts: 4,
            elapsedMs: 180000,
            httpStatus: 'TIMEOUT',
            qdrantStatus: 'unavailable',
            failureType: 'BOUNDED_TIMEOUT',
            errorType: 'REQUEST_TIMEOUT',
            errorSummary: 'readiness request exceeded its bounded timeout',
        }, {
            requestTimeoutMs: 5000,
            deadlineMs: 180000,
            retryIntervalMs: 2000,
        });

        expect(output).toContain('ROLLBACK_RESTORE_READINESS=FAIL');
        expect(output).toContain('FAILURE_TYPE=BOUNDED_TIMEOUT');
        expect(output).toContain('ATTEMPTS=4');
        expect(output).toContain('ELAPSED_MS=180000');
        expect(output).not.toContain('http://');
    });

    it('contains no collection deletion or live-alias operation in the readiness workflow', () => {
        const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
        const readinessSection = workflow.slice(workflow.indexOf('docker run -d --name "$RESTORE_CONTAINER"'));

        expect(readinessSection).not.toMatch(/docker (?:rm|compose .*rm).*knowledge_documents/);
        expect(readinessSection).not.toMatch(/(?:switch|set).*(?:alias|ACTIVE_COLLECTION)/i);
        expect(readinessSection).toContain('ROLLBACK_RESTORE_READINESS=FAIL');
    });

    it('keeps restore validation after readiness and before the restore PASS marker', () => {
        const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
        const readiness = workflow.indexOf('ROLLBACK_RESTORE_READINESS=PASS');
        const validation = workflow.indexOf('restore-validate.log');
        const restorePass = workflow.indexOf('OPENAI_ROLLBACK_RESTORE=PASS');

        expect(readiness).toBeGreaterThan(-1);
        expect(validation).toBeGreaterThan(readiness);
        expect(restorePass).toBeGreaterThan(validation);
    });
});
