'use strict';

// The pinned Qdrant image does not include curl/wget. This small Node sidecar
// reports health only while the Qdrant HTTP readiness endpoint is returning
// success; it is attached only to the isolated closure network.
const http = require('node:http');

const port = Number(process.env.QDRANT_PROBE_PORT || 8082);
const target = process.env.QDRANT_READY_URL || 'http://qdrant:6333/readyz';

const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET' || req.url !== '/healthz') {
        res.writeHead(404).end();
        return;
    }

    try {
        const response = await fetch(target, { signal: AbortSignal.timeout(1500) });
        const status = response.ok ? 200 : 503;
        res.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
        res.end(JSON.stringify({ ok: response.ok }));
    } catch {
        res.writeHead(503, { 'content-type': 'application/json', connection: 'close' });
        res.end(JSON.stringify({ ok: false }));
    }
});

server.listen(port, '0.0.0.0');

function shutdown() {
    server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
