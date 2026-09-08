'use strict';

const dns = require('dns').promises;
const crypto = require('crypto');
const fs = require('fs/promises');
const net = require('net');
const path = require('path');
const { Client } = require('pg');
const ATTACHMENT_URL_TTL_SECONDS = 15 * 60;
const MAX_TRACE_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACE_ROWS = 5000;

const expectedDatabase = process.env.EXPECTED_DB_NAME || 'easymod_prod';
let failureStage = 'DB_URL';

// Keep this probe self-contained because production copies only this script into
// the running image for the independent database and attachment checks.
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

function parseAttachmentStorageKey(value) {
    if (typeof value !== 'string') return null;
    const parts = value.split('/');
    if (parts.length !== 2
        || !/^[A-Za-z0-9_-]{1,64}$/.test(parts[0])
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(parts[1])
        || parts[1].includes('..')) return null;
    return { shopId: parts[0], fileName: parts[1] };
}

function resolvePublicAssetOrigin() {
    const configured = [
        process.env.PUBLIC_ASSET_URL,
        process.env.PUBLIC_BASE_URL,
        process.env.API_URL,
        process.env.BASE_URL,
    ].find(Boolean);
    if (configured) return new URL(configured).origin;
    return process.env.NODE_ENV === 'production'
        ? 'https://api.easymod.tech'
        : 'http://localhost:3000';
}

function isAllowedLegacyAssetUrl(value) {
    if (typeof value !== 'string' || !value) return false;
    if (value.startsWith('/')) return value.startsWith('/uploads/');
    try {
        return new URL(value).origin === resolvePublicAssetOrigin();
    } catch {
        return false;
    }
}

function recoverStorageKeyFromLegacyUrl(value, options = {}) {
    const expectedShopId = typeof options === 'object' ? options.expectedShopId : options;
    if (!isAllowedLegacyAssetUrl(value)) return null;
    let parsed;
    try {
        parsed = new URL(value, resolvePublicAssetOrigin());
    } catch {
        return null;
    }
    if (!parsed.pathname.startsWith('/uploads/')) return null;
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(parsed.pathname.slice('/uploads/'.length));
    } catch {
        return null;
    }
    const parts = decodedPath.split('/');
    if (parts.length !== 3 || parts[0] !== 'conversation-attachments') return null;
    const key = parseAttachmentStorageKey(`${parts[1]}/${parts[2]}`);
    if (!key || (expectedShopId && String(expectedShopId) !== key.shopId)) return null;
    return `${key.shopId}/${key.fileName}`;
}

