'use strict';

const crypto = require('crypto');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('MetaWebhookMetrics');

const MALFORMED_WEBHOOK_CODES = Object.freeze({
    INVALID_JSON: 'INVALID_JSON',
    INVALID_ENVELOPE: 'INVALID_ENVELOPE',
});

let malformedCount = 0;
let lastMalformedAt = null;

const toBodyBuffer = (rawBody) => {
    if (Buffer.isBuffer(rawBody)) return rawBody;
    return Buffer.from(rawBody == null ? '' : String(rawBody));
};

const stableCode = (code) => Object.values(MALFORMED_WEBHOOK_CODES).includes(code)
    ? code
    : 'MALFORMED_WEBHOOK';

/**
 * Record a malformed request without retaining or logging its contents.
 * The returned snapshot is intentionally limited to count/timestamp data.
 */
function recordMalformedWebhook({ rawBody, signatureValid = false, code } = {}) {
    const body = toBodyBuffer(rawBody);
    const diagnostics = {
        bodySize: body.length,
        bodyHash: crypto.createHash('sha256').update(body).digest('hex'),
        signatureValid: signatureValid === true,
        code: stableCode(code),
    };

    malformedCount += 1;
    lastMalformedAt = new Date().toISOString();

    try {
        logger.warn('Malformed Meta webhook payload', diagnostics);
    } catch (_) {
        // Diagnostics must never turn a safely acknowledged malformed request
        // into a retryable application failure.
    }

    return getMalformedWebhookMetrics();
}

function getMalformedWebhookMetrics() {
    return {
        count: malformedCount,
        lastAt: lastMalformedAt,
    };
}

module.exports = {
    MALFORMED_WEBHOOK_CODES,
    recordMalformedWebhook,
    getMalformedWebhookMetrics,
};
