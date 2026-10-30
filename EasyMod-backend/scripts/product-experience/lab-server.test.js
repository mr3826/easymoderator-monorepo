'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createLabServer, DATASET_PATH } = require('./lab-server');

const post = (url, token, body, originOverride) => new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const target = new URL(url);
    const request = http.request({
        hostname: '127.0.0.1',
        port: Number(target.port),
        path: target.pathname + target.search,
        method: 'POST',
        headers: {
            Host: target.host,
            Origin: originOverride || target.origin,
            'Content-Type': 'application/json',
            'Content-Length': payload.length,
            ...(token ? { 'X-Lab-Token': token } : {}),
        },
    }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end(payload);
});

const postBytes = (url, token, bytes) => new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request({
        hostname: '127.0.0.1', port: Number(target.port), path: '/__lab/api/runs', method: 'POST',
        headers: { Host: target.host, Origin: target.origin, 'Content-Type': 'application/json', 'Content-Length': bytes.length, 'X-Lab-Token': token },
    }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end(bytes);
});

const get = (url, pathName = '/') => new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request({ hostname: '127.0.0.1', port: Number(target.port), path: pathName, method: 'GET', headers: { Host: target.host } }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end();
});

const start = async options => {
    const server = createLabServer({ datasetPath: DATASET_PATH, ...options });
    await server.start();
    return { server, url: `http://127.0.0.1:${server.address().port}`, token: server.lab.token };
};

