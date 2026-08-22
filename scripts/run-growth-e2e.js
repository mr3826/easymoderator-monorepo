'use strict';

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const backendRoot = path.join(repoRoot, 'EasyMod-backend');
const composeFile = path.join(repoRoot, 'docker-compose.test.yml');
const seedScript = path.join(backendRoot, 'src', 'scripts', 'seed-growth-e2e.js');
const projectName = `easymod-growth-e2e-${process.pid}`;
const postgresPort = process.env.TEST_POSTGRES_PORT || '5432';
const redisPort = process.env.TEST_REDIS_PORT || '6379';
const useExistingServices = process.env.GROWTH_E2E_USE_EXISTING_SERVICES === 'true';
const composeEnv = {
    ...process.env,
    TEST_POSTGRES_PORT: postgresPort,
    TEST_REDIS_PORT: redisPort,
};
const testEnv = {
    ...composeEnv,
    NODE_ENV: 'test',
    DB_SSL: 'false',
    DATABASE_URL: `postgres://e2e:e2e@127.0.0.1:${postgresPort}/easymod_e2e`,
    REDIS_URL: `redis://127.0.0.1:${redisPort}`,
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
    GIT_SHA: 'growth-e2e-local',
};
delete testEnv.SENTRY_DSN;
delete testEnv.SLACK_ALERT_WEBHOOK_URL;
delete testEnv.QDRANT_URL;

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
