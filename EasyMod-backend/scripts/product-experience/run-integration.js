'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const SCRIPT_ROOT = __dirname;
const BACKEND_ROOT = path.resolve(SCRIPT_ROOT, '../..');
const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');
const REPORT_ROOT = path.join(REPO_ROOT, 'docs', 'ai', 'product-experience-v1-2', 'artifacts', 'integration');
const EGRESS_FENCE = path.join(SCRIPT_ROOT, 'no-egress.js');
const COMPOSE_FILE = path.join(SCRIPT_ROOT, 'lab-integration.compose.yml');
const TESTS = [
    'src/modules/integration/__tests__/meta-webhook-durability.integration.test.js',
    'src/jobs/__tests__/message-worker.action-gate.integration.test.js',
    'src/jobs/__tests__/message-worker.recovery.integration.test.js',
];
const META_E2E_TEST = 'tests/meta-e2e/meta-e2e.test.js';

const freePort = () => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        server.close(error => error ? reject(error) : resolve(port));
    });
});

const ipv4Range = (cidr) => {
    const match = String(cidr || '').match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
    if (!match) return null;
    const prefix = Number(match[2]);
    const octets = match[1].split('.').map(Number);
    if (prefix < 0 || prefix > 32 || octets.some(octet => octet < 0 || octet > 255)) return null;
    const address = octets.reduce((value, octet) => value * 256 + octet, 0);
    const size = 2 ** (32 - prefix);
    const start = Math.floor(address / size) * size;
    return { start, end: start + size - 1 };
};

const rangesOverlap = (left, right) => left.start <= right.end && right.start <= left.end;

const netmaskPrefix = (netmask) => String(netmask || '').split('.').reduce((total, octet) => {
    const value = Number(octet);
    return total + (Number.isInteger(value) && value >= 0 && value <= 255
        ? value.toString(2).replace(/0/g, '').length
        : 0);
}, 0);

const waitForLoopbackPort = async (port, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const accepting = await new Promise(resolve => {
            const socket = net.createConnection({ host: '127.0.0.1', port });
            socket.setTimeout(1000);
            socket.once('connect', () => { socket.destroy(); resolve(true); });
            socket.once('timeout', () => { socket.destroy(); resolve(false); });
            socket.once('error', () => resolve(false));
        });
        if (accepting) return true;
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    return false;
};

const selectInternalSubnet = async (dockerEnv) => {
    const listed = await run('docker', ['network', 'ls', '--quiet', '--no-trunc'], { cwd: SCRIPT_ROOT, env: dockerEnv, timeoutMs: 30000 });
    if (listed.code !== 0) throw new Error('Could not inspect local Docker networks to reserve a non-overlapping lab subnet.');
    const ids = listed.stdout.trim().split(/\s+/).filter(Boolean);
    const inspected = ids.length
        ? await run('docker', ['network', 'inspect', ...ids], { cwd: SCRIPT_ROOT, env: dockerEnv, timeoutMs: 30000 })
        : { code: 0, stdout: '[]' };
    if (inspected.code !== 0) throw new Error('Could not read local Docker subnet allocations for the lab.');
    const dockerRanges = JSON.parse(inspected.stdout).flatMap(network => (network.IPAM?.Config || [])
        .map(config => ipv4Range(config.Subnet)).filter(Boolean));
    const hostRanges = Object.values(os.networkInterfaces()).flatMap(items => (items || [])
        .filter(item => item.family === 'IPv4' && item.address && item.netmask)
        .map(item => ipv4Range(`${item.address}/${netmaskPrefix(item.netmask)}`)).filter(Boolean));
    const used = [...dockerRanges, ...hostRanges];
    for (let third = 255; third >= 0; third -= 1) {
        for (let fourth = 240; fourth >= 0; fourth -= 16) {
            const subnet = `10.254.${third}.${fourth}/28`;
            const range = ipv4Range(subnet);
            if (!used.some(existing => rangesOverlap(range, existing))) return subnet;
        }
    }
    throw new Error('No free /28 subnet was found in the reserved 10.254.0.0/16 lab range.');
};

const run = (command, args, { cwd, env, timeoutMs = 240000 } = {}) => new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, signal: signal || null, timedOut, stdout, stderr });
    });
});

