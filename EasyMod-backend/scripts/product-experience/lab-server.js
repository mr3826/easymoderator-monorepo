'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { createCatalog } = require('./fixtures');
const {
    TENANTS,
    validateRunRequest,
    validatePlaygroundRequest,
    buildDatasetIndex,
    classifyOracleTurn,
} = require('./lab-contracts');
const { isTrustedLabRequest, MAX_BODY_BYTES } = require('./lab-security');

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');
const DATASET_PATH = path.resolve(REPO_ROOT, '..', 'customer-simulator.csv');
const UI_ROOT = path.join(__dirname, 'lab-ui');
const ARTIFACT_ROOT = path.join(REPO_ROOT, 'docs', 'ai', 'product-experience-v1-1', 'artifacts');
const RUNS_ROOT = path.join(ARTIFACT_ROOT, 'runs');
const TRIAGE_ROOT = path.join(ARTIFACT_ROOT, 'triage');
const BASELINE_SHA = 'c8981c4df9ea84d47c35f2541884fd55afd64bae';
const ROUTER_SOURCE_RELATIVE_PATH = 'EasyMod-backend/src/modules/ai/intent-router.service.js';
const MAX_CONCURRENT_RUNS = 1;
const RUN_ID = /^[a-f0-9-]{36}$/i;
const SCENARIO_ID = /^scenario-(?:0[1-9]|1\d|20)-(?:0[1-9]|10)$/;
const TARGETED_EVIDENCE = Object.freeze({
    'targeted-price-a': Object.freeze({ tenantId: 'fixture-shop-a', record: Object.freeze({ customerMessage: 'What is the price of the Test Everyday T-Shirt?', inputType: 'Text' }) }),
    'targeted-price-b': Object.freeze({ tenantId: 'fixture-shop-b', record: Object.freeze({ customerMessage: 'What is the price of the Test Everyday T-Shirt?', inputType: 'Text' }) }),
    'targeted-unknown': Object.freeze({ tenantId: 'fixture-shop-a', record: Object.freeze({ customerMessage: 'What is the price of the Mystery Moon Suit?', inputType: 'Text' }) }),
});

const resolveRevision = () => {
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').trim();
    } catch (_) {
        return 'unknown';
    }
};

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const hashLabRunnerSources = () => {
    const files = [
        'EasyMod-backend/scripts/product-experience/lab-server.js',
        'EasyMod-backend/scripts/product-experience/lab-security.js',
        'EasyMod-backend/scripts/product-experience/lab-replay.test.js',
        'EasyMod-backend/scripts/product-experience/fixtures.js',
        'EasyMod-backend/scripts/product-experience/lab-contracts.js',
    ];
    const hash = crypto.createHash('sha256');
    for (const relativePath of files) {
        hash.update(relativePath, 'utf8').update('\0');
        hash.update(fs.readFileSync(path.join(REPO_ROOT, relativePath))).update('\0');
    }
    return hash.digest('hex');
};

const baselineRouterModule = (runId) => {
    if (!RUN_ID.test(runId)) throw new Error('Baseline replay requires a generated run identifier.');
    const source = execFileSync('git', ['show', `${BASELINE_SHA}:${ROUTER_SOURCE_RELATIVE_PATH}`], {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 8 * 1024 * 1024,
    });
    const filename = `intent-router.lab-baseline-${runId}.js`;
    const filePath = path.join(BACKEND_ROOT, 'src', 'modules', 'ai', filename);
    fs.writeFileSync(filePath, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return {
        filePath,
        moduleName: `src/modules/ai/${filename.slice(0, -3)}`,
        sourceSha256: sha256(source),
    };
};

const sendJson = (response, statusCode, value, extraHeaders = {}) => {
    const body = Buffer.from(JSON.stringify(value));
    response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        ...extraHeaders,
    });
    response.end(body);
};

