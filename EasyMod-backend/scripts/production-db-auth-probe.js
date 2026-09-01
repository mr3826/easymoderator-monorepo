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

async function runPreMigrationProbe(client, databaseName) {
    const identity = await client.query(
        'SELECT current_database() AS database_name, current_schema() AS schema_name',
    );
    const identityRow = identity.rows[0];
    if (identityRow?.database_name !== databaseName || identityRow?.schema_name !== 'public') {
        throw new Error('unexpected production database or schema');
    }
    console.log(`CURRENT_DATABASE=${identityRow.database_name}`);
    console.log(`CURRENT_SCHEMA=${identityRow.schema_name}`);

    const counts = await client.query(`
        SELECT (SELECT COUNT(*) FROM public.orders)::text AS order_count,
               (SELECT COUNT(*) FROM public.subscriptions)::text AS subscription_count
    `);
    console.log(`ORDER_COUNT=${counts.rows[0].order_count}`);
    console.log(`SUBSCRIPTION_COUNT=${counts.rows[0].subscription_count}`);

    const migration = await client.query(`
        SELECT COUNT(*)::text AS migration_count
          FROM public.migrations
    `);
    console.log(`MIGRATION_COUNT=${migration.rows[0].migration_count}`);

    // Head is the most recently *executed* migration, matching migrate.js's own
    // definition (src/database/migrate.js: `ORDER BY executed_at DESC LIMIT 1`).
    // Migration filenames are date-prefixed but not guaranteed to sort the same
    // way they were applied, so MAX(name) is not a substitute for this.
    const migrationHead = await client.query(`
        SELECT name
          FROM public.migrations
         ORDER BY executed_at DESC
         LIMIT 1
    `);
    console.log(`MIGRATION_HEAD=${migrationHead.rows[0]?.name ?? ''}`);

    const drift = await client.query(`
        SELECT table_name, column_name
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND ((table_name = 'orders' AND column_name = 'metadata')
             OR (table_name = 'subscriptions' AND column_name IN ('threshold_debt', 'usage_reset_at')))
    `);
    if (drift.rows.length !== 0) {
        throw new Error('pre-migration schema is not in the expected drift state');
    }
    console.log('PRE_MIGRATION orders.metadata=MISSING');
    console.log('PRE_MIGRATION subscriptions.threshold_debt=MISSING');
    console.log('PRE_MIGRATION subscriptions.usage_reset_at=MISSING');

    const threshold = await client.query(`
        SELECT COUNT(*)::text AS row_count,
               COALESCE(SUM(threshold_conversations), 0)::text AS sum,
               COALESCE(MIN(threshold_conversations), 0)::text AS min,
               COALESCE(MAX(threshold_conversations), 0)::text AS max
          FROM public.subscriptions
    `);
    const thresholdRow = threshold.rows[0];
    console.log(`THRESHOLD_CONVERSATIONS_ROWS=${thresholdRow.row_count}`);
    console.log(`THRESHOLD_CONVERSATIONS_SUM=${thresholdRow.sum}`);
    console.log(`THRESHOLD_CONVERSATIONS_MIN=${thresholdRow.min}`);
    console.log(`THRESHOLD_CONVERSATIONS_MAX=${thresholdRow.max}`);
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
        if (process.env.PROBE_SCHEMA_MODE === 'pre-migration') {
            failureStage = 'PRE_MIGRATION_SCHEMA';
            await runPreMigrationProbe(client, databaseName);
            console.log('PRE_MIGRATION_SCHEMA=EXPECTED');
        }
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

module.exports = { decodeRenderedEnvValue, main, runPreMigrationProbe };