function absolutePathForAttachmentKey(storageKey) {
    const key = parseAttachmentStorageKey(storageKey);
    if (!key) return null;
    const uploadRoot = path.resolve(
        process.env.EASYMOD_UPLOAD_ROOT || path.resolve(__dirname, '../uploads'),
    );
    const attachmentRoot = path.resolve(uploadRoot, 'conversation-attachments');
    const absolutePath = path.resolve(attachmentRoot, key.shopId, key.fileName);
    if (!absolutePath.startsWith(`${attachmentRoot}${path.sep}`)) return null;
    return absolutePath;
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

function mintProbeAttachmentUrl({ shopId, fileName, baseUrl, expires }) {
    if (!Number.isSafeInteger(expires)) throw new Error('invalid attachment expiry');
    const key = parseAttachmentStorageKey(`${shopId}/${fileName}`);
    if (!key) throw new Error('invalid attachment identity');
    const secret = process.env.CSRF_SECRET || process.env.SESSION_SECRET || '';
    if (!secret) throw new Error('attachment signing secret is not configured');
    const origin = new URL(baseUrl).origin;
    const signature = crypto.createHmac('sha256', secret)
        .update(`${key.shopId}/${key.fileName}.${expires}`)
        .digest('hex');
    return `${origin}/uploads/conversation-attachments/${key.shopId}/${key.fileName}`
        + `?expires=${expires}&signature=${signature}`;
}

async function runAttachmentTrace(client) {
    if (process.env.PROBE_ATTACHMENT_TRACE !== 'true') return false;

    const messageId = String(
        process.env.PROBE_ATTACHMENT_MESSAGE_ID || process.env.TRACE_ATTACHMENT_MESSAGE_ID || '',
    ).trim();
    if (!messageId) throw new Error('PROBE_ATTACHMENT_MESSAGE_ID is required');
    const requestedShopId = String(process.env.PROBE_ATTACHMENT_SHOP_ID || '').trim();
    const publicBaseUrl = process.env.PROBE_PUBLIC_ASSET_URL
        || process.env.PUBLIC_ASSET_URL
        || process.env.PUBLIC_BASE_URL
        || process.env.API_URL
        || process.env.BASE_URL
        || 'https://api.easymod.tech';
    const parsedBaseUrl = new URL(publicBaseUrl);
    if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) {
        throw new Error('attachment public asset URL must use HTTP(S)');
    }

    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10s'");
    try {
        const result = await client.query(`
            SELECT m.id AS message_id,
                   m.conversation_id,
                   m.metadata::jsonb->>'attachment_storage_key' AS attachment_storage_key,
                   m.metadata::jsonb->>'image_url' AS image_url,
                   m.metadata::jsonb->>'file_url' AS file_url,
                   m.metadata::text AS metadata_text,
                   c.shop_id
              FROM public.messages m
              JOIN public.conversations c ON c.id = m.conversation_id
             WHERE m.id = $1
               AND ($2 = '' OR c.shop_id::text = $2)
             LIMIT 1
        `, [messageId, requestedShopId]);
        const row = result.rows[0];
        console.log(`ATTACHMENT_TRACE_MESSAGE_FOUND=${row ? 'YES' : 'NO'}`);
        if (!row) throw new Error('historical attachment message was not found');

        const oldUrl = row.image_url || row.file_url || '';
        const durableKey = parseAttachmentStorageKey(row.attachment_storage_key);
        const recoveredKey = row.attachment_storage_key == null
            ? recoverStorageKeyFromLegacyUrl(oldUrl, { expectedShopId: row.shop_id })
            : null;
        const key = durableKey || parseAttachmentStorageKey(recoveredKey);
        const shopMatches = Boolean(key && String(row.shop_id) === key.shopId);
        console.log(`ATTACHMENT_TRACE_DURABLE_KEY_PRESENT=${key ? 'YES' : 'NO'}`);
        console.log(`ATTACHMENT_TRACE_DURABLE_KEY_RECOVERED=${!durableKey && key ? 'YES' : 'NO'}`);
        console.log(`ATTACHMENT_TRACE_SHOP_MATCH=${shopMatches ? 'YES' : 'NO'}`);
        if (!shopMatches) throw new Error('historical attachment storage key is invalid or cross-shop');

        const absolutePath = absolutePathForAttachmentKey(`${key.shopId}/${key.fileName}`);
        if (!absolutePath) throw new Error('attachment path escaped upload root');
        const stat = await fs.stat(absolutePath).catch(() => null);
        console.log(`ATTACHMENT_TRACE_FILE_PRESENT=${stat?.isFile() ? 'YES' : 'NO'}`);
        if (!stat?.isFile()) throw new Error('historical attachment binary is missing from the volume');

        let oldExpired = false;
        try {
            const oldExpires = Number(new URL(oldUrl).searchParams.get('expires'));
            oldExpired = Number.isSafeInteger(oldExpires) && oldExpires < Math.floor(Date.now() / 1000);
        } catch (_) {
            oldExpired = false;
        }
        console.log(`ATTACHMENT_TRACE_OLD_URL_PRESENT=${oldUrl ? 'YES' : 'NO'}`);
        console.log(`ATTACHMENT_TRACE_OLD_URL_EXPIRED=${oldExpired ? 'YES' : 'NO'}`);
        if (!oldUrl || !oldExpired) throw new Error('historical attachment URL is not expired');

        const oldResponse = await fetch(oldUrl, { signal: AbortSignal.timeout(10_000) })
            .catch((error) => { throw new Error(`expired attachment HTTP check failed: ${error.message}`); });
        await oldResponse.arrayBuffer();
        console.log(`ATTACHMENT_TRACE_OLD_URL_STATUS=${oldResponse.status}`);
        if (oldResponse.status !== 404) throw new Error('expired attachment URL did not return 404');

        const messagesApiUrl = String(process.env.PROBE_MESSAGES_API_URL || '').trim();
        if (!messagesApiUrl) throw new Error('PROBE_MESSAGES_API_URL is required');
        const authorization = String(process.env.PROBE_AUTHORIZATION || '').trim();
        if (!authorization) throw new Error('PROBE_AUTHORIZATION is required with PROBE_MESSAGES_API_URL');
        const messagesResponse = await fetch(messagesApiUrl, {
            headers: { Authorization: authorization },
            signal: AbortSignal.timeout(10_000),
        });
        console.log(`ATTACHMENT_TRACE_MESSAGES_API_STATUS=${messagesResponse.status}`);
        if (!messagesResponse.ok) throw new Error('messages API did not return 2xx');
        const messagesPayload = await messagesResponse.json()
            .catch((error) => { throw new Error(`messages API returned invalid JSON: ${error.message}`); });
        const projectedMessages = messagesPayload?.data?.messages
            || messagesPayload?.messages
            || [];
        const projectedMessage = Array.isArray(projectedMessages)
            ? projectedMessages.find((message) => String(message?.id) === messageId)
            : null;
        if (!projectedMessage) throw new Error('messages API did not return the historical attachment message');
        const projectedMetadata = typeof projectedMessage.metadata === 'string'
            ? JSON.parse(projectedMessage.metadata)
            : projectedMessage.metadata;
        const applicationUrl = projectedMetadata?.image_url || projectedMetadata?.file_url || '';
        console.log(`ATTACHMENT_TRACE_APPLICATION_URL_PRESENT=${applicationUrl ? 'YES' : 'NO'}`);
        console.log(`ATTACHMENT_TRACE_APPLICATION_URL_DIFFERENT=${applicationUrl && applicationUrl !== oldUrl ? 'YES' : 'NO'}`);
        if (!applicationUrl || applicationUrl === oldUrl) {
            throw new Error('application returned the expired attachment URL');
        }

        let response;
        try {
            response = await fetch(applicationUrl, { signal: AbortSignal.timeout(10_000) });
            const body = await response.arrayBuffer();
            console.log(`ATTACHMENT_TRACE_HTTP_STATUS=${response.status}`);
            console.log(`ATTACHMENT_TRACE_HTTP_BYTES=${body.byteLength > 0 ? 'PRESENT' : 'EMPTY'}`);
            console.log(`ATTACHMENT_TRACE_HTTP_CONTENT_TYPE=${response.headers?.get?.('content-type') || ''}`);
            if (!response.ok || body.byteLength === 0) throw new Error('application attachment URL did not return bytes');
        } catch (error) {
            throw new Error(`application attachment HTTP check failed: ${error.message}`);
        }

        const after = await client.query(
            'SELECT metadata::text AS metadata_text FROM public.messages WHERE id = $1',
            [messageId],
        );
        const rowUnchanged = after.rows[0]?.metadata_text === row.metadata_text;
        console.log(`ATTACHMENT_TRACE_ROW_UNCHANGED=${rowUnchanged ? 'YES' : 'NO'}`);
        if (!rowUnchanged) throw new Error('attachment trace observed a changed message row');
        console.log('ATTACHMENT_TRACE=PASS');
    } finally {
        await client.query('ROLLBACK').catch(() => {});
    }
    return true;
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
    if (to.getTime() - from.getTime() > MAX_TRACE_WINDOW_MS) {
        throw new Error('trace window must not exceed 15 minutes');
    }
    if (marker.length < 5 || marker.length > 200) throw new Error('TRACE_MARKER length is invalid');

    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10s'");
    try {
    console.log(`TRACE_WINDOW_FROM=${from.toISOString()}`);
    console.log(`TRACE_WINDOW_TO=${to.toISOString()}`);
    console.log(`TRACE_MARKER=${marker}`);

    const channelResult = await client.query(`
        SELECT mc.id, mc.meta_asset_id, mc.display_name, mc.status, mc.shop_id,
               s.shop_name
          FROM public.meta_channels mc
          LEFT JOIN public.shops s ON s.id = mc.shop_id
         WHERE mc.platform = 'facebook'
         ORDER BY mc.display_name, mc.meta_asset_id
         LIMIT 1001
    `);
    const channelsTruncated = channelResult.rows.length > 1000;
    const channels = channelsTruncated
        ? { ...channelResult, rows: channelResult.rows.slice(0, 1000) }
        : channelResult;
    console.log(`TRACE_CHANNELS_TRUNCATED=${channelsTruncated ? 'YES' : 'NO'}`);
    for (const row of channels.rows) {
        console.log(`TRACE_CHANNEL channel_id=${row.id} page_id=${row.meta_asset_id}`
            + ` name=${JSON.stringify(row.display_name || '')} status=${row.status}`
            + ` shop_id=${row.shop_id || ''} shop_name=${JSON.stringify(row.shop_name || '')}`);
    }

    const receiptResult = await client.query(`
        SELECT id, page_id, event_id, shop_id, meta_channel_id, status,
               retry_count, last_error_code, received_at, processed_at,
               next_retry_at, payload_encrypted
          FROM public.meta_webhook_receipts
         WHERE received_at >= $1 AND received_at <= $2
         ORDER BY received_at ASC, id ASC
         LIMIT $3
    `, [from, to, MAX_TRACE_ROWS + 1]);
    const receiptsTruncated = receiptResult.rows.length > MAX_TRACE_ROWS;
    const receipts = receiptsTruncated
        ? { ...receiptResult, rows: receiptResult.rows.slice(0, MAX_TRACE_ROWS) }
        : receiptResult;
    console.log(`TRACE_RECEIPTS_TRUNCATED=${receiptsTruncated ? 'YES' : 'NO'}`);

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

    const messageResult = await client.query(`
        SELECT m.id AS message_id, m.external_id AS meta_mid,
               m.conversation_id, m.created_at AS message_created_at,
               (m.metadata::jsonb)->>'reply_to_provider_message_id' AS reply_to_provider_message_id,
               (m.metadata::jsonb)->>'reply_to_internal_message_id' AS reply_to_internal_message_id,
               (m.metadata::jsonb)->'reply_to'->>'status' AS reply_to_status,
               (m.metadata::jsonb)->>'message_type' AS message_type,
               (m.metadata::jsonb)->>'image_url' AS image_url,
               c.shop_id, c.customer_id, c.meta_channel_id,
               c.status AS conversation_status, c.hitl,
               c.resolved_at
          FROM public.messages m
          JOIN public.conversations c ON c.id = m.conversation_id
         WHERE m.sender = 'customer'
           AND m.created_at >= $1 AND m.created_at <= $2
           AND position($3 in coalesce(m.content, '')) > 0
         ORDER BY m.created_at ASC, m.id ASC
         LIMIT $4
    `, [from, to, marker, MAX_TRACE_ROWS + 1]);
    const messagesTruncated = messageResult.rows.length > MAX_TRACE_ROWS;
    const messages = messagesTruncated
        ? { ...messageResult, rows: messageResult.rows.slice(0, MAX_TRACE_ROWS) }
        : messageResult;
    console.log(`TRACE_MESSAGES_TRUNCATED=${messagesTruncated ? 'YES' : 'NO'}`);

    for (const row of messages.rows) {
        console.log(`TRACE_MESSAGE_MATCH message_id=${row.message_id}`
            + ` meta_mid=${row.meta_mid || ''} conversation_id=${row.conversation_id}`
            + ` shop_id=${row.shop_id} customer_id=${row.customer_id || ''}`
            + ` meta_channel_id=${row.meta_channel_id || ''}`
            + ` reply_to_provider_message_id=${row.reply_to_provider_message_id || ''}`
            + ` reply_to_internal_message_id=${row.reply_to_internal_message_id || ''}`
            + ` reply_to_status=${row.reply_to_status || ''}`
            + ` message_type=${row.message_type || ''}`
            + ` image_url_present=${row.image_url ? 'yes' : 'no'}`
            + ` conversation_status=${row.conversation_status} hitl=${row.hitl}`
            + ` resolved_at=${row.resolved_at ? row.resolved_at.toISOString() : ''}`
            + ` created_at=${row.message_created_at.toISOString()}`);
    }

    const matchedConversationIds = [...new Set(messages.rows.map((row) => row.conversation_id))];
    if (matchedConversationIds.length > 0) {
        const adjacentResult = await client.query(`
            SELECT m.id AS message_id, m.external_id AS meta_mid,
                   m.content, m.created_at AS message_created_at,
                   (m.metadata::jsonb)->>'reply_to_provider_message_id' AS reply_to_provider_message_id,
                   (m.metadata::jsonb)->>'reply_to_internal_message_id' AS reply_to_internal_message_id,
                   (m.metadata::jsonb)->'reply_to'->>'status' AS reply_to_status,
                   (m.metadata::jsonb)->>'message_type' AS message_type,
                   (m.metadata::jsonb)->>'image_url' AS image_url,
                   m.conversation_id
              FROM public.messages m
             WHERE m.sender = 'customer'
               AND m.conversation_id = ANY($3::uuid[])
               AND m.created_at >= $1 AND m.created_at <= $2
             ORDER BY m.created_at ASC, m.id ASC
             LIMIT $4
        `, [from, to, matchedConversationIds, MAX_TRACE_ROWS + 1]);
        const adjacentTruncated = adjacentResult.rows.length > MAX_TRACE_ROWS;
        const adjacentMessages = adjacentTruncated
            ? { ...adjacentResult, rows: adjacentResult.rows.slice(0, MAX_TRACE_ROWS) }
            : adjacentResult;
        console.log(`TRACE_ADJACENT_MESSAGES_TRUNCATED=${adjacentTruncated ? 'YES' : 'NO'}`);
        for (const row of adjacentMessages.rows) {
            const contentKind = row.content === '[Attachment]' ? 'attachment' : 'text';
            console.log(`TRACE_ADJACENT_MESSAGE message_id=${row.message_id}`
                + ` meta_mid=${row.meta_mid || ''} conversation_id=${row.conversation_id}`
                + ` content_kind=${contentKind}`
                + ` reply_to_provider_message_id=${row.reply_to_provider_message_id || ''}`
                + ` reply_to_internal_message_id=${row.reply_to_internal_message_id || ''}`
                + ` reply_to_status=${row.reply_to_status || ''}`
                + ` message_type=${row.message_type || ''}`
                + ` image_url_present=${row.image_url ? 'yes' : 'no'}`
                + ` created_at=${row.message_created_at.toISOString()}`);
        }
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
    } finally {
        await client.query('ROLLBACK').catch(() => {});
    }
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
        if (process.env.PROBE_ATTACHMENT_TRACE === 'true') {
            failureStage = 'ATTACHMENT_TRACE';
            await runAttachmentTrace(client);
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

module.exports = {
    decodeRenderedEnvValue,
    main,
    mintProbeAttachmentUrl,
    parseAttachmentStorageKey,
    runAttachmentTrace,
    runPreMigrationProbe,
    runInboundTrace,
};
