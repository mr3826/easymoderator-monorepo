'use strict';

const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const composeFile = path.join(repoRoot, 'docker-compose.test.yml');
const projectName = `easymod-backend-test-${process.pid}`;
const postgresPort = process.env.TEST_POSTGRES_PORT || '5432';
const redisPort = process.env.TEST_REDIS_PORT || '6379';
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
        const child = spawn(command, args, {
            cwd: repoRoot,
            env,
            stdio: 'inherit',
            windowsHide: true,
        });
        activeChild = child;

        child.on('error', (error) => {
            if (activeChild === child) activeChild = null;
            reject(error);
        });
        child.on('close', (code, signal) => {
            if (activeChild === child) activeChild = null;
            if (signal) {
                resolve(1);
                return;
            }
            resolve(code ?? 1);
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
        const composeCheck = await run('docker', composeArgs('version'), composeEnv);
        if (composeCheck !== 0) {
            throw new Error('Docker Compose is required for the disposable integration test stack.');
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
        if (interruptRequested) {
            exitCode = 130;
            return;
        }
        exitCode = await run(
            npmCommand,
            ['run', 'test:integration', '--workspace=easymod-backend'],
            testEnv,
        );
    } catch (error) {
        console.error(`Backend integration setup failed: ${error.message}`);
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
