'use strict';

const dns = require('dns').promises;
const net = require('net');
const { Client } = require('pg');

const expectedDatabase = process.env.EXPECTED_DB_NAME || 'easymod_prod';

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
    const databaseUrl = new URL(process.env.DATABASE_URL);
    await dns.lookup(databaseUrl.hostname);
    console.log('DB_HOST_RESOLUTION=PASS');

    await assertTcpConnection(databaseUrl.hostname, Number(databaseUrl.port || 5432));
    console.log('DB_TCP_CONNECT=PASS');

    const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ''));
    if (databaseName !== expectedDatabase) {
        throw new Error('unexpected database name');
    }
    console.log('DB_NAME=EXPECTED');

    const client = new Client({ connectionString: databaseUrl.toString(), ssl: false });
    try {
        await client.connect();
        console.log('DB_AUTH=PASS');
        const result = await client.query('SELECT 1 AS ok');
        if (String(result.rows[0]?.ok) !== '1') {
            throw new Error('SELECT 1 returned an unexpected value');
        }
        console.log('SELECT_1=PASS');
    } finally {
        await client.end().catch(() => {});
    }
}

main().catch(() => {
    console.error('DB_PROBE_FAILED');
    process.exitCode = 1;
});
