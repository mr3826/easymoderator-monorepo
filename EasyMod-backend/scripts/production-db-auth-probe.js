'use strict';

const dns = require('dns').promises;
const crypto = require('crypto');
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

function decryptWebhookPayload(ciphertext) {
    if (typeof ciphertext !== 'string' || !ciphertext) throw new Error('empty payload');
    const rawKey = process.env.CHANNEL_ENCRYPTION_KEY;
    if (!rawKey) throw new Error('CHANNEL_ENCRYPTION_KEY is not set');
    const [version, ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
    if (version !== 'v1' || !ivHex || !authTagHex || !encryptedHex) throw new Error('invalid payload format');
    const key = /^[a-f0-9]{64}$/i.test(rawKey)
        ? Buffer.from(rawKey, 'hex')
        : crypto.createHash('sha256').update(rawKey).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAAD(Buffer.from('meta-webhook-payload'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let plaintext = decipher.update(encryptedHex, 'hex', 'utf8');
    plaintext += decipher.final('utf8');
    return JSON.parse(plaintext);
}

function parseTraceDate(value, name) {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) {
        throw new Error(`${name} must be an ISO timestamp`);
    }
    return date;
}

/**
 * Read-only incident trace for one bounded Meta inbound window.
 *
 * This mode deliberately runs through the existing protected DB probe instead
 * of adding a public diagnostic endpoint. It reports identifiers and lifecycle
 * state only; it never prints receipt payloads, PSIDs, tokens, or message text.
 */
async function runInboundTrace(client) {
    if (process.env.PROBE_INBOUND_TRACE !== 'true') return false;

    const from = parseTraceDate(process.env.TRACE_FROM, 'TRACE_FROM');
    const to = parseTraceDate(process.env.TRACE_TO, 'TRACE_TO');
    const marker = String(process.env.TRACE_MARKER || 'EASYMOD_AFTER_DONE').trim();
    if (to <= from) throw new Error('TRACE_TO must be after TRACE_FROM');
    if (marker.length < 5 || marker.length > 200) throw new Error('TRACE_MARKER length is invalid');

    console.log(`TRACE_WINDOW_FROM=${from.toISOString()}`);
    console.log(`TRACE_WINDOW_TO=${to.toISOString()}`);
    console.log(`TRACE_MARKER=${marker}`);

    const channels = await client.query(`
        SELECT mc.id, mc.meta_asset_id, mc.display_name, mc.status, mc.shop_id,
               s.shop_name
          FROM public.meta_channels mc
          LEFT JOIN public.shops s ON s.id = mc.shop_id
         WHERE mc.platform = 'facebook'
         ORDER BY mc.display_name, mc.meta_asset_id
    `);
    for (const row of channels.rows) {
        console.log(`TRACE_CHANNEL channel_id=${row.id} page_id=${row.meta_asset_id}`
            + ` name=${JSON.stringify(row.display_name || '')} status=${row.status}`
            + ` shop_id=${row.shop_id || ''} shop_name=${JSON.stringify(row.shop_name || '')}`);
    }

    const receipts = await client.query(`
        SELECT id, page_id, event_id, shop_id, meta_channel_id, status,
               retry_count, last_error_code, received_at, processed_at,
               next_retry_at, payload_encrypted
          FROM public.meta_webhook_receipts
         WHERE received_at >= $1 AND received_at <= $2
         ORDER BY received_at ASC, id ASC
    `, [from, to]);

    let matchedReceiptCount = 0;
    for (const row of receipts.rows) {
        let payloadMatch = false;
        if (row.payload_encrypted) {
            try {
                const payload = decryptWebhookPayload(row.payload_encrypted);
                const payloadText = payload?.message?.text || null;
                payloadMatch = typeof payloadText === 'string' && payloadText.includes(marker);
            } catch (_) {
                // Keep the receipt row visible; decrypt failures are themselves
                // evidence without exposing encrypted payload material.
            }
        }
        console.log(`TRACE_RECEIPT receipt_id=${row.id} page_id=${row.page_id}`
            + ` event_id=${row.event_id || ''} shop_id=${row.shop_id || ''}`
            + ` meta_channel_id=${row.meta_channel_id || ''} status=${row.status}`
            + ` retry_count=${row.retry_count} last_error_code=${row.last_error_code || ''}`
            + ` received_at=${row.received_at.toISOString()}`
            + ` processed_at=${row.processed_at ? row.processed_at.toISOString() : ''}`
            + ` next_retry_at=${row.next_retry_at ? row.next_retry_at.toISOString() : ''}`
            + ` payload_retained=${row.payload_encrypted ? 'yes' : 'no'}`);
        if (payloadMatch) {
            matchedReceiptCount += 1;
            console.log(`TRACE_RECEIPT_MATCH receipt_id=${row.id} meta_mid=${row.event_id || ''}`
                + ` receipt_status=${row.status} page_id=${row.page_id}`
                + ` shop_id=${row.shop_id || ''} meta_channel_id=${row.meta_channel_id || ''}`);
        }
    }

    const messages = await client.query(`
        SELECT m.id AS message_id, m.external_id AS meta_mid,
               m.conversation_id, m.created_at AS message_created_at,
               (m.metadata::jsonb)->>'reply_to_provider_message_id' AS reply_to_provider_message_id,
               (m.metadata::jsonb)->>'reply_to_internal_message_id' AS reply_to_internal_message_id,
               (m.metadata::jsonb)->'reply_to'->>'status' AS reply_to_status,
               c.shop_id, c.customer_id, c.meta_channel_id,
               c.status AS conversation_status, c.hitl,
               c.resolved_at
          FROM public.messages m
          JOIN public.conversations c ON c.id = m.conversation_id
         WHERE m.sender = 'customer'
           AND m.created_at >= $1 AND m.created_at <= $2
           AND m.content ILIKE ('%' || $3 || '%')
         ORDER BY m.created_at ASC, m.id ASC
    `, [from, to, marker]);

    for (const row of messages.rows) {
        console.log(`TRACE_MESSAGE_MATCH message_id=${row.message_id}`
            + ` meta_mid=${row.meta_mid || ''} conversation_id=${row.conversation_id}`
            + ` shop_id=${row.shop_id} customer_id=${row.customer_id || ''}`
            + ` meta_channel_id=${row.meta_channel_id || ''}`
            + ` reply_to_provider_message_id=${row.reply_to_provider_message_id || ''}`
            + ` reply_to_internal_message_id=${row.reply_to_internal_message_id || ''}`
            + ` reply_to_status=${row.reply_to_status || ''}`
            + ` conversation_status=${row.conversation_status} hitl=${row.hitl}`
            + ` resolved_at=${row.resolved_at ? row.resolved_at.toISOString() : ''}`
            + ` created_at=${row.message_created_at.toISOString()}`);
    }

    const found = matchedReceiptCount > 0 || messages.rows.length > 0;
    console.log(`TRACE_EXISTING_AFTER_DONE_EVENT_FOUND=${found ? 'YES' : 'NO'}`);
    if (messages.rows.length > 0) {
        const row = messages.rows[0];
        console.log(`TRACE_LAST_CONFIRMED_STAGE=R_API_MESSAGE_ROW`);
        console.log(`TRACE_FIRST_FAILED_STAGE=NONE_MESSAGE_PERSISTED`);
        console.log(`TRACE_CURRENT_CONVERSATION_STATUS=${row.conversation_status}`);
    } else if (matchedReceiptCount > 0) {
        const matched = receipts.rows.find((row) => {
            if (!row.payload_encrypted) return false;
            try {
                return String(decryptWebhookPayload(row.payload_encrypted)?.message?.text || '').includes(marker);
            } catch (_) {
                return false;
            }
        });
        console.log(`TRACE_LAST_CONFIRMED_STAGE=C_RECEIPT_PAYLOAD_MATCH`);
        console.log(`TRACE_FIRST_FAILED_STAGE=${matched.status === 'DEAD_LETTERED'
            ? 'L_MESSAGE_INSERT_OR_RETRY_EXHAUSTED'
            : matched.status === 'IDENTITY_NOT_RESOLVED'
                ? 'F_CHANNEL_RESOLUTION'
                : matched.status === 'RETRY_PENDING' || matched.status === 'MESSAGE_STORE_FAILED'
                    ? 'L_MESSAGE_INSERT_OR_STORE_RETRY'
                    : matched.status === 'RECEIVED' || matched.status === 'PROCESSING'
                        ? 'D_RECEIPT_PROCESSING_STUCK'
                        : 'L_MESSAGE_PERSISTENCE_NOT_CONFIRMED'}`);
        console.log(`TRACE_RECEIPT_ID=${matched.id}`);
        console.log(`TRACE_META_MID=${matched.event_id || ''}`);
        console.log(`TRACE_RECEIPT_STATUS=${matched.status}`);
    } else {
        console.log('TRACE_LAST_CONFIRMED_STAGE=NONE');
        console.log('TRACE_FIRST_FAILED_STAGE=UNKNOWN_META_DELIVERY_OR_WINDOW');
    }
    return true;
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
        if (process.env.PROBE_INBOUND_TRACE === 'true') {
            failureStage = 'INBOUND_TRACE';
            await runInboundTrace(client);
            console.log('INBOUND_TRACE=PASS');
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

module.exports = { decodeRenderedEnvValue, main, runPreMigrationProbe, runInboundTrace };
