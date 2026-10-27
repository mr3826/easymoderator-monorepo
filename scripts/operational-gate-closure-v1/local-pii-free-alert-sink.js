'use strict';

/**
 * Local-only Slack-compatible receipt sink for an isolated rehearsal.
 *
 * It accepts JSON { text } at POST /webhook, returns the `ok` body expected by
 * Slack incoming webhooks, and never writes the request text to disk or logs.
 * GET /receipt exposes only an in-memory count, timestamp, byte count, and
 * SHA-256 digest so a local delivery can be evidenced without retaining alert
 * details that may contain identifiers. Do not publish this port outside the
 * isolated Compose network.
 */

const http = require('node:http');
const crypto = require('node:crypto');

const host = process.env.ALERT_SINK_HOST || '127.0.0.1';
const port = Number(process.env.ALERT_SINK_PORT || 8081);
const maxBodyBytes = 32 * 1024;
const maxReceipts = 100;
const receipts = [];
let sequence = 0;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('ALERT_SINK_PORT must be a TCP port from 1 to 65535');
}

function respondJson(res, status, value) {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'close',
    });
    res.end(JSON.stringify(value));
}

const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
        return respondJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && req.url === '/receipt') {
        return respondJson(res, 200, {
            receiptCount: sequence,
            retainedCount: receipts.length,
            receipts: [...receipts],
        });
    }

    if (req.method !== 'POST' || req.url !== '/webhook') {
        return respondJson(res, 404, { error: 'not_found' });
    }

    const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
        req.resume();
        return respondJson(res, 415, { error: 'application_json_required' });
    }

    const chunks = [];
    let byteLength = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
        byteLength += chunk.length;
        if (byteLength > maxBodyBytes) {
            tooLarge = true;
            chunks.length = 0;
            return;
        }
        if (!tooLarge) chunks.push(chunk);
    });
    req.on('error', () => {
        if (!res.headersSent) respondJson(res, 400, { error: 'request_failed' });
    });
    req.on('end', () => {
        if (tooLarge) return respondJson(res, 413, { error: 'payload_too_large' });

        const raw = Buffer.concat(chunks);
        let payload;
        try {
            payload = JSON.parse(raw.toString('utf8'));
        } catch {
            return respondJson(res, 400, { error: 'invalid_json' });
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)
            || typeof payload.text !== 'string') {
            return respondJson(res, 400, { error: 'slack_text_payload_required' });
        }

        sequence += 1;
        receipts.push({
            sequence,
            receivedAt: new Date().toISOString(),
            method: req.method,
            path: req.url,
            contentType,
            byteLength,
            bodySha256: crypto.createHash('sha256').update(raw).digest('hex'),
        });
        if (receipts.length > maxReceipts) receipts.shift();

        res.writeHead(200, {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
            connection: 'close',
        });
        res.end('ok');
    });
});

server.listen(port, host, () => {
    // Intentionally no request bodies, URLs, or credentials are logged.
    process.stdout.write(JSON.stringify({ event: 'alert_sink_ready', host, port }) + '\n');
});

function shutdown() {
    server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
