'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createLabServer, DATASET_PATH, BASELINE_SHA } = require('./lab-server');

const effectiveBackendSourceSha256 = (routerOverrideBytes = null) => {
    const sourceRoot = path.resolve(__dirname, '../../src');
    const routerPath = 'modules/ai/intent-router.service.js';
    const files = [];
    const visit = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(fullPath);
            else if (entry.isFile() && !entry.name.startsWith('intent-router.lab-baseline-')) files.push(fullPath);
        }
    };
    visit(sourceRoot);
    files.sort((left, right) => {
        const a = path.relative(sourceRoot, left).replace(/\\/g, '/');
        const b = path.relative(sourceRoot, right).replace(/\\/g, '/');
        return a < b ? -1 : a > b ? 1 : 0;
    });
    const hash = crypto.createHash('sha256');
    for (const filePath of files) {
        const relativePath = path.relative(sourceRoot, filePath).replace(/\\/g, '/');
        const source = relativePath === routerPath && routerOverrideBytes !== null
            ? routerOverrideBytes
            : fs.readFileSync(filePath);
        hash.update(relativePath, 'utf8').update('\0').update(source).update('\0');
    }
    return hash.digest('hex');
};

const request = async (base, token, pathname, body) => {
    const response = await fetch(`${base}${pathname}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
            ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Lab-Token': token }),
            ...(body === undefined ? {} : { Origin: base }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
};

const waitForRun = async (base, token, runId, timeoutMs = 180000) => {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        const result = await request(base, token, `/__lab/api/runs/${runId}`);
        last = result.data;
        if (['completed', 'failed'].includes(last.status)) return last;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Run did not reach a terminal state: ${last?.status || 'unknown'}`);
};

describe('Test Lab spawned production-route processes', () => {
    jest.setTimeout(360000);
    let server;

    afterEach(async () => {
        if (server?.listening) await new Promise(resolve => server.close(resolve));
        server = null;
    });

    const testDataset = fs.existsSync(DATASET_PATH) ? test : test.skip;
    testDataset('executes a real spawned persona replay, playground turn, and fixed triage case', async () => {
        server = createLabServer({ datasetPath: DATASET_PATH });
        await server.start();
        const base = `http://127.0.0.1:${server.address().port}`;
        const token = server.lab.token;

        const accepted = await request(base, token, '/__lab/api/runs', { scope: 'persona', personaId: 'P01', mode: 'candidate' });
        expect(accepted.status).toBe(202);
        const run = await waitForRun(base, token, accepted.data.runId);
        expect(run.status).toBe('completed');
        expect(run.dataset).toMatchObject({ executedTurns: 10, rawSourceMessagesPersisted: false });
        expect(run.turns).toHaveLength(10);
        expect(run.engineSourceSha256).toMatch(/^[a-f0-9]{64}$/i);
        expect(run.engineSourceSha256).toBe(effectiveBackendSourceSha256());
        expect(run.engineSourceRevision).toContain('+backend-src-sha256:');
        expect(run.engineSourceRevision).toContain(run.engineSourceSha256);
        expect(run.targetedEvaluation.eligibleFactSlots).toBeGreaterThan(0);
        expect(run.targetedEvaluation.tenantIsolationPass).toBe(true);
        expect(run.triageFixtures[0].fixtureId).toBe('unsafe-price-claim');

        const baselineAccepted = await request(base, token, '/__lab/api/runs', { scope: 'persona', personaId: 'P01', mode: 'baseline' });
        expect(baselineAccepted.status).toBe(202);
        const baseline = await waitForRun(base, token, baselineAccepted.data.runId);
        expect(baseline.status).toBe('completed');
        expect(baseline.sourceRevision).toBe('957bb991a18db1949369a6f805822b8c8b69889b');
        const baselineRouterSource = execFileSync('git', ['show', `${BASELINE_SHA}:EasyMod-backend/src/modules/ai/intent-router.service.js`], {
            cwd: path.resolve(__dirname, '../../..'),
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        expect(baseline.engineSourceRevision).toContain(`${BASELINE_SHA}+backend-src-sha256:`);
        expect(baseline.engineSourceSha256).toMatch(/^[a-f0-9]{64}$/i);
        expect(baseline.engineSourceSha256).toBe(effectiveBackendSourceSha256(baselineRouterSource));

        const playground = await request(base, token, '/__lab/api/playground', {
            tenantId: 'merchant-a', sessionId: 'session-process-run', message: 'Test Everyday T-Shirt er dam koto?',
        });
        expect(playground.status).toBe(200);
        expect(playground.data).toMatchObject({ status: 'completed', tenantId: 'merchant-a', provider: { actualProviderUsage: false }, provenance: { externalCalls: 0 } });
        expect(playground.data.engineSourceSha256).toMatch(/^[a-f0-9]{64}$/i);
        expect(playground.data.productEvidence.productIds).toContain('fixture-shop-a-cotton-tee');

        const triage = await request(base, token, '/__lab/api/triage/unsafe-price-claim/rerun', {});
        expect(triage.status).toBe(200);
        expect(triage.data).toMatchObject({ status: 'completed', fixtureId: 'unsafe-price-claim', candidate: { fixtureId: 'unsafe-price-claim', externalCalls: 0 } });
        expect(JSON.stringify({ run, baseline, playground: playground.data, triage: triage.data })).not.toMatch(/Test Everyday T-Shirt er dam koto\?|450 at a 50% discount/i);
    });
});
