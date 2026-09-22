'use strict';

const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const backendRoot = path.join(repoRoot, 'EasyMod-backend');
const composeFile = path.join(repoRoot, 'docker-compose.test.yml');
const seedScript = path.join(backendRoot, 'src', 'scripts', 'seed-growth-e2e.js');
const runToken = process.pid;
const projectName = `easymod-growth-e2e-${runToken}`;
const useExistingServices = process.env.GROWTH_E2E_USE_EXISTING_SERVICES === 'true';

// The browser E2E runs the full migration chain and truncates/creates
// fixtures. It MUST address a loopback, disposable, per-run unique database.
// Defaults match the CI service containers; local runs override ports with
// free-port probing and namespace the database by run.
function assertDisposableTarget(name, label) {
    if (!/(?:^|[^a-z])(?:e2e|test)(?:[^a-z]|$)/i.test(String(name))) {
        throw new Error(`Refusing Growth E2E: ${label} "${name}" does not name a disposable e2e/test resource.`);
    }
}

function assertLoopback(host, label) {
    if (!['127.0.0.1', 'localhost', '::1'].includes(String(host))) {
        throw new Error(`Refusing Growth E2E: ${label} host "${host}" is not loopback.`);
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

const dbName = useExistingServices
    ? (process.env.TEST_POSTGRES_DB || 'easymod_e2e')
    : `easymod_growth_${runToken}_e2e`;
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
        GROWTH_OS_ENABLED: 'true',
        PORT: '3000',
        RUN_MIGRATIONS_ON_STARTUP: 'false',
        START_EMBEDDED_WORKERS: 'false',
        APP_SECRET: 'growth-e2e-app-secret-at-least-32-characters',
        CHANNEL_ENCRYPTION_KEY: 'a'.repeat(64),
        PAYMENT_ENCRYPTION_KEY: 'b'.repeat(64),
        DELIVERY_ENCRYPTION_KEY: 'c'.repeat(64),
        JWT_ACCESS_SECRET: 'growth-e2e-jwt-access-secret-at-least-32',
        JWT_REFRESH_SECRET: 'growth-e2e-jwt-refresh-secret-at-least-32',
        SESSION_SECRET: 'growth-e2e-session-secret-at-least-32-chars',
        CSRF_SECRET: 'd'.repeat(64),
        CORS_ORIGINS: 'http://127.0.0.1:5175,http://localhost:5175',
        GROWTH_E2E_PASSWORD: 'GrowthE2E-Password-2026!',
        GIT_SHA: 'growth-e2e-local',
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
    return new Promise((resolve, reject) => {
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
            throw new Error(`Growth E2E backend exited before health check (code ${child.exitCode}).`);
        }
        if (await healthCheck()) return;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Growth E2E backend did not become healthy within 120 seconds.');
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
                throw new Error('Docker Compose is required for the Growth OS browser E2E stack.');
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
            throw new Error('Growth E2E database migrations failed.');
        }

        const seedCode = await run(process.execPath, [seedScript], testEnv);
        if (seedCode !== 0) {
            throw new Error('Growth E2E fixture seeding failed.');
        }

        const backend = startBackend();
        await waitForBackend(backend);

        exitCode = await run(
            npmCommand,
            ['run', 'test:e2e', '--workspace=easymod-growth'],
            testEnv,
        );
    } catch (error) {
        console.error(`Growth browser E2E setup failed: ${error.message}`);
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
