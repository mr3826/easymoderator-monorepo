'use strict';

const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const composeFile = path.join(repoRoot, 'docker-compose.test.yml');
const projectName = `easymod-meta-e2e-${process.pid}`;
const postgresPort = process.env.META_TEST_POSTGRES_PORT || '55433';
const redisPort = process.env.META_TEST_REDIS_PORT || '56380';
const postgresUser = process.env.META_TEST_POSTGRES_USER || 'meta_e2e';
const postgresPassword = process.env.META_TEST_POSTGRES_PASSWORD || 'meta_e2e';
const postgresDatabase = process.env.META_TEST_POSTGRES_DB || `easymod_meta_${process.pid}_e2e`;
const composeEnv = {
    ...process.env,
    TEST_POSTGRES_PORT: postgresPort,
    TEST_REDIS_PORT: redisPort,
    TEST_POSTGRES_USER: postgresUser,
    TEST_POSTGRES_PASSWORD: postgresPassword,
    TEST_POSTGRES_DB: postgresDatabase,
};
const testEnv = {
    ...composeEnv,
    NODE_ENV: 'test',
    DB_SSL: 'false',
    DATABASE_URL: `postgres://${postgresUser}:${postgresPassword}@127.0.0.1:${postgresPort}/${postgresDatabase}`,
    REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    REDIS_SESSION_DB: '20',
    REDIS_CACHE_DB: '21',
    REDIS_RATELIMIT_DB: '22',
    REDIS_QUEUE_DB: '23',
    REDIS_LEGACY_DB: '24',
    REDIS_SSE_DB: '25',
};
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let activeChild = null;
let interruptRequested = false;

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
        interruptRequested = true;
        if (activeChild) activeChild.kill();
    });
}

function run(command, args, env) {
    return new Promise((resolve, reject) => {
        const spawnOptions = {
            cwd: repoRoot,
            env,
            stdio: 'inherit',
            windowsHide: true,
        };
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
            resolve(signal ? 1 : code ?? 1);
        });
    });
}

function composeArgs(...args) {
    return ['compose', '-p', projectName, '-f', composeFile, ...args];
}

async function main() {
    let exitCode = 1;
    let servicesStarted = false;

    try {
        if (await run('docker', composeArgs('version'), composeEnv) !== 0) {
            throw new Error('Docker Compose is required for the disposable Meta E2E stack.');
        }

        servicesStarted = true;
        if (await run('docker', composeArgs('up', '-d', '--wait'), composeEnv) !== 0) {
            throw new Error('Disposable Meta E2E PostgreSQL/Redis services failed to become healthy.');
        }
        if (interruptRequested) {
            exitCode = 130;
            return;
        }

        if (await run(npmCommand, ['run', 'migrate', '--workspace=easymod-backend'], testEnv) !== 0) {
            throw new Error('Disposable Meta E2E database migrations failed.');
        }
        exitCode = await run(
            npmCommand,
            ['run', 'test:meta:e2e', '--workspace=easymod-backend'],
            testEnv,
        );
    } catch (error) {
        console.error(`Meta E2E setup failed: ${error.message}`);
    } finally {
        if (servicesStarted) {
            const downCode = await run(
                'docker',
                composeArgs('down', '--volumes', '--remove-orphans'),
                composeEnv,
            );
            if (exitCode === 0 && downCode !== 0) exitCode = downCode;
        }
    }

    process.exitCode = exitCode;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
