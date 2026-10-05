'use strict';

/**
 * Pilot intelligence (Customer 360 + Sales Opportunities + RTO Shield v2)
 * REAL-STACK browser E2E runner.
 *
 * Mirrors scripts/run-growth-e2e.js: a per-run disposable docker-compose
 * project (postgres + redis on tmpfs), the full migration chain, a
 * deterministic fixture seeder, the real backend server, and the live
 * Playwright tier in EasyMod-frontend driven against it through the vite
 * dev server's /api proxy (frontend playwright.config.ts webServer block).
 *
 * Safety: this suite truncates/migrates a database, so every database and
 * host must be loopback + per-run unique + named with e2e/test as a whole
 * word. The PILOT_E2E_USE_EXISTING_SERVICES=true escape hatch targets the CI
 * service containers instead of starting Compose here.
 */

const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const backendRoot = path.join(repoRoot, 'EasyMod-backend');
const composeFile = path.join(repoRoot, 'docker-compose.test.yml');
const seedScript = path.join(backendRoot, 'src', 'scripts', 'seed-pilot-e2e.js');
const runToken = process.pid;
const projectName = `easymod-pilot-e2e-${runToken}`;
const useExistingServices = process.env.PILOT_E2E_USE_EXISTING_SERVICES === 'true';

function assertDisposableTarget(name, label) {
    if (!/(?:^|[^a-z])(?:e2e|test)(?:[^a-z]|$)/i.test(String(name))) {
        throw new Error(`Refusing Pilot E2E: ${label} "${name}" does not name a disposable e2e/test resource.`);
    }
}

function assertLoopback(host, label) {
    if (!['127.0.0.1', 'localhost', '::1'].includes(String(host))) {
        throw new Error(`Refusing Pilot E2E: ${label} host "${host}" is not loopback.`);
    }
}