const readJsonBody = (request) => new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let tooLarge = false;
    const declaredLength = Number(request.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body exceeds the local limit.'), { statusCode: 413 }));
        request.resume();
        return;
    }
    request.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_BODY_BYTES) {
            tooLarge = true;
        } else if (!tooLarge) {
            chunks.push(chunk);
        }
    });
    request.on('end', () => {
        if (tooLarge) return reject(Object.assign(new Error('Request body exceeds the local limit.'), { statusCode: 413 }));
        if (!chunks.length) return resolve({});
        try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (_) {
            reject(Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }));
        }
    });
    request.on('error', reject);
});

const safeResponse = (run) => JSON.parse(JSON.stringify(run));

const createLabServer = ({ port = 0, host = '127.0.0.1', datasetPath = DATASET_PATH, runner = null } = {}) => {
    if (host !== '127.0.0.1') throw new Error('The Test Lab server must bind to IPv4 loopback.');
    const token = crypto.randomBytes(32).toString('hex');
    const catalog = createCatalog();
    let dataset = null;
    let datasetError = null;
    try {
        dataset = buildDatasetIndex(fs.readFileSync(datasetPath));
    } catch (error) {
        datasetError = error;
    }
    const currentRevision = resolveRevision();
    const candidateRouterSourceSha256 = sha256(fs.readFileSync(path.join(BACKEND_ROOT, 'src', 'modules', 'ai', 'intent-router.service.js')));
    const candidateEngineSourceRevision = `${currentRevision}+intent-router-sha256:${candidateRouterSourceSha256}`;
    const labRunnerSourceSha256 = hashLabRunnerSources();
    const labRunnerRevision = `${currentRevision}+runner-sha256:${labRunnerSourceSha256}`;
    const runs = new Map();
    const sessions = new Map();
    const childProcesses = new Set();
    const executeLabTest = (tempDir, env) => {
        const jestPath = path.join(BACKEND_ROOT, 'node_modules', 'jest', 'bin', 'jest.js');
        const testPath = path.join(__dirname, 'lab-replay.test.js');
        return new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [jestPath, '--config', path.join(BACKEND_ROOT, 'jest.config.js'), '--runInBand', '--runTestsByPath', testPath, '--coverage=false'], {
                cwd: tempDir,
                env,
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', chunk => { stdout = `${stdout}${chunk.toString('utf8')}`.slice(-20000); });
            child.stderr.on('data', chunk => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-20000); });
            childProcesses.add(child);
            child.once('error', error => { childProcesses.delete(child); reject(error); });
            child.once('close', (code, signal) => {
                childProcesses.delete(child);
                resolve({ code: code ?? 1, signal: signal || null, stdout, stderr });
            });
        });
    };

    const getRun = (runId) => {
        if (!RUN_ID.test(runId)) return null;
        const inMemory = runs.get(runId);
        if (inMemory) {
            const progressPath = path.join(RUNS_ROOT, `${runId}.progress.json`);
            try {
                const progress = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
                inMemory.progress = { completed: progress.completed, total: progress.total };
            } catch (_) {
                // Completed runs remove their transient progress file.
            }
            return inMemory;
        }
        const file = path.join(RUNS_ROOT, `${runId}.json`);
        try {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (_) {
            return null;
        }
    };

    const getHistory = () => {
        let filenames = [];
        try { filenames = fs.readdirSync(RUNS_ROOT).filter(name => RUN_ID.test(name.replace(/\.json$/, '')) && name.endsWith('.json')); } catch (_) { return []; }
        return filenames.map(name => {
            try {
                const run = JSON.parse(fs.readFileSync(path.join(RUNS_ROOT, name), 'utf8'));
                return {
                    runId: run.runId,
                    scope: run.scope,
                    personaId: run.personaId || null,
                    mode: run.mode,
                    status: run.status,
                    sourceRevision: run.sourceRevision,
                    startedAt: run.startedAt,
                    completedAt: run.completedAt,
                    summary: run.summary || {},
                };
            } catch (_) { return null; }
        }).filter(Boolean).sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
    };

    const spawnReplay = async (run) => {
        if (runner) return runner(run);
        fs.mkdirSync(RUNS_ROOT, { recursive: true });
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `easymod-lab-${process.pid}-${run.runId}-`));
        const outputPath = path.join(RUNS_ROOT, `${run.runId}.json`);
        const progressPath = path.join(RUNS_ROOT, `${run.runId}.progress.json`);
        const env = {
            SystemRoot: process.env.SystemRoot,
            WINDIR: process.env.WINDIR,
            TEMP: process.env.TEMP || os.tmpdir(),
            TMP: process.env.TMP || os.tmpdir(),
            PATH: path.dirname(process.execPath),
            NODE_ENV: 'test',
            INTENT_ROUTER_DISABLED: 'false',
            AI_VISION_ENABLED: 'false',
            AI_PHOTO_MATCH_ENABLED: 'false',
            DATABASE_URL: 'postgres://lab:lab@127.0.0.1:1/easymod_product_lab_test',
            REDIS_URL: 'redis://127.0.0.1:1',
            SLACK_ALERT_WEBHOOK_URL: '',
            SENTRY_DSN: '',
            QDRANT_URL: '',
            LAB_RUN_ID: run.runId,
            LAB_RUN_SCOPE: run.scope,
            LAB_PERSONA_ID: run.personaId || '',
            LAB_RUN_MODE: run.mode,
            LAB_RESULT_PATH: outputPath,
            LAB_PROGRESS_PATH: progressPath,
            LAB_DATASET_PATH: datasetPath,
            LAB_SOURCE_REVISION: run.mode === 'baseline' ? BASELINE_SHA : currentRevision,
            LAB_ENGINE_SOURCE_REVISION: run.mode === 'baseline' ? BASELINE_SHA : candidateEngineSourceRevision,
            LAB_ENGINE_SOURCE_SHA256: run.mode === 'baseline' ? '' : candidateRouterSourceSha256,
            LAB_RUNNER_REVISION: labRunnerRevision,
            LAB_RUNNER_SOURCE_SHA256: labRunnerSourceSha256,
        };
        let baselineModule = null;
        if (run.mode === 'baseline') {
            baselineModule = baselineRouterModule(run.runId);
            env.LAB_ROUTER_MODULE = baselineModule.moduleName;
            env.LAB_ENGINE_SOURCE_SHA256 = baselineModule.sourceSha256;
        }
        for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
        let childResult;
        try {
            childResult = await executeLabTest(tempDir, env);
        } finally {
            if (baselineModule) fs.rmSync(baselineModule.filePath, { force: true });
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        if (childResult.code !== 0) {
            try { fs.rmSync(outputPath, { force: true }); } catch (_) { }
            throw Object.assign(new Error('Production router replay runner failed.'), { reasonCode: 'LAB_RUNNER_FAILED', exitCode: childResult.code });
        }
        const artifact = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        if (artifact.runId !== run.runId || artifact.dataset?.sha256 !== dataset?.source.sha256) {
            throw Object.assign(new Error('Runner receipt did not match the requested run.'), { reasonCode: 'LAB_RECEIPT_MISMATCH' });
        }
        fs.rmSync(progressPath, { force: true });
        return artifact;
    };

    const runPlayground = async (input, session) => {
        if (runner) return runner({ operation: 'playground', input, session });
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `easymod-lab-playground-${process.pid}-`));
        const inputPath = path.join(tempDir, 'input.json');
        const resultPath = path.join(RUNS_ROOT, `${crypto.randomUUID()}.playground.json`);
        fs.mkdirSync(RUNS_ROOT, { recursive: true });
        const requestHistory = session.history.slice(-20);
        fs.writeFileSync(inputPath, JSON.stringify({
            tenantId: input.tenantId,
            sessionId: input.sessionId,
            message: input.message,
            ...(input.imageFixtureId ? { imageFixtureId: input.imageFixtureId } : {}),
            history: requestHistory,
            turnIndex: session.turnIndex + 1,
        }), { encoding: 'utf8', mode: 0o600 });
        const env = {
            SystemRoot: process.env.SystemRoot,
            WINDIR: process.env.WINDIR,
            TEMP: process.env.TEMP || os.tmpdir(),
            TMP: process.env.TMP || os.tmpdir(),
            PATH: path.dirname(process.execPath),
            NODE_ENV: 'test',
            INTENT_ROUTER_DISABLED: 'false',
            AI_VISION_ENABLED: 'false',
            AI_PHOTO_MATCH_ENABLED: 'false',
            DATABASE_URL: 'postgres://lab:lab@127.0.0.1:1/easymod_product_lab_test',
            REDIS_URL: 'redis://127.0.0.1:1',
            SLACK_ALERT_WEBHOOK_URL: '',
            SENTRY_DSN: '',
            QDRANT_URL: '',
            LAB_OPERATION: 'playground',
            LAB_PLAYGROUND_INPUT_PATH: inputPath,
            LAB_PLAYGROUND_RESULT_PATH: resultPath,
            LAB_RUN_ID: crypto.randomUUID(),
            LAB_RUN_MODE: 'candidate',
            LAB_SOURCE_REVISION: currentRevision,
            LAB_ENGINE_SOURCE_REVISION: candidateEngineSourceRevision,
            LAB_ENGINE_SOURCE_SHA256: candidateRouterSourceSha256,
            LAB_RUNNER_REVISION: labRunnerRevision,
            LAB_RUNNER_SOURCE_SHA256: labRunnerSourceSha256,
        };
        for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
        try {
            const childResult = await executeLabTest(tempDir, env);
            if (childResult.code !== 0) {
                server.lab.lastRunnerDiagnostic = `${childResult.stdout}\n${childResult.stderr}`.slice(-8000);
                throw Object.assign(new Error('Local playground route execution failed.'), { reasonCode: 'PLAYGROUND_RUNNER_FAILED', exitCode: childResult.code });
            }
            return JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        } finally {
            fs.rmSync(inputPath, { force: true });
            fs.rmSync(resultPath, { force: true });
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    };

    const runTriageFixture = async (fixtureId) => {
        if (fixtureId !== 'unsafe-price-claim') throw new Error('Triage fixture is not registered.');
        const runId = crypto.randomUUID();
        if (runner) return runner({ operation: 'triage', fixtureId, runId });
        fs.mkdirSync(TRIAGE_ROOT, { recursive: true });
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `easymod-lab-triage-${process.pid}-`));
        const resultPath = path.join(TRIAGE_ROOT, `${runId}.json`);
        const env = {
            SystemRoot: process.env.SystemRoot,
            WINDIR: process.env.WINDIR,
            TEMP: process.env.TEMP || os.tmpdir(),
            TMP: process.env.TMP || os.tmpdir(),
            PATH: path.dirname(process.execPath),
            NODE_ENV: 'test',
            INTENT_ROUTER_DISABLED: 'false',
            AI_VISION_ENABLED: 'false',
            AI_PHOTO_MATCH_ENABLED: 'false',
            DATABASE_URL: 'postgres://lab:lab@127.0.0.1:1/easymod_product_lab_test',
            REDIS_URL: 'redis://127.0.0.1:1',
            LAB_OPERATION: 'triage',
            LAB_TRIAGE_FIXTURE_ID: fixtureId,
            LAB_TRIAGE_RESULT_PATH: resultPath,
            LAB_RUN_ID: runId,
            LAB_RUN_MODE: 'candidate',
            LAB_SOURCE_REVISION: currentRevision,
            LAB_ENGINE_SOURCE_REVISION: candidateEngineSourceRevision,
            LAB_ENGINE_SOURCE_SHA256: candidateRouterSourceSha256,
            LAB_RUNNER_REVISION: labRunnerRevision,
            LAB_RUNNER_SOURCE_SHA256: labRunnerSourceSha256,
        };
        for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
        try {
            const childResult = await executeLabTest(tempDir, env);
            if (childResult.code !== 0) throw new Error('Local safety triage replay failed.');
            const artifact = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
            if (artifact.fixtureId !== fixtureId || artifact.runId !== runId) throw new Error('Triage receipt did not match the fixed fixture.');
            return artifact;
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    };

    const findScenario = (scenarioId) => {
        if (!dataset || !SCENARIO_ID.test(scenarioId)) return null;
        const index = dataset.scenarios.findIndex(item => item.scenarioId === scenarioId);
        if (index < 0) return null;
        return { public: dataset.scenarios[index], internal: dataset.internalScenarios[index] };
    };

    const evidenceForScenario = (scenarioId) => {
        const targeted = TARGETED_EVIDENCE[scenarioId];
        const found = targeted ? null : findScenario(scenarioId);
        if (!targeted && !found) return null;
        const ordinal = found ? Number(found.public.personaId.slice(1)) : null;
        const tenantId = targeted ? targeted.tenantId : (ordinal % 2 ? 'fixture-shop-a' : 'fixture-shop-b');
        const previousProduct = found
            ? dataset.internalScenarios.slice(0, dataset.internalScenarios.indexOf(found.internal))
                .filter(item => item.personaId === found.public.personaId)
                .reduce((current, item) => {
                    const priorOracle = classifyOracleTurn(item._sourceRecord, tenantId, catalog, current);
                    return priorOracle.productId || current;
                }, null)
            : null;
        const oracle = classifyOracleTurn(targeted ? targeted.record : found.internal._sourceRecord, tenantId, catalog, previousProduct);
        const product = catalog.find(item => String(item.id) === String(oracle.productId));
        const evidence = [];
        if (product) {
            const facts = [
                ['identity', product.name, `${product.id}:identity`],
                ['price', Number.isFinite(Number(product.price)) ? { amount: Number(product.price), currency: 'BDT' } : null, `${product.id}:price`],
                ['material', product.ai_material || null, `${product.id}:material`],
                ['color', product.ai_color || null, `${product.id}:color`],
                ['stock', product.track_quantity ? (Number(product.quantity) > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK') : (product.in_stock ? 'IN_STOCK' : null), `${product.id}:stock`],
            ];
            for (const [field, value, evidenceId] of facts) {
                if (value !== null) evidence.push({
                    tenantId,
                    productId: String(product.id),
                    field,
                    value,
                    evidenceId,
                    source: 'synthetic-fixture',
                    authority: ['material', 'color'].includes(field) ? 'uncertain_retrieval_metadata' : 'structured_catalog_fixture',
                    answerability: ['material', 'color'].includes(field) ? 'not_authoritative_for_customer_claims' : 'eligible_when_oracle_slot_matches',
                });
            }
            for (const variant of product.variants || []) {
                evidence.push({
                    tenantId,
                    productId: String(product.id),
                    field: 'variant',
                    value: { option: variant.option_name, value: variant.option_value, stock: Number(variant.quantity) > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK', price: variant.price == null ? null : { amount: Number(variant.price), currency: 'BDT' } },
                    evidenceId: `${product.id}:${variant.id}`,
                    source: 'synthetic-fixture',
                });
            }
        }
        let groundingDecision = 'NOT_EXECUTED';
        for (const run of runs.values()) {
            const turn = run.turns?.find(item => item.scenarioId === scenarioId);
            if (turn) groundingDecision = turn.disposition;
        }
        return {
            scenarioId,
            tenantId,
            classificationTags: oracle.classificationTags,
            oracle: {
                domain: oracle.domain,
                eligibility: oracle.eligibility,
                requiredAuthority: oracle.requiredAuthority,
                requiredEvidence: oracle.eligibleSlots.map(slot => ({ field: slot.field, evidenceId: slot.evidenceId, expectedValue: slot.expectedValue })),
                expectedDisposition: oracle.eligibility === 'ANSWERABLE' ? 'SEND_GROUNDED_ANSWER' : 'SAFE_FALLBACK_OR_HANDOFF',
            },
            evidence,
            groundingDecision,
        };
    };

    const handler = async (request, response) => {
        const address = request.socket.remoteAddress;
        const hostHeader = request.headers.host || '';
        const origin = request.headers.origin || null;
        const portValue = server.address()?.port || port;
        if (!isTrustedLabRequest({
            remoteAddress: address,
            host: hostHeader,
            origin,
            method: request.method,
            headers: request.headers,
        }, portValue, token)) {
            return sendJson(response, 403, { error: 'Local lab request was rejected.' });
        }
        let url;
        try { url = new URL(request.url, `http://127.0.0.1:${portValue}`); } catch (_) { return sendJson(response, 400, { error: 'Invalid local request path.' }); }
        const pathname = url.pathname;

        if (request.method === 'GET' && pathname === '/') {
            try {
                const html = fs.readFileSync(path.join(UI_ROOT, 'index.html'), 'utf8')
                    .replace('</head>', `<meta name="lab-token" content="${token}">\n</head>`);
                response.writeHead(200, {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Cache-Control': 'no-store',
                    'X-Content-Type-Options': 'nosniff',
                    'Referrer-Policy': 'no-referrer',
                    'X-Frame-Options': 'DENY',
                    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
                });
                return response.end(html);
            } catch (_) { return sendJson(response, 503, { error: 'Test Lab UI assets are unavailable.' }); }
        }
        if (request.method === 'GET' && ['/styles.css', '/app.js'].includes(pathname)) {
            const asset = path.join(UI_ROOT, pathname === '/styles.css' ? 'styles.css' : 'app.js');
            try {
                const body = fs.readFileSync(asset);
                response.writeHead(200, {
                    'Content-Type': pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
                    'Content-Length': body.length,
                    'Cache-Control': 'no-store',
                    'X-Content-Type-Options': 'nosniff',
                    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'",
                });
                return response.end(body);
            } catch (_) { return sendJson(response, 404, { error: 'Lab asset not found.' }); }
        }
        if (!pathname.startsWith('/__lab/api/')) return sendJson(response, 404, { error: 'Local lab route not found.' });
        if (datasetError && !['/health', '/dataset'].includes(pathname.slice('/__lab/api'.length))) {
            return sendJson(response, 503, { error: 'Simulator dataset is unavailable; no run was started.' });
        }

        if (request.method === 'GET' && pathname === '/__lab/api/health') {
            return sendJson(response, 200, {
                status: dataset ? 'ready' : 'degraded',
                revision: currentRevision,
                service: 'product-engine-local-test-lab',
                datasetAvailable: Boolean(dataset),
                datasetError: datasetError ? 'DATASET_UNAVAILABLE' : null,
            });
        }
        if (request.method === 'GET' && pathname === '/__lab/api/dataset') {
            if (!dataset) return sendJson(response, 503, { error: 'Simulator dataset is unavailable.' });
            return sendJson(response, 200, {
                source: dataset.source,
                personas: dataset.personas,
                counts: dataset.counts,
                provenance: { sourceTextReturned: false, expectationTextUsedAsGroundTruth: false },
            });
        }
        if (request.method === 'GET' && pathname === '/__lab/api/scenarios') {
            const personaId = url.searchParams.get('personaId');
            if (!/^P(?:0[1-9]|1\d|20)$/.test(personaId || '')) return sendJson(response, 400, { error: 'A known persona identifier is required.' });
            const selected = dataset.scenarios.filter(item => item.personaId === personaId);
            const scenarios = selected.map(item => {
                const result = evidenceForScenario(item.scenarioId);
                return {
                    ...item,
                    oracleEligibility: result?.oracle.eligibility || 'NOT_ANSWERABLE',
                    oracleDomain: result?.oracle.domain || 'unknown',
                    requiredAuthority: result?.oracle.requiredAuthority || 'not_established',
                };
            });
            return sendJson(response, 200, { scenarios });
        }
        if (request.method === 'GET' && pathname === '/__lab/api/history') return sendJson(response, 200, { runs: getHistory() });
        const runMatch = pathname.match(/^\/__lab\/api\/runs\/([a-f0-9-]{36})$/i);
        if (request.method === 'GET' && runMatch) {
            const record = getRun(runMatch[1]);
            return record ? sendJson(response, 200, safeResponse(record)) : sendJson(response, 404, { error: 'Run receipt was not found.' });
        }
        if (request.method === 'GET' && pathname.startsWith('/__lab/api/evidence/')) {
            const scenarioId = decodeURIComponent(pathname.slice('/__lab/api/evidence/'.length));
            const evidence = evidenceForScenario(scenarioId);
            return evidence ? sendJson(response, 200, evidence) : sendJson(response, 404, { error: 'Scenario evidence was not found.' });
        }
        const exportMatch = pathname.match(/^\/__lab\/api\/export\/([a-f0-9-]{36})\.(json|csv)$/i);
        if (request.method === 'GET' && exportMatch) {
            const run = getRun(exportMatch[1]);
            if (!run || run.status !== 'completed') return sendJson(response, 404, { error: 'Completed run receipt was not found.' });
            if (exportMatch[2].toLowerCase() === 'json') {
                const body = Buffer.from(JSON.stringify(run, null, 2));
                response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${run.runId}.json"`, 'X-Content-Type-Options': 'nosniff' });
                return response.end(body);
            }
            const columns = ['runId', 'scenarioId', 'personaId', 'turn', 'routerSource', 'disposition', 'reasonCode', 'productEvidenceStatus', 'responseTextStored', 'latencyMs'];
            const lines = [columns.join(',')];
            for (const turn of run.turns || []) {
                const values = [run.runId, turn.scenarioId, turn.personaId, turn.turn, turn.routerSource, turn.disposition, turn.reasonCode, turn.productEvidence?.status, turn.responseTextStored, turn.latencyMs]
                    .map(value => `"${String(value ?? '').replace(/"/g, '""')}"`);
                lines.push(values.join(','));
            }
            const body = Buffer.from(`${lines.join('\r\n')}\r\n`);
            response.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${run.runId}.csv"`, 'X-Content-Type-Options': 'nosniff' });
            return response.end(body);
        }
        if (request.method === 'POST' && pathname === '/__lab/api/runs') {
            const body = await readJsonBody(request);
            let validated;
            try { validated = validateRunRequest(body); } catch (_) { return sendJson(response, 400, { error: 'Run request does not match the bounded local contract.' }); }
            const activeRunCount = [...runs.values()].filter(run => run.status === 'running').length;
            if (activeRunCount >= MAX_CONCURRENT_RUNS) return sendJson(response, 409, { error: 'A local run is already in progress.' });
            const runId = crypto.randomUUID();
            const now = new Date().toISOString();
            const run = {
                runId,
                scope: validated.scope,
                personaId: validated.personaId || null,
                mode: validated.mode,
                status: 'running',
                executionMode: 'production-intent-router-with-controlled-local-collaborators',
                sourceRevision: validated.mode === 'baseline' ? BASELINE_SHA : currentRevision,
                engineSourceRevision: BASELINE_SHA,
                startedAt: now,
                completedAt: null,
                progress: { completed: 0, total: validated.scope === 'full' ? dataset.source.scenarioCount : 10 },
                turns: [],
            };
            runs.set(runId, run);
            spawnReplay(run).then(artifact => {
                runs.set(runId, artifact);
            }).catch(error => {
                runs.set(runId, {
                    ...run,
                    status: 'failed',
                    completedAt: new Date().toISOString(),
                    error: { reasonCode: error.reasonCode || 'LAB_RUNNER_FAILED', exitCode: Number.isInteger(error.exitCode) ? error.exitCode : null },
                });
            });
            return sendJson(response, 202, { runId, status: run.status });
        }
        if (request.method === 'POST' && pathname === '/__lab/api/playground') {
            const body = await readJsonBody(request);
            let input;
            try { input = validatePlaygroundRequest(body); } catch (_) { return sendJson(response, 400, { error: 'Playground request does not match the bounded synthetic contract.' }); }
            let session = sessions.get(input.sessionId);
            if (!session) session = { tenantId: input.tenantId, history: [], turnIndex: 0 };
            const tenantChanged = session.tenantId !== input.tenantId;
            if (tenantChanged) session = { tenantId: input.tenantId, history: [], turnIndex: 0 };
            try {
                const result = await runPlayground(input, session);
                session.history.push(
                    { role: 'user', content: input.message, createdAt: new Date().toISOString() },
                    { role: 'assistant', content: result.answer || '', createdAt: new Date().toISOString() },
                );
                session.turnIndex += 1;
                session.tenantId = input.tenantId;
                sessions.set(input.sessionId, session);
                return sendJson(response, 200, { ...result, contextResetForTenantChange: tenantChanged });
            } catch (_) {
                return sendJson(response, 503, { error: 'Local playground execution failed.' });
            }
        }
        if (request.method === 'POST' && pathname === '/__lab/api/triage/unsafe-price-claim/rerun') {
            let body;
            try { body = await readJsonBody(request); } catch (error) { return sendJson(response, error.statusCode || 400, { error: 'Triage rerun request must be an empty JSON object.' }); }
            if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
                return sendJson(response, 400, { error: 'Triage rerun request must be an empty JSON object.' });
            }
            try {
                const artifact = await runTriageFixture('unsafe-price-claim');
                return sendJson(response, 200, artifact);
            } catch (_) {
                return sendJson(response, 503, { error: 'Safety triage replay failed.' });
            }
        }
        const resetMatch = pathname.match(/^\/__lab\/api\/sessions\/([a-z0-9-]{1,64})\/reset$/i);
        if (request.method === 'POST' && resetMatch) {
            let body;
            try { body = await readJsonBody(request); } catch (error) { return sendJson(response, error.statusCode || 400, { error: 'Session reset request must be an empty JSON object.' }); }
            if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
                return sendJson(response, 400, { error: 'Session reset request must be an empty JSON object.' });
            }
            const sessionId = resetMatch[1];
            const removed = sessions.delete(sessionId);
            return sendJson(response, 200, { sessionId, reset: true, priorSessionFound: removed });
        }
        return sendJson(response, 404, { error: 'Local lab route not found.' });
    };

    const server = http.createServer((request, response) => {
        Promise.resolve(handler(request, response)).catch(error => {
            if (response.headersSent || response.destroyed) return;
            const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
            sendJson(response, status, { error: status === 413 ? 'Request body exceeds the local limit.' : 'Local lab request failed.' });
        });
    });
    server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
    server.lab = { token, dataset, runs, sessions, artifactsRoot: ARTIFACT_ROOT, currentRevision };
    server.closeLabChildren = () => {
        for (const child of childProcesses) {
            try { child.kill(); } catch (_) { }
        }
    };
    server.start = () => new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server));
    });
    return server;
};

if (require.main === module) {
    const server = createLabServer({ port: Number(process.env.LAB_PORT || 0) });
    server.start().then(() => {
        const address = server.address();
        process.stdout.write(`EasyModerator Product Engine Lab: http://127.0.0.1:${address.port}\n`);
        process.stdout.write(`Revision: ${server.lab.currentRevision}\n`);
        const shutdown = () => {
            server.closeLabChildren();
            if (server.listening) server.close(() => process.exit(0));
        };
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
    }).catch(() => {
        process.stderr.write('EasyModerator Product Engine Lab failed to bind on loopback.\n');
        process.exitCode = 1;
    });
}

module.exports = { createLabServer, DATASET_PATH, RUNS_ROOT, BASELINE_SHA };
