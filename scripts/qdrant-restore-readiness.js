'use strict';

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_DEADLINE_MS = 180000;
const DEFAULT_RETRY_INTERVAL_MS = 2000;

const positiveInteger = (value, fallback, name) => {
    const parsed = Number.parseInt(value ?? fallback, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return parsed;
};

const responseStatus = (response) => (
    Number.isInteger(response?.status) ? String(response.status) : 'UNKNOWN'
);

const isAbortError = (error) => error?.name === 'AbortError' || error?.code === 'ABORT_ERR';

/**
 * Perform one bounded readiness request. The race is intentional: it protects
 * the proof even if a test double or a broken transport does not honor abort.
 */
async function probeReadiness(url, {
    fetchImpl = globalThis.fetch,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
    const timeoutMs = positiveInteger(requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 'requestTimeoutMs');
    if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is unavailable');

    const controller = new AbortController();
    let timeoutHandle;
    const request = Promise.resolve()
        .then(() => fetchImpl(url, { signal: controller.signal }))
        .then((response) => {
            const ready = Boolean(response?.ok);
            return {
                ready,
                httpStatus: responseStatus(response),
                qdrantStatus: ready ? 'ready' : 'not_ready',
                errorType: ready ? null : 'HTTP_NOT_READY',
                errorSummary: ready ? null : 'readiness endpoint returned a non-success status',
            };
        })
        .catch((error) => ({
            ready: false,
            httpStatus: 'UNAVAILABLE',
            qdrantStatus: 'unavailable',
            errorType: isAbortError(error) ? 'REQUEST_ABORTED' : 'NETWORK_ERROR',
            errorSummary: isAbortError(error) ? 'readiness request aborted' : 'readiness request failed',
        }));

    const timeout = new Promise((resolve) => {
        timeoutHandle = setTimeout(() => {
            controller.abort();
            resolve({
                ready: false,
                httpStatus: 'TIMEOUT',
                qdrantStatus: 'unavailable',
                errorType: 'REQUEST_TIMEOUT',
                errorSummary: 'readiness request exceeded its bounded timeout',
            });
        }, timeoutMs);
    });

    try {
        return await Promise.race([request, timeout]);
    } finally {
        clearTimeout(timeoutHandle);
    }
}

/**
 * Poll readiness with an explicit overall deadline. This function performs
 * only GET/readiness checks and returns sanitized diagnostics for the caller.
 */
async function waitForReadiness(url, {
    fetchImpl = globalThis.fetch,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    deadlineMs = DEFAULT_DEADLINE_MS,
    retryIntervalMs = DEFAULT_RETRY_INTERVAL_MS,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
} = {}) {
    const requestTimeout = positiveInteger(requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 'requestTimeoutMs');
    const deadline = positiveInteger(deadlineMs, DEFAULT_DEADLINE_MS, 'deadlineMs');
    const retryInterval = positiveInteger(retryIntervalMs, DEFAULT_RETRY_INTERVAL_MS, 'retryIntervalMs');
    const startedAt = now();
    let attempts = 0;
    let last = {
        httpStatus: 'NOT_ATTEMPTED',
        qdrantStatus: 'not_attempted',
        errorType: 'NOT_ATTEMPTED',
        errorSummary: 'readiness was not checked',
    };

    while (now() - startedAt < deadline) {
        attempts += 1;
        const elapsedBeforeRequest = Math.max(0, now() - startedAt);
        const remainingMs = deadline - elapsedBeforeRequest;
        last = await probeReadiness(url, {
            fetchImpl,
            requestTimeoutMs: Math.min(requestTimeout, remainingMs),
        });

        const elapsedAfterRequest = Math.max(0, now() - startedAt);
        if (last.ready) {
            return {
                ...last,
                attempts,
                elapsedMs: elapsedAfterRequest,
                failureType: null,
            };
        }
        if (elapsedAfterRequest >= deadline) break;

        await sleep(Math.min(retryInterval, deadline - elapsedAfterRequest));
    }

    return {
        ready: false,
        attempts,
        elapsedMs: Math.max(0, now() - startedAt),
        httpStatus: last.httpStatus,
        qdrantStatus: last.qdrantStatus,
        errorType: last.errorType,
        errorSummary: last.errorSummary,
        failureType: 'BOUNDED_TIMEOUT',
    };
}

function formatReadinessResult(result, {
    requestTimeoutMs,
    deadlineMs,
    retryIntervalMs,
} = {}) {
    const lines = [
        `READINESS_REQUEST_TIMEOUT_MS=${requestTimeoutMs}`,
        `READINESS_DEADLINE_MS=${deadlineMs}`,
        `READINESS_RETRY_INTERVAL_MS=${retryIntervalMs}`,
        `ROLLBACK_RESTORE_READINESS=${result.ready ? 'PASS' : 'FAIL'}`,
        `ATTEMPTS=${result.attempts}`,
        `ELAPSED_MS=${result.elapsedMs}`,
        `LAST_HTTP_STATUS=${result.httpStatus}`,
        `LAST_QDRANT_STATUS=${result.qdrantStatus}`,
    ];
    if (!result.ready) {
        lines.push(
            `FAILURE_TYPE=${result.failureType}`,
            `LAST_ERROR_TYPE=${result.errorType}`,
            `LAST_ERROR_SUMMARY=${result.errorSummary}`,
        );
    }
    return lines.join('\n');
}

async function main() {
    const [url, rawRequestTimeout, rawDeadline, rawRetryInterval] = process.argv.slice(2);
    if (!url) {
        console.error('readiness URL is required');
        process.exitCode = 2;
        return;
    }

    try {
        const requestTimeoutMs = positiveInteger(rawRequestTimeout, DEFAULT_REQUEST_TIMEOUT_MS, 'requestTimeoutMs');
        const deadlineMs = positiveInteger(rawDeadline, DEFAULT_DEADLINE_MS, 'deadlineMs');
        const retryIntervalMs = positiveInteger(rawRetryInterval, DEFAULT_RETRY_INTERVAL_MS, 'retryIntervalMs');
        const result = await waitForReadiness(url, {
            requestTimeoutMs,
            deadlineMs,
            retryIntervalMs,
        });
        console.log(formatReadinessResult(result, { requestTimeoutMs, deadlineMs, retryIntervalMs }));
        process.exitCode = result.ready ? 0 : 1;
    } catch (error) {
        console.log([
            'ROLLBACK_RESTORE_READINESS=FAIL',
            'FAILURE_TYPE=CONFIGURATION_ERROR',
            'ATTEMPTS=0',
            'ELAPSED_MS=0',
            'LAST_HTTP_STATUS=NOT_ATTEMPTED',
            'LAST_QDRANT_STATUS=not_attempted',
            'LAST_ERROR_TYPE=CONFIGURATION_ERROR',
            'LAST_ERROR_SUMMARY=readiness probe configuration is invalid',
        ].join('\n'));
        process.exitCode = 2;
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    DEFAULT_REQUEST_TIMEOUT_MS,
    DEFAULT_DEADLINE_MS,
    DEFAULT_RETRY_INTERVAL_MS,
    formatReadinessResult,
    probeReadiness,
    waitForReadiness,
};