function listenProbe(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.once('listening', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

async function pickFreePort(preferred) {
    try {
        return await listenProbe(net.createServer().listen(preferred, '127.0.0.1'));
    } catch (_error) {
        return listenProbe(net.createServer().listen(0, '127.0.0.1'));
    }
}

async function resolvePorts() {
    const envPg = parseInt(process.env.TEST_POSTGRES_PORT, 10);
    const envRedis = parseInt(process.env.TEST_REDIS_PORT, 10);
    const [postgresPort, redisPort] = await Promise.all([
        useExistingServices && Number.isInteger(envPg)
            ? Promise.resolve(envPg)
            : pickFreePort(Number.isInteger(envPg) ? envPg : 55432),
        useExistingServices && Number.isInteger(envRedis)
            ? Promise.resolve(envRedis)
            : pickFreePort(Number.isInteger(envRedis) ? envRedis : 56379),
    ]);
    return { postgresPort, redisPort };
}

// The default vite port 4273 can sit inside a Windows excluded port range
// (EACCES on bind). Probe for one that actually listens on this machine.
async function resolveFrontendPort() {
    const envPort = parseInt(process.env.PLAYWRIGHT_PORT, 10);
    return pickFreePort(Number.isInteger(envPort) ? envPort : 4273);
}

const dbName = useExistingServices
    ? (process.env.TEST_POSTGRES_DB || 'easymod_e2e')
    : `easymod_pilot_${runToken}_e2e`;
const dbUser = process.env.TEST_POSTGRES_USER || 'e2e';
const dbPassword = process.env.TEST_POSTGRES_PASSWORD || 'e2e';
const dbHost = '127.0.0.1';
const redisHost = '127.0.0.1';
assertDisposableTarget(dbName, 'database');
assertLoopback(dbHost, 'database');
assertLoopback(redisHost, 'redis');

let composeEnv;
let testEnv;

async function buildEnvironments() {
    const { postgresPort, redisPort } = await resolvePorts();
    const frontendPort = await resolveFrontendPort();
    composeEnv = {
        ...process.env,
        TEST_POSTGRES_PORT: String(postgresPort),
        TEST_REDIS_PORT: String(redisPort),
        TEST_POSTGRES_DB: dbName,
        TEST_POSTGRES_USER: dbUser,
        TEST_POSTGRES_PASSWORD: dbPassword,
    };
    testEnv = {
        ...composeEnv,
        NODE_ENV: 'test',
        DB_SSL: 'false',
        DATABASE_URL: `postgres://${dbUser}:${dbPassword}@${dbHost}:${postgresPort}/${dbName}`,
        REDIS_URL: `redis://${redisHost}:${redisPort}`,
        REDIS_SESSION_DB: '0',
        REDIS_CACHE_DB: '1',
        REDIS_RATELIMIT_DB: '2',
        // Growth OS flag is NOT needed: the pilot features are gated per shop
        // via shop_pilot_features by the seed script. Backend boots fine with
        // it unset (config defaults to false).
        PORT: '3000',
        RUN_MIGRATIONS_ON_STARTUP: 'false',
        START_EMBEDDED_WORKERS: 'false',
        APP_SECRET: 'pilot-e2e-app-secret-at-least-32-characters',
        CHANNEL_ENCRYPTION_KEY: 'a'.repeat(64),
        PAYMENT_ENCRYPTION_KEY: 'b'.repeat(64),
        DELIVERY_ENCRYPTION_KEY: 'c'.repeat(64),
        JWT_ACCESS_SECRET: 'pilot-e2e-jwt-access-secret-at-least-32',
        JWT_REFRESH_SECRET: 'pilot-e2e-jwt-refresh-secret-at-least-32',
        SESSION_SECRET: 'pilot-e2e-session-secret-at-least-32-chars',
        CSRF_SECRET: 'd'.repeat(64),
        // The vite dev server (playwright webServer) proxies /api to :3000, so
        // the browser is same-origin; CORS entry kept for direct hits.
        CORS_ORIGINS: `http://127.0.0.1:${frontendPort},http://localhost:${frontendPort}`,
        PILOT_E2E_PASSWORD: process.env.PILOT_E2E_PASSWORD || 'PilotE2E-Password-2026!',
        PILOT_E2E_LIVE: 'true',
        // 'localhost' can resolve to ::1, where the vite dev server gets
        // EACCES on some Windows hosts; the loopback guards above already
        // pin everything else to 127.0.0.1.
        PLAYWRIGHT_HOST: '127.0.0.1',
        PLAYWRIGHT_PORT: String(frontendPort),
        PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${frontendPort}`,
        GIT_SHA: 'pilot-e2e-local',
    };
    for (const key of ['SENTRY_DSN', 'SLACK_ALERT_WEBHOOK_URL', 'QDRANT_URL']) {
        delete testEnv[key];
    }
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let activeChild = null;
let backendProcess = null;
let interruptRequested = false;

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
        interruptRequested = true;
        if (activeChild) activeChild.kill();
        if (backendProcess && !backendProcess.killed) backendProcess.kill('SIGTERM');
    });
}

function run(command, args, env, cwd = repoRoot) {
    return new Promise((resolve, reject) => {
        const spawnOptions = {
            cwd,
            env,
            stdio: 'inherit',
            windowsHide: true,
        };
        // Node on Windows cannot spawn npm.cmd directly under the current
        // runtime. The arguments are fixed by this script, so using the shell
        // here is limited to the package-manager wrapper and does not accept
        // user-supplied command text.
        if (process.platform === 'win32' && command.endsWith('.cmd')) {
            spawnOptions.shell = true;
        }
        const child = spawn(command, args, spawnOptions);
        activeChild = child;

        child.on('error', (error) => {
            if (activeChild === child) activeChild = null;
            reject(error);
        });
        child.on('close', (code, signal) => {
            if (activeChild === child) activeChild = null;
            resolve(signal ? 1 : (code ?? 1));
        });
    });
}

function composeArgs(...args) {
    return ['compose', '-p', projectName, '-f', composeFile, ...args];
}

function startBackend() {
    const child = spawn(process.execPath, ['server.js'], {
        cwd: backendRoot,
        env: testEnv,
        stdio: 'inherit',
        windowsHide: true,
    });
    backendProcess = child;
    return child;
}

function healthCheck() {
    return new Promise((resolve) => {
        const request = http.get('http://127.0.0.1:3000/health', (response) => {
            response.resume();
            response.once('end', () => resolve(response.statusCode === 200));
        });
        request.once('error', () => resolve(false));
        request.setTimeout(1000, () => {
            request.destroy();
            resolve(false);
        });
    }).catch(() => false);
}

async function waitForBackend(child) {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`Pilot E2E backend exited before health check (code ${child.exitCode}).`);
        }
        if (await healthCheck()) return;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Pilot E2E backend did not become healthy within 120 seconds.');
}

async function stopBackend() {
    const child = backendProcess;
    backendProcess = null;
    if (!child || child.exitCode !== null) return;

    await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
        };
        child.once('exit', finish);
        child.kill('SIGTERM');
        setTimeout(() => {
            if (settled) return;
            if (process.platform === 'win32') {
                const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
                    stdio: 'ignore',
                    windowsHide: true,
                });
                killer.once('close', finish);
            } else {
                child.kill('SIGKILL');
                finish();
            }
        }, 5_000).unref();
    });
}

async function main() {
    let exitCode = 1;
    let servicesStarted = false;

    try {
        await buildEnvironments();

        if (!useExistingServices) {
            const composeCheck = await run('docker', composeArgs('version'), composeEnv);
            if (composeCheck !== 0) {
                throw new Error('Docker Compose is required for the Pilot browser E2E stack.');
            }

            // Mark the project as owned before `up`: Compose can create one service
            // and fail on another, and the finally block must still reclaim it.
            servicesStarted = true;
            const upCode = await run(
                'docker',
                composeArgs('up', '-d', '--wait'),
                composeEnv,
            );
            if (upCode !== 0) {
                throw new Error('Disposable PostgreSQL/Redis services failed to become healthy.');
            }
        } else {
            console.log('Using CI PostgreSQL/Redis service containers; Compose teardown is not owned by this runner.');
        }

        if (interruptRequested) {
            exitCode = 130;
            return;
        }

        const migrateCode = await run(
            npmCommand,
            ['run', 'migrate', '--workspace=easymod-backend'],
            testEnv,
        );
        if (migrateCode !== 0) {
            throw new Error('Pilot E2E database migrations failed.');
        }

        const seedCode = await run(process.execPath, [seedScript], testEnv);
        if (seedCode !== 0) {
            throw new Error('Pilot E2E fixture seeding failed.');
        }

        const backend = startBackend();
        await waitForBackend(backend);

        exitCode = await run(
            npmCommand,
            [
                'run', 'test:e2e', '--workspace=easymod-frontend',
                '--', 'tests/e2e/customer-intelligence-live.spec.ts', '--workers=1',
            ],
            testEnv,
        );
    } catch (error) {
        console.error(`Pilot browser E2E setup failed: ${error.message}`);
    } finally {
        await stopBackend();
        if (servicesStarted) {
            const downCode = await run(
                'docker',
                composeArgs('down', '--volumes', '--remove-orphans'),
                composeEnv,
            );
            if (exitCode === 0 && downCode !== 0) exitCode = downCode;
        }
    }

    process.exitCode = interruptRequested ? 130 : exitCode;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