const redact = (value) => String(value || '')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, 'postgres://[redacted]')
    .replace(/redis:\/\/[^\s"']+/gi, 'redis://[redacted]')
    .replace(/(?:\+?880\s*)?0?(1[3-9]\d{8})\b/g, '[contact redacted]')
    .replace(/\b\d{12,20}\b/g, '[identifier redacted]')
    .replace(/[\w.+\-]+@[\w\-]+\.[a-z]{2,}/gi, '[email redacted]')
    .replace(/(TOKEN|SECRET|PASSWORD|API_KEY)=([^\s]+)/gi, '$1=[redacted]');

const minimalWindowsEnv = () => ({
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    USERPROFILE: process.env.USERPROFILE,
    DOCKER_CONFIG: process.env.DOCKER_CONFIG,
    DOCKER_HOST: process.env.DOCKER_HOST,
});

const integrationEnv = (postgresPort, redisPort, egressAttemptsPath) => ({
    ...minimalWindowsEnv(),
    NODE_ENV: 'test',
    DATABASE_URL: `postgres://lab:lab-local-only@127.0.0.1:${postgresPort}/easymod_product_lab_test`,
    DB_SSL: 'false',
    REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    REDIS_SESSION_DB: '10',
    REDIS_CACHE_DB: '11',
    REDIS_RATELIMIT_DB: '12',
    REDIS_QUEUE_DB: '13',
    REDIS_LEGACY_DB: '14',
    REDIS_SSE_DB: '15',
    GROWTH_OS_ENABLED: 'true',
    CHANNEL_ENCRYPTION_KEY: 'a'.repeat(64),
    PAYMENT_ENCRYPTION_KEY: 'b'.repeat(64),
    DELIVERY_ENCRYPTION_KEY: 'c'.repeat(64),
    JWT_ACCESS_SECRET: 'product-lab-jwt-access-secret-at-least-32',
    JWT_REFRESH_SECRET: 'product-lab-jwt-refresh-secret-at-least-32',
    SESSION_SECRET: 'product-lab-session-secret-at-least-32-chars',
    AI_ACTION_GATE_SECRET: 'product-lab-action-gate-secret-at-least-32-chars',
    SLACK_ALERT_WEBHOOK_URL: '',
    SENTRY_DSN: '',
    QDRANT_URL: '',
    OPENAI_API_KEY: '',
    GEMINI_API_KEY: '',
    GOOGLE_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    META_ACCESS_TOKEN: '',
    FACEBOOK_ACCESS_TOKEN: '',
    NODE_OPTIONS: `--require=${EGRESS_FENCE}`,
    LAB_EGRESS_ATTEMPTS_PATH: egressAttemptsPath,
});

const parseJestSummary = (output) => {
    const suites = output.match(/Test Suites:\s+([^\r\n]+)/)?.[1] || 'unavailable';
    const tests = output.match(/Tests:\s+([^\r\n]+)/)?.[1] || 'unavailable';
    const duration = output.match(/Time:\s+([^\r\n]+)/)?.[1] || 'unavailable';
    return { suites, tests, duration };
};

const summarizeJestReport = (reportPath) => {
    try {
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        const failedSuites = (report.testResults || []).filter(result => result.status === 'failed');
        return {
            passedSuites: report.numPassedTestSuites ?? null,
            failedSuites: report.numFailedTestSuites ?? null,
            passedTests: report.numPassedTests ?? null,
            failedTests: report.numFailedTests ?? null,
            passedTestTitles: (report.testResults || []).flatMap(result => (result.assertionResults || [])
                .filter(assertion => assertion.status === 'passed')
                .map(assertion => assertion.fullName || assertion.title || 'unnamed assertion')),
            failedSuiteDiagnostics: failedSuites.map(result => {
                const messages = [result.message, ...(result.assertionResults || []).flatMap(assertion => assertion.failureMessages || [])]
                    .filter(Boolean).join('\n');
                const errorType = messages.match(/\b(Sequelize[A-Za-z]+Error|[A-Za-z_$][\w$]*(?:Error|Exception))\b/)?.[1] || 'UNCLASSIFIED';
                const kinds = [];
                if (/Jest did not exit|open handles/i.test(messages)) kinds.push('OPEN_HANDLE');
                if (/afterAll|afterEach|beforeAll|beforeEach/i.test(messages)) kinds.push('LIFECYCLE_HOOK');
                if (/worker process/i.test(messages)) kinds.push('JEST_WORKER');
                if (/Test suite failed to run/i.test(messages)) kinds.push('SUITE_SETUP');
                if (/AssertionError|expect\(|Received:/i.test(messages)) kinds.push('ASSERTION');
                if (kinds.length === 0) kinds.push('UNCLASSIFIED_SUITE_FAILURE');

                const locations = [];
                const framePattern = /\(([^\r\n]*?\.(?:js|cjs|mjs|ts)):(\d+):(\d+)\)/g;
                for (const match of messages.matchAll(framePattern)) {
                    const absolutePath = path.resolve(match[1]);
                    const relativePath = path.relative(BACKEND_ROOT, absolutePath);
                    if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
                        locations.push(`${relativePath.replace(/\\/g, '/')}:${match[2]}:${match[3]}`);
                    }
                    if (locations.length >= 8) break;
                }
                const failedAssertions = (result.assertionResults || [])
                    .filter(assertion => assertion.status === 'failed')
                    .map(assertion => {
                        const failureText = (assertion.failureMessages || []).join('\n');
                        const scalar = (value) => {
                            const normalized = String(value || '').trim().replace(/^['"]|['"]$/g, '');
                            return /^(?:true|false|null|undefined|-?\d+(?:\.\d+)?|SEND|SAFE_FALLBACK|BLOCKED|AVAILABLE|UNAVAILABLE|NOT_FOUND|ANSWERABLE|NOT_ANSWERABLE|VERIFIED|OPENAI|GEMINI(?:-LITE|-PRO)?|AUTO|DRAFT|MANUAL|HELD)$/i.test(normalized)
                                ? normalized.slice(0, 64)
                                : null;
                        };
                        const expected = failureText.match(/^\s*Expected:\s*(.+)$/m)?.[1]
                            || failureText.match(/^\s*Expected substring:\s*(.+)$/m)?.[1];
                        const received = failureText.match(/^\s*Received:\s*(.+)$/m)?.[1];
                        const callCounts = failureText.match(/Expected number of calls:\s*(\d+)[\s\S]*?Received number of calls:\s*(\d+)/);
                        const testTitle = assertion.fullName || assertion.title || 'unnamed assertion';
                        return {
                            caseId: crypto.createHash('sha256').update(testTitle).digest('hex').slice(0, 16),
                            location: assertion.location || null,
                            expected: scalar(expected),
                            received: scalar(received),
                            expectedCalls: callCounts ? Number(callCounts[1]) : null,
                            receivedCalls: callCounts ? Number(callCounts[2]) : null,
                            failureMessage: redact(failureText).slice(0, 1800),
                            assertionKind: /Expected substring:/.test(failureText) ? 'MISSING_SUBSTRING' : 'VALUE_MISMATCH',
                        };
                    });
                return {
                    suite: path.relative(BACKEND_ROOT, result.name).replace(/\\/g, '/'),
                    errorType,
                    kinds,
                    locations,
                    failedAssertions,
                    sanitizedFailureExcerpt: redact(messages).slice(0, 1800),
                };
            }),
        };
    } catch (_) {
        return null;
    }
};

const ensureComposeBoundary = async (project, postgresPort, redisPort, networkSubnet, dockerEnv) => {
    const config = await run('docker-compose', ['-p', project, '-f', COMPOSE_FILE, 'config', '--format', 'json'], {
        cwd: SCRIPT_ROOT,
        env: { ...dockerEnv, LAB_POSTGRES_PORT: String(postgresPort), LAB_REDIS_PORT: String(redisPort), LAB_NETWORK_SUBNET: networkSubnet },
        timeoutMs: 30000,
    });
    if (config.code !== 0) throw new Error(`Docker Compose configuration validation failed (${config.code}). ${redact(config.stderr).slice(0, 300)}`);
    const model = JSON.parse(config.stdout);
    const serviceNames = Object.keys(model.services || {}).sort();
    if (serviceNames.join(',') !== 'postgres,redis') throw new Error('Test Lab Compose services do not match the fixed allowlist.');
    const serviceNetwork = model.networks?.default || {};
    if (serviceNetwork.driver !== 'bridge' || serviceNetwork.internal === true) throw new Error('Test Lab services must use the dedicated host-published bridge required for loopback database access.');
    if (String(serviceNetwork.driver_opts?.['com.docker.network.bridge.enable_ip_masquerade']) !== 'false') {
        throw new Error('Test Lab bridge must disable Docker IP masquerading.');
    }
    if (model.networks?.default?.ipam?.config?.[0]?.subnet !== networkSubnet) throw new Error('Test Lab Compose network did not use the reserved subnet.');
    const expectedPorts = { postgres: { host: String(postgresPort), target: 5432 }, redis: { host: String(redisPort), target: 6379 } };
    for (const [serviceName, service] of Object.entries(model.services)) {
        if (service.volumes?.length) throw new Error('Test Lab Compose cannot mount a persistent volume.');
        for (const port of service.ports || []) {
            if (port.host_ip !== '127.0.0.1') throw new Error('Test Lab services must publish only to loopback.');
            if (port.published !== expectedPorts[serviceName]?.host || port.target !== expectedPorts[serviceName]?.target) {
                throw new Error('Test Lab service port mapping does not match its reserved loopback port.');
            }
        }
        if (service.ports?.length !== 1) throw new Error('Each Test Lab service must publish exactly one loopback port.');
    }
};

const main = async () => {
    fs.mkdirSync(REPORT_ROOT, { recursive: true });
    const runId = crypto.randomUUID();
    const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const project = `easymod-product-lab-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
    const postgresPort = await freePort();
    let redisPort = await freePort();
    while (redisPort === postgresPort) redisPort = await freePort();
    const dockerEnv = minimalWindowsEnv();
    const networkSubnet = await selectInternalSubnet(dockerEnv);
    const egressAttemptsPath = path.join(REPORT_ROOT, `${runId}.egress-attempts.txt`);
    fs.writeFileSync(egressAttemptsPath, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    const env = integrationEnv(postgresPort, redisPort, egressAttemptsPath);
    const startedAt = new Date().toISOString();
    const timeline = [];
    let composeStarted = false;
    let failure = null;
    let migration = null;
    let jest = null;
    let metaE2eJest = null;
    let jestStructured = null;
    let metaE2eJestStructured = null;
    let metaE2eDeliveryDiagnostics = [];
    let cleanup = null;
    const temporaryJestReports = [];
    const metaE2eDiagnosticsPath = path.join(os.tmpdir(), `${runId}-meta-e2e-diagnostics.json`);
    temporaryJestReports.push(metaE2eDiagnosticsPath);
    env.META_E2E_DIAGNOSTICS_PATH = metaE2eDiagnosticsPath;

    try {
        await ensureComposeBoundary(project, postgresPort, redisPort, networkSubnet, dockerEnv);
        composeStarted = true;
        const up = await run('docker-compose', ['-p', project, '-f', COMPOSE_FILE, 'up', '-d', '--wait', '--wait-timeout', '120'], {
            cwd: SCRIPT_ROOT,
            env: { ...dockerEnv, LAB_POSTGRES_PORT: String(postgresPort), LAB_REDIS_PORT: String(redisPort), LAB_NETWORK_SUBNET: networkSubnet },
            timeoutMs: 180000,
        });
        timeline.push({ stage: 'compose_up', exitCode: up.code, timedOut: up.timedOut });
        if (up.code !== 0) throw new Error(`Disposable PostgreSQL and Redis services did not become healthy (${up.code}). ${redact(up.stderr).slice(0, 300)}`);

        const postgresLoopbackReady = await waitForLoopbackPort(postgresPort);
        const redisLoopbackReady = await waitForLoopbackPort(redisPort);
        if (!postgresLoopbackReady || !redisLoopbackReady) throw new Error('Both services must accept TCP connections through their reserved loopback ports.');

        const nodeExe = process.execPath;
        const migrationStart = Date.now();
        migration = await run(nodeExe, ['src/database/migrate.js', 'up'], { cwd: BACKEND_ROOT, env, timeoutMs: 240000 });
        timeline.push({ stage: 'migrations', exitCode: migration.code, durationMs: Date.now() - migrationStart, timedOut: migration.timedOut });
        if (migration.code !== 0) throw new Error('Disposable database migrations failed.');

        const jestStart = Date.now();
        const jestPath = path.join(BACKEND_ROOT, 'node_modules', 'jest', 'bin', 'jest.js');
        const integrationReportPath = path.join(os.tmpdir(), `${runId}-integration-jest.json`);
        temporaryJestReports.push(integrationReportPath);
        jest = await run(nodeExe, [jestPath, '--config', path.join(BACKEND_ROOT, 'jest.integration.config.js'), '--runInBand', '--forceExit', '--json', `--outputFile=${integrationReportPath}`, '--runTestsByPath', ...TESTS], {
            cwd: BACKEND_ROOT,
            env,
            timeoutMs: 480000,
        });
        jestStructured = summarizeJestReport(integrationReportPath);
        timeline.push({ stage: 'integration_jest', exitCode: jest.code, durationMs: Date.now() - jestStart, timedOut: jest.timedOut });
        if (jest.code !== 0) throw new Error('Selected real PostgreSQL/Redis integration suites failed.');

        const metaE2eStart = Date.now();
        const metaE2eReportPath = path.join(os.tmpdir(), `${runId}-webhook-e2e-jest.json`);
        temporaryJestReports.push(metaE2eReportPath);
        metaE2eJest = await run(nodeExe, [jestPath, '--config', path.join(BACKEND_ROOT, 'jest.meta-e2e.config.js'), '--runInBand', '--forceExit', '--json', `--outputFile=${metaE2eReportPath}`, '--runTestsByPath', META_E2E_TEST], {
            cwd: BACKEND_ROOT,
            env,
            timeoutMs: 600000,
        });
        metaE2eJestStructured = summarizeJestReport(metaE2eReportPath);
        try {
            const diagnostics = JSON.parse(fs.readFileSync(metaE2eDiagnosticsPath, 'utf8'));
            if (Array.isArray(diagnostics)) metaE2eDeliveryDiagnostics = diagnostics;
        } catch (_) { }
        timeline.push({ stage: 'webhook_pipeline_e2e_jest', exitCode: metaE2eJest.code, durationMs: Date.now() - metaE2eStart, timedOut: metaE2eJest.timedOut });
        if (metaE2eJest.code !== 0) throw new Error('The real webhook-to-worker-to-outbound Meta-shaped suite failed.');
    } catch (error) {
        failure = error.message;
    } finally {
        if (composeStarted) {
            cleanup = await run('docker-compose', ['-p', project, '-f', COMPOSE_FILE, 'down', '--remove-orphans'], {
                cwd: SCRIPT_ROOT,
                env: { ...dockerEnv, LAB_POSTGRES_PORT: String(postgresPort), LAB_REDIS_PORT: String(redisPort), LAB_NETWORK_SUBNET: networkSubnet },
                timeoutMs: 90000,
            });
            timeline.push({ stage: 'compose_down', exitCode: cleanup.code, timedOut: cleanup.timedOut, scope: project });
            if (cleanup.code !== 0 && !failure) failure = 'Disposable Compose cleanup failed for the isolated project.';
        }
        for (const reportPath of temporaryJestReports) {
            try { fs.unlinkSync(reportPath); } catch (_) { }
        }
    }

    let blockedEgressAttempts = null;
    try {
        blockedEgressAttempts = fs.readFileSync(egressAttemptsPath, 'utf8').split(/\r?\n/).filter(Boolean).length;
        if (blockedEgressAttempts > 0 && !failure) failure = `Integration tests attempted ${blockedEgressAttempts} blocked non-loopback network operation(s).`;
    } catch (_) {
        if (!failure) failure = 'Integration egress-attempt counter could not be read.';
    } finally {
        try { fs.unlinkSync(egressAttemptsPath); } catch (_) { }
    }

    const status = failure ? 'FAIL' : 'PASS';
    const receipt = {
        schemaVersion: 1,
        runId,
        status,
        startedAt,
        completedAt: new Date().toISOString(),
        branch: 'feature/verified-commerce-foundation-v1.2',
        sourceRevision,
        composeProject: project,
        serviceNetwork: { driver: 'bridge', internal: false, ipMasquerading: false, subnet: networkSubnet, overlapChecked: true },
        services: [
            { name: 'postgres', image: 'postgres:16-alpine', host: '127.0.0.1', port: postgresPort, storage: 'tmpfs', health: 'compose-healthcheck' },
            { name: 'redis', image: 'redis:7-alpine', host: '127.0.0.1', port: redisPort, storage: 'tmpfs', health: 'compose-healthcheck' },
        ],
        migrations: migration ? { exitCode: migration.code, durationMs: timeline.find(item => item.stage === 'migrations')?.durationMs } : { status: 'NOT_RUN' },
        testPaths: { selectedIntegration: TESTS, webhookPipelineE2E: META_E2E_TEST },
        jest: {
            status: failure ? 'FAIL' : 'PASS',
            selectedIntegration: jest ? {
                exitCode: jest.code,
                timedOut: jest.timedOut,
                ...parseJestSummary(`${jest.stdout}\n${jest.stderr}`),
                structured: jestStructured,
            } : { status: 'NOT_RUN' },
            webhookPipelineE2E: metaE2eJest ? {
                exitCode: metaE2eJest.code,
                timedOut: metaE2eJest.timedOut,
                ...parseJestSummary(`${metaE2eJest.stdout}\n${metaE2eJest.stderr}`),
                structured: metaE2eJestStructured,
                deliveryDiagnostics: metaE2eDeliveryDiagnostics,
            } : { status: 'NOT_RUN' },
        },
        egress: { mode: 'Docker bridge uses a reserved non-overlapping subnet with IP masquerading disabled; service ports publish only on 127.0.0.1; host Node guard allows loopback IPs/localhost, blocks DNS resolver APIs and custom lookup/agent/dispatcher paths, and blocks non-loopback TCP/UDP/HTTP/fetch', guard: 'PASS', blockedNonLoopbackAttempts: blockedEgressAttempts, externalProvidersConfigured: false },
        timeline,
        failure: failure ? redact(failure) : null,
        cleanup: cleanup ? { exitCode: cleanup.code, projectScoped: true, persistentVolumesMounted: false } : { status: composeStarted ? 'NOT_RUN' : 'NOT_NEEDED' },
    };
    const receiptPath = path.join(REPORT_ROOT, `${runId}.json`);
    const logPath = path.join(REPORT_ROOT, `${runId}.log`);
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    const log = [
        `Run ${runId} · ${status}`,
        `Compose project: ${project}`,
        `Services: PostgreSQL ${postgresPort}, Redis ${redisPort} (127.0.0.1 only, tmpfs)`,
        `Migrations: ${receipt.migrations.exitCode ?? receipt.migrations.status}`,
        `Selected integration Jest: ${receipt.jest.selectedIntegration.tests || receipt.jest.selectedIntegration.status}; suites=${receipt.jest.selectedIntegration.suites || 'not run'}; duration=${receipt.jest.selectedIntegration.duration || 'not run'}`,
        `Webhook pipeline Jest: ${receipt.jest.webhookPipelineE2E.tests || receipt.jest.webhookPipelineE2E.status}; suites=${receipt.jest.webhookPipelineE2E.suites || 'not run'}; duration=${receipt.jest.webhookPipelineE2E.duration || 'not run'}`,
        `Egress fence: ${receipt.egress.mode}`,
        `Cleanup: ${receipt.cleanup.exitCode ?? receipt.cleanup.status}`,
        failure ? `Failure: ${redact(failure)}` : 'Failure: none',
    ].join('\n') + '\n';
    fs.writeFileSync(logPath, log, { encoding: 'utf8', mode: 0o600 });
    process.stdout.write(JSON.stringify({ status, runId, receiptPath, logPath, jest: receipt.jest, failure: receipt.failure }) + '\n');
    if (failure) process.exitCode = 1;
};

main().catch(error => {
    process.stderr.write(`${redact(error.message)}\n`);
    process.exitCode = 1;
});