const describeDataset = fs.existsSync(DATASET_PATH) ? describe : describe.skip;
describeDataset('local Product Engine Test Lab HTTP server', () => {
    let active;

    afterEach(async () => {
        if (active?.server?.listening) await new Promise(resolve => active.server.close(resolve));
        active = null;
    });

    test('serves a tokenized same-origin UI, health, and a PII-safe 20-persona/200-turn dataset index', async () => {
        active = await start();
        const page = await get(active.url);
        expect(page.status).toBe(200);
        expect(page.headers['content-security-policy']).toContain("connect-src 'self'");
        expect(page.headers['content-security-policy']).toContain("style-src 'self' 'sha256-YjaKGiklmzC6wjXA513HAMmzus8VE61XCOT+SmwNZWA='");
        expect(page.headers['content-security-policy']).not.toContain("'unsafe-inline'");
        expect(page.body).toContain(`name="lab-token" content="${active.token}"`);
        expect(page.body).not.toContain('http://');

        const health = await get(active.url, '/__lab/api/health');
        expect(JSON.parse(health.body)).toMatchObject({ status: 'ready', datasetAvailable: true });
        const dataset = JSON.parse((await get(active.url, '/__lab/api/dataset')).body);
        expect(dataset.source).toMatchObject({ personaCount: 20, scenarioCount: 200 });
        expect(dataset.personas).toHaveLength(20);
        expect(dataset.provenance).toMatchObject({ sourceTextReturned: false, expectationTextUsedAsGroundTruth: false });
        expect(JSON.stringify(dataset)).not.toMatch(/customerMessage|simulatedAttachment|expectedAnswer|sourceHash/i);
    }, 60_000);

    test('rejects cross-origin, missing-token, and over-limit mutating requests', async () => {
        active = await start({ runner: async () => ({ status: 'completed', turns: [] }) });
        const valid = { scope: 'persona', personaId: 'P01', mode: 'candidate' };
        expect((await post(`${active.url}/__lab/api/runs`, active.token, valid, 'http://example.com')).status).toBe(403);
        expect((await post(`${active.url}/__lab/api/runs`, null, valid)).status).toBe(403);
        const oversized = await postBytes(`${active.url}/__lab/api/runs`, active.token, Buffer.from(' '.repeat(64 * 1024 + 1)));
        expect(oversized.status).toBe(413);
    });

    test('keeps run requests bounded, rejects concurrent runs, and exposes sanitized receipts and exports', async () => {
        let release;
        const wait = new Promise(resolve => { release = resolve; });
        active = await start({ runner: async run => {
            await wait;
            return {
                ...run,
                status: 'completed',
                completedAt: new Date().toISOString(),
                summary: { turns: 10 },
                turns: [{ scenarioId: 'scenario-01-01', personaId: 'P01', turn: 1, disposition: 'SAFE_FALLBACK', responseTextStored: false, latencyMs: 1 }],
            };
        } });
        const request = { scope: 'persona', personaId: 'P01', mode: 'candidate' };
        const accepted = await post(`${active.url}/__lab/api/runs`, active.token, request);
        expect(accepted.status).toBe(202);
        const { runId } = JSON.parse(accepted.body);
        expect(runId).toMatch(/^[a-f0-9-]{36}$/i);
        expect((await post(`${active.url}/__lab/api/runs`, active.token, request)).status).toBe(409);
        expect((await post(`${active.url}/__lab/api/runs`, active.token, { ...request, customerText: 'secret' })).status).toBe(400);
        release();
        for (let attempt = 0; attempt < 30; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 5));
            const receipt = await get(active.url, `/__lab/api/runs/${runId}`);
            if (JSON.parse(receipt.body).status === 'completed') break;
        }
        const jsonExport = await get(active.url, `/__lab/api/export/${runId}.json`);
        expect(jsonExport.status).toBe(200);
        const exported = JSON.parse(jsonExport.body);
        expect(exported.turns).toHaveLength(1);
        expect(exported.turns[0].responseTextStored).toBe(false);
        expect(JSON.stringify(exported)).not.toMatch(/responsePreview|responseDigest|customerMessage|sourceHash/i);
        const csvExport = await get(active.url, `/__lab/api/export/${runId}.csv`);
        expect(csvExport.body).toContain('scenario-01-01');
        expect(csvExport.body.split('\r\n')[0]).not.toContain('responseDigest');
        expect((await get(active.url, `/__lab/api/export/${runId}x.json`)).status).toBe(404);
        expect(path.resolve(DATASET_PATH)).toContain('customer-simulator.csv');
    });

    test('serves sanitized evidence and validates playground tenant, reset body, and session scope', async () => {
        active = await start({ runner: async operation => operation.operation === 'playground'
            ? { answer: 'Synthetic catalog answer.', disposition: 'SAFE_FALLBACK' }
            : ({ status: 'completed', turns: [] }) });
        const evidence = JSON.parse((await get(active.url, '/__lab/api/evidence/scenario-01-01')).body);
        expect(evidence).toHaveProperty('oracle');
        expect(evidence.evidence.every(item => item.source === 'synthetic-fixture')).toBe(true);
        expect((await get(active.url, '/__lab/api/evidence/%2e%2e%2f.env')).status).toBe(404);
        const base = { tenantId: 'merchant-a', sessionId: 'session-browser-e2e', message: 'Is the fixture shirt available?' };
        const played = await post(`${active.url}/__lab/api/playground`, active.token, base);
        expect(played.status).toBe(200);
        expect(JSON.parse(played.body).answer).toBe('Synthetic catalog answer.');
        expect((await post(`${active.url}/__lab/api/playground`, active.token, { ...base, tenantId: 'real-shop-1' })).status).toBe(400);
        expect((await post(`${active.url}/__lab/api/sessions/session-browser-e2e/reset`, active.token, { extra: true })).status).toBe(400);
        const reset = await post(`${active.url}/__lab/api/sessions/session-browser-e2e/reset`, active.token, {});
        expect(reset.status).toBe(200);
        expect(JSON.parse(reset.body).priorSessionFound).toBe(true);
    });

    test('serves fixed answerable and unknown evidence cases without accepting arbitrary evidence paths', async () => {
        active = await start();
        const knownA = JSON.parse((await get(active.url, '/__lab/api/evidence/targeted-price-a')).body);
        const knownB = JSON.parse((await get(active.url, '/__lab/api/evidence/targeted-price-b')).body);
        const unknown = JSON.parse((await get(active.url, '/__lab/api/evidence/targeted-unknown')).body);
        expect(knownA).toMatchObject({ tenantId: 'fixture-shop-a', oracle: { eligibility: 'ANSWERABLE', requiredEvidence: [{ field: 'price', expectedValue: 900 }] } });
        expect(knownB).toMatchObject({ tenantId: 'fixture-shop-b', oracle: { eligibility: 'ANSWERABLE', requiredEvidence: [{ field: 'price', expectedValue: 1050 }] } });
        expect(unknown).toMatchObject({ oracle: { eligibility: 'NOT_ANSWERABLE', requiredEvidence: [] }, evidence: [] });
        expect((await get(active.url, '/__lab/api/evidence/other-file')).status).toBe(404);
    });

    test('allows only the fixed safety triage rerun operation', async () => {
        active = await start({ runner: async operation => ({ runId: '00000000-0000-4000-8000-000000000001', fixtureId: operation.fixtureId, candidate: { blocked: true, status: 'BLOCKED_BY_GROUNDING' } }) });
        const rerun = await post(`${active.url}/__lab/api/triage/unsafe-price-claim/rerun`, active.token, {});
        expect(rerun.status).toBe(200);
        expect(JSON.parse(rerun.body)).toMatchObject({ fixtureId: 'unsafe-price-claim', candidate: { blocked: true } });
        expect((await post(`${active.url}/__lab/api/triage/arbitrary/rerun`, active.token, {})).status).toBe(404);
        expect((await post(`${active.url}/__lab/api/triage/unsafe-price-claim/rerun`, active.token, { command: 'whoami' })).status).toBe(400);
    });
});
