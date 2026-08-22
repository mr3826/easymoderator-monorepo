'use strict';

const dns = require('dns').promises;
const net = require('net');
const { Client } = require('pg');

const expectedDatabase = process.env.EXPECTED_DB_NAME || 'easymod_prod';
let failureStage = 'DB_URL';

// Keep the probe standalone: it is copied into the running backend image, which
// may predate the source tree that produced the probe script.
function decodeRenderedEnvValue(value) {
    const raw = String(value ?? '');
    const trimmed = raw.trim();
    if (trimmed.length < 2 || trimmed[0] !== '"' || trimmed.at(-1) !== '"') {
        return value;
    }

    try {
        const decoded = JSON.parse(trimmed);
        return typeof decoded === 'string' ? decoded : value;
    } catch (_) {
        return value;
    }
}

function assertTcpConnection(host, port) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port });
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error('tcp timeout'));
        }, 5000);
        socket.once('connect', () => {
            clearTimeout(timer);
            socket.destroy();
            resolve();
        });
        socket.once('error', (error) => {
            clearTimeout(timer);
            socket.destroy();
            reject(error);
        });
    });
}

async function main() {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is required');
    }
    const databaseUrl = new URL(decodeRenderedEnvValue(process.env.DATABASE_URL));
    failureStage = 'DB_HOST_RESOLUTION';
    await dns.lookup(databaseUrl.hostname);
    console.log('DB_HOST_RESOLUTION=PASS');

    failureStage = 'DB_TCP_CONNECT';
    await assertTcpConnection(databaseUrl.hostname, Number(databaseUrl.port || 5432));
    console.log('DB_TCP_CONNECT=PASS');

    failureStage = 'DB_NAME';
    const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ''));
    if (databaseName !== expectedDatabase) {
        throw new Error('unexpected database name');
    }
    console.log('DB_NAME=EXPECTED');

    const client = new Client({ connectionString: databaseUrl.toString(), ssl: false });
    try {
        failureStage = 'DB_AUTH';
        await client.connect();
        console.log('DB_AUTH=PASS');
        failureStage = 'SELECT_1';
        const result = await client.query('SELECT 1 AS ok');
        if (String(result.rows[0]?.ok) !== '1') {
            throw new Error('SELECT 1 returned an unexpected value');
        }
        console.log('SELECT_1=PASS');
    } finally {
        await client.end().catch(() => {});
    }
}

if (require.main === module) {
    main().catch(() => {
        console.error(`${failureStage}=FAIL`);
        console.error('DB_PROBE_FAILED');
        process.exitCode = 1;
    });
}

module.exports = { decodeRenderedEnvValue, main };
