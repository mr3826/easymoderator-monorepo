'use strict';

/**
 * Guarded synthetic Meta webhook / worker-restart rehearsal.
 *
 * Commands:
 *   setup                         add the null-token synthetic Shop B Page
 *   post <run-id>                 sign and POST one local synthetic event
 *   inspect-queued <run-id>       verify its durable receipt and held BullMQ job
 *   wait-processed <run-id> <job-id> [timeout-ms]
 *   inspect-processed <run-id> <job-id>
 *   cleanup                       disconnect only the synthetic Page fixture
 *
 * Every mode requires the explicit seed confirmation and exact disposable
 * database target. The POST signer uses the API container's closure-only
 * META_APP_SECRET in memory; it never prints or writes the secret/signature.
 */

const crypto = require('node:crypto');
const http = require('node:http');
const { assertDisposableDatabase } = require('../../tests/helpers/disposable-database');

const EXPECTED_DATABASE = 'easymod_ops_gate_e2e';
const EXPECTED_DATABASE_HOST = 'postgres';
const EXPECTED_COMPOSE_PROJECT = 'easymod-operational-gate-closure-v1';
const SHOP_A_CODE = 'OGCE2E-A';
const SHOP_B_CODE = 'OGCE2E-B';
const SHOP_B_SENDER = 'ops-gate-buyer-b';
const PAGE_ID = 'OPS_E2E_PAGE_B';
const RUN_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,62}[a-zA-Z0-9])?$/;
const EVENT_PREFIX = 'mid.operational-gate-closure-';
const CONFIRMATION = 'SEED_LOCAL_OPS_E2E_ONLY';
const DEFAULT_WAIT_MS = 90_000;
const MAX_WAIT_MS = 120_000;
const POLL_INTERVAL_MS = 500;

function assertTarget() {
    if (process.env.NODE_ENV !== 'production') {
        throw new Error('Refusing rehearsal unless the isolated API remains NODE_ENV=production');
    }
    if (process.env.CLOSURE_COMPOSE_PROJECT_NAME !== EXPECTED_COMPOSE_PROJECT) {
        throw new Error(`Refusing rehearsal: CLOSURE_COMPOSE_PROJECT_NAME must be ${EXPECTED_COMPOSE_PROJECT}`);
    }
    if (process.env.OPS_E2E_PROJECT_CONFIRM !== EXPECTED_COMPOSE_PROJECT) {
        throw new Error(`Refusing rehearsal without OPS_E2E_PROJECT_CONFIRM=${EXPECTED_COMPOSE_PROJECT}`);
    }
    if (process.env.OPS_E2E_SEED_CONFIRM !== CONFIRMATION) {
        throw new Error(`Refusing rehearsal without OPS_E2E_SEED_CONFIRM=${CONFIRMATION}`);
    }
    const databaseUrl = process.env.DATABASE_URL;
    try {
        assertDisposableDatabase(databaseUrl, 'Operational Gate Closure worker restart rehearsal');
    } catch {
        throw new Error('Refusing rehearsal: DATABASE_URL is not a disposable database target');
    }
    let target;
    try {
        target = new URL(databaseUrl);
    } catch {
        throw new Error('Refusing rehearsal: DATABASE_URL is not a valid URL');
    }
    const database = target.pathname.replace(/^\//, '');
    if (database !== EXPECTED_DATABASE || target.hostname !== EXPECTED_DATABASE_HOST) {
        throw new Error(`Refusing rehearsal target ${target.hostname}/${database}`);
    }
}

function parseRunId(value) {
    if (!value || !RUN_ID_PATTERN.test(value)) {
        throw new Error('run-id must be 1-64 letters, digits, or hyphens and start/end with a letter or digit');
    }
    return value;
}

function eventIdFor(runId) {
    return `${EVENT_PREFIX}${parseRunId(runId)}`;
}

function expectedMessageFor(runId) {
    return `Synthetic worker restart rehearsal ${parseRunId(runId)}.`;
}

function assertNullToken(channel) {
    // Inspect only whether encrypted bytes are present; never call the virtual
    // getter, decrypt, or log this field.
    const storedCiphertext = channel?.getDataValue?.('page_access_token_ct');
    if (storedCiphertext != null && storedCiphertext !== '') {
        throw new Error('Refusing synthetic Page fixture with stored channel-token ciphertext');
    }
}

async function openRuntime({ needsQueue = false } = {}) {
    assertTarget();
    const { sequelize } = require('../../src/utils/database/database-setup');
    const entities = require('../../src/modules/entities');
    const MetaChannel = require('../../src/modules/channel-providers/meta-channel.entity');
    const MetaWebhookReceipt = require('../../src/modules/integration/meta-webhook-receipt.entity');
    const runtime = { sequelize, entities, MetaChannel, MetaWebhookReceipt, messageQueue: null };
    if (needsQueue) {
        runtime.messageQueue = require('../../src/jobs/message-queue').messageQueue;
    }
    await sequelize.authenticate();
    return runtime;
}

async function loadSyntheticShops(runtime) {
    const [shopA, shopB] = await Promise.all([
        runtime.entities.Shop.findOne({ where: { unique_code: SHOP_A_CODE } }),
        runtime.entities.Shop.findOne({ where: { unique_code: SHOP_B_CODE } }),
    ]);
    if (!shopA || !shopB) throw new Error('Run the guarded two-shop E2E seed before worker-restart setup');

    const shopService = require('../../src/modules/shop/shop.service');
    const aiSettings = await shopService.getShopAiSettings(shopB.id);
    if (aiSettings?.automation_mode !== 'MANUAL') {
        throw new Error('Refusing worker-restart rehearsal unless Shop B effective automation_mode is MANUAL');
    }
    return { shopA, shopB };
}

async function assertOnlySyntheticConnectedChannel(runtime, shopA, shopB) {
    const connected = await runtime.MetaChannel.findAll({
        where: {
            shop_id: [shopA.id, shopB.id],
            platform: 'facebook',
            status: 'CONNECTED',
        },
    });
    const unexpectedConnected = connected.filter((channel) => !(
        String(channel.shop_id) === String(shopB.id)
        && channel.meta_asset_id === PAGE_ID
    ));
    if (unexpectedConnected.length > 0) {
        throw new Error('Refusing rehearsal: an unexpected connected Facebook channel exists for a synthetic shop');
    }

    const pageRows = await runtime.MetaChannel.findAll({ where: { meta_asset_id: PAGE_ID } });
    if (pageRows.length > 1 || pageRows.some((channel) => String(channel.shop_id) !== String(shopB.id))) {
        throw new Error('Refusing rehearsal: the synthetic Page ID is already assigned outside Shop B');
    }
    const channel = pageRows[0] || null;
    if (channel && channel.platform !== 'facebook') {
        throw new Error('Refusing rehearsal: the synthetic Page ID is assigned to an unexpected platform');
    }
    if (channel) assertNullToken(channel);
    return channel;
}

async function setup(runtime) {
    const { shopA, shopB } = await loadSyntheticShops(runtime);
    const existing = await assertOnlySyntheticConnectedChannel(runtime, shopA, shopB);
    const now = new Date();
    let channel = existing;
    if (!channel) {
        channel = await runtime.MetaChannel.create({
            shop_id: shopB.id,
            platform: 'facebook',
            meta_asset_id: PAGE_ID,
            display_name: 'Synthetic Closure Worker Rehearsal Page B',
            page_access_token_ct: null,
            token_expires_at: null,
            token_last_refreshed_at: null,
            token_refresh_attempts: 0,
            webhook_verify_token: null,
            webhook_subscribed_fields: [],
            status: 'CONNECTED',
            connected_at: now,
            disconnected_at: null,
            connected_by_user_id: null,
            last_error: null,
        });
    } else {
        await channel.update({
            display_name: 'Synthetic Closure Worker Rehearsal Page B',
            page_access_token_ct: null,
            token_expires_at: null,
            token_last_refreshed_at: null,
            token_refresh_attempts: 0,
            webhook_verify_token: null,
            webhook_subscribed_fields: [],
            status: 'CONNECTED',
            connected_at: now,
            disconnected_at: null,
            last_error: null,
        });
    }
    assertNullToken(channel);
    return {
        mode: 'setup',
        shop: SHOP_B_CODE,
        pageId: PAGE_ID,
        status: channel.status,
        effectiveReplyMode: 'MANUAL',
        tokenConfigured: false,
    };
}

async function verifyChannelPreconditions(runtime) {
    const { shopA, shopB } = await loadSyntheticShops(runtime);
    const channel = await runtime.MetaChannel.findOne({
        where: { shop_id: shopB.id, platform: 'facebook', meta_asset_id: PAGE_ID },
    });
    if (!channel || channel.status !== 'CONNECTED') {
        throw new Error('The synthetic Shop B Page fixture is not connected; run setup first');
    }
    assertNullToken(channel);
    await assertOnlySyntheticConnectedChannel(runtime, shopA, shopB);
    return { shopA, shopB, channel };
}

async function sendLocalSignedWebhook(body, signature) {
    return new Promise((resolve, reject) => {
        const request = http.request({
            host: '127.0.0.1',
            port: 3000,
            path: '/api/webhooks/meta',
            method: 'POST',
            agent: false,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': body.length,
                'x-hub-signature-256': signature,
            },
        }, (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode || 0));
        });
        request.on('error', reject);
        request.end(body);
    });
}

async function post(runtime, runId) {
    const { shopB } = await verifyChannelPreconditions(runtime);
    const eventId = eventIdFor(runId);
    const priorReceipt = await runtime.MetaWebhookReceipt.findOne({
        where: { page_id: PAGE_ID, event_id: eventId },
        attributes: ['id'],
    });
    const priorMessage = await runtime.entities.Message.findOne({
        where: { external_id: eventId },
        attributes: ['id'],
    });
    if (priorReceipt || priorMessage) {
        throw new Error('Refusing duplicate run-id; choose a fresh synthetic run-id');
    }

    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) throw new Error('META_APP_SECRET is unavailable in this isolated API process');
    const timestamp = Date.now();
    const payload = {
        object: 'page',
        entry: [{
            id: PAGE_ID,
            messaging: [{
                sender: { id: SHOP_B_SENDER },
                recipient: { id: PAGE_ID },
                timestamp,
                message: { mid: eventId, text: expectedMessageFor(runId) },
            }],
        }],
    };
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
    const statusCode = await sendLocalSignedWebhook(rawBody, signature);
    if (statusCode !== 200) {
        throw new Error(`Local signed webhook returned HTTP ${statusCode}; inspect the receipt before retrying`);
    }
    return {
        mode: 'post',
        statusCode,
        shop: SHOP_B_CODE,
        pageId: PAGE_ID,
        eventId,
        runId,
        message: expectedMessageFor(runId),
    };
}

function assertReceiptShop(receipt, shopB) {
    if (String(receipt.shop_id) !== String(shopB.id)) {
        throw new Error('Receipt is not bound to synthetic Shop B');
    }
    if (!receipt.meta_channel_id) throw new Error('Receipt has no bound synthetic Page channel');
}

async function readEvidence(runtime, runId, suppliedJobId = null) {
    const { shopB } = await loadSyntheticShops(runtime);
    const eventId = eventIdFor(runId);
    const receipt = await runtime.MetaWebhookReceipt.findOne({
        where: { page_id: PAGE_ID, event_id: eventId },
    });
    if (!receipt) throw new Error(`No durable receipt found for ${eventId}`);
    assertReceiptShop(receipt, shopB);

    const inboundRows = await runtime.entities.Message.findAll({
        where: { external_id: eventId, sender: 'customer' },
        include: [{
            model: runtime.entities.Conversation,
            as: 'conversation',
            required: true,
            where: { shop_id: shopB.id, channel: 'messenger' },
            attributes: ['id', 'shop_id', 'customer_id', 'channel'],
        }],
        order: [['created_at', 'ASC']],
    });
    const inbound = inboundRows[0] || null;
    let aiAfterInbound = [];
    if (inbound) {
        const { Op } = require('sequelize');
        aiAfterInbound = await runtime.entities.Message.findAll({
            where: {
                conversation_id: inbound.conversation_id,
                sender: 'ai',
                created_at: { [Op.gte]: inbound.created_at },
            },
            attributes: ['id', 'provider_message_id', 'delivery_state', 'created_at'],
        });
    }

    const queueJobId = receipt.queue_job_id || suppliedJobId;
    let jobState = 'missing';
    if (queueJobId) {
        const job = await runtime.messageQueue.getJob(String(queueJobId));
        if (job) jobState = await job.getState();
    }
    const evidence = {
        shop: SHOP_B_CODE,
        pageId: PAGE_ID,
        eventId,
        receiptStatus: receipt.status,
        receiptShopMatches: String(receipt.shop_id) === String(shopB.id),
        receiptChannelIdPresent: Boolean(receipt.meta_channel_id),
        encryptedReplayBodyPresent: Boolean(receipt.payload_encrypted),
        receiptQueueJobId: receipt.queue_job_id || null,
        queueJobId: queueJobId || null,
        queueJobState: jobState,
        customerMessageCount: inboundRows.length,
        customerMessageMatches: inboundRows.some((row) => row.content === expectedMessageFor(runId)),
        providerAcknowledgementPresent: inboundRows.some((row) => Boolean(row.provider_message_id))
            || aiAfterInbound.some((row) => Boolean(row.provider_message_id)),
        aiRowsAtOrAfterInbound: aiAfterInbound.length,
        processedAt: receipt.processed_at ? new Date(receipt.processed_at).toISOString() : null,
    };
    return { evidence, inbound, receipt };
}

async function inspectQueued(runtime, runId) {
    const { evidence } = await readEvidence(runtime, runId);
    if (evidence.receiptStatus !== 'QUEUED'
        || !evidence.encryptedReplayBodyPresent
        || !evidence.receiptQueueJobId
        || !['delayed', 'waiting'].includes(evidence.queueJobState)
        || evidence.customerMessageCount !== 1
        || !evidence.customerMessageMatches
        || evidence.providerAcknowledgementPresent
        || evidence.aiRowsAtOrAfterInbound !== 0) {
        throw new Error(`Queued-state assertions failed: ${JSON.stringify(evidence)}`);
    }
    return { mode: 'inspect-queued', ...evidence };
}

function parseTimeout(value) {
    if (value === undefined) return DEFAULT_WAIT_MS;
    const timeout = Number(value);
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > MAX_WAIT_MS) {
        throw new Error(`timeout-ms must be an integer from 1000 through ${MAX_WAIT_MS}`);
    }
    return timeout;
}

async function waitProcessed(runtime, runId, queueJobId, timeoutMs) {
    if (!queueJobId || !/^[A-Za-z0-9_-]{1,191}$/.test(queueJobId)) {
        throw new Error('queue-job-id must be the BullMQ ID returned by inspect-queued');
    }
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        const snapshot = await readEvidence(runtime, runId, queueJobId);
        last = snapshot.evidence;
        if (last.receiptStatus === 'PROCESSED'
            && !last.encryptedReplayBodyPresent
            && !last.receiptQueueJobId
            && last.queueJobState === 'completed') {
            return { mode: 'wait-processed', ...last };
        }
        if (last.receiptStatus === 'DEAD_LETTERED' || last.queueJobState === 'failed') {
            throw new Error(`Worker recovery reached a failed terminal state: ${JSON.stringify(last)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error(`Timed out waiting for processed receipt/job: ${JSON.stringify(last)}`);
}

async function inspectProcessed(runtime, runId, queueJobId) {
    if (!queueJobId || !/^[A-Za-z0-9_-]{1,191}$/.test(queueJobId)) {
        throw new Error('queue-job-id must be the BullMQ ID returned by inspect-queued');
    }
    const { evidence } = await readEvidence(runtime, runId, queueJobId);
    if (evidence.receiptStatus !== 'PROCESSED'
        || evidence.encryptedReplayBodyPresent
        || evidence.receiptQueueJobId
        || evidence.queueJobState !== 'completed'
        || evidence.customerMessageCount !== 1
        || !evidence.customerMessageMatches
        || evidence.providerAcknowledgementPresent
        || evidence.aiRowsAtOrAfterInbound !== 0) {
        throw new Error(`Processed-state assertions failed: ${JSON.stringify(evidence)}`);
    }
    return { mode: 'inspect-processed', ...evidence };
}

async function cleanup(runtime) {
    const { shopA, shopB } = await loadSyntheticShops(runtime);
    const pageRows = await runtime.MetaChannel.findAll({ where: { meta_asset_id: PAGE_ID } });
    if (pageRows.length > 1 || pageRows.some((row) => String(row.shop_id) !== String(shopB.id))) {
        throw new Error('Refusing cleanup: the synthetic Page ID is assigned outside Shop B or is ambiguous');
    }
    const channel = pageRows[0] || null;
    if (!channel) return { mode: 'cleanup', changed: false, pageId: PAGE_ID };
    if (channel.platform !== 'facebook') {
        throw new Error('Refusing cleanup: the synthetic Page ID is assigned to an unexpected platform');
    }
    assertNullToken(channel);

    const pageReceipts = await runtime.MetaWebhookReceipt.findAll({
        where: { page_id: PAGE_ID },
        attributes: ['id', 'status'],
    });
    const unprocessedReceipt = pageReceipts.find((receipt) => !['PROCESSED', 'SKIPPED'].includes(receipt.status));
    if (unprocessedReceipt) {
        throw new Error(`Refusing cleanup while a synthetic receipt is ${unprocessedReceipt.status}`);
    }
    const remainingConnected = await runtime.MetaChannel.findAll({
        where: {
            shop_id: [shopA.id, shopB.id],
            platform: 'facebook',
            status: 'CONNECTED',
        },
    });
    if (remainingConnected.some((row) => String(row.id) !== String(channel.id))) {
        throw new Error('Refusing cleanup because another connected Facebook channel exists for a synthetic shop');
    }

    let customerDetached = false;
    let conversationLinksDetached = 0;
    const customer = await runtime.entities.Customer.findOne({
        where: {
            shop_id: shopB.id,
            channel_type: 'messenger',
            channel_user_id: SHOP_B_SENDER,
        },
    });
    if (customer && String(customer.meta_channel_id || '') === String(channel.id)) {
        await customer.update({ meta_channel_id: null });
        customerDetached = true;
    }
    const conversations = await runtime.entities.Conversation.findAll({
        where: {
            shop_id: shopB.id,
            channel: 'messenger',
            meta_channel_id: channel.id,
        },
    });
    for (const conversation of conversations) {
        await conversation.update({ meta_channel_id: null });
        conversationLinksDetached += 1;
    }

    await channel.update({
        page_access_token_ct: null,
        status: 'DISCONNECTED',
        disconnected_at: new Date(),
        last_error: null,
    });
    return {
        mode: 'cleanup',
        changed: true,
        pageId: PAGE_ID,
        status: channel.status,
        tokenConfigured: false,
        customerDetached,
        conversationLinksDetached,
    };
}

async function run() {
    const [command, ...args] = process.argv.slice(2);
    const knownCommands = new Set([
        'setup', 'post', 'inspect-queued', 'wait-processed', 'inspect-processed', 'cleanup',
    ]);
    if (!knownCommands.has(command)) {
        throw new Error('Command must be setup, post, inspect-queued, wait-processed, inspect-processed, or cleanup');
    }

    const runtime = await openRuntime({
        needsQueue: ['inspect-queued', 'wait-processed', 'inspect-processed'].includes(command),
    });
    try {
        let result;
        if (command === 'setup' || command === 'cleanup') {
            if (args.length !== 0) throw new Error(`${command} takes no arguments`);
            result = command === 'setup' ? await setup(runtime) : await cleanup(runtime);
        } else if (command === 'post') {
            if (args.length !== 1) throw new Error('post requires exactly one run-id');
            result = await post(runtime, args[0]);
        } else if (command === 'inspect-queued') {
            if (args.length !== 1) throw new Error('inspect-queued requires exactly one run-id');
            result = await inspectQueued(runtime, args[0]);
        } else if (command === 'wait-processed') {
            if (args.length < 2 || args.length > 3) {
                throw new Error('wait-processed requires run-id, queue-job-id, and optional timeout-ms');
            }
            result = await waitProcessed(runtime, args[0], args[1], parseTimeout(args[2]));
        } else {
            if (args.length !== 2) throw new Error('inspect-processed requires run-id and queue-job-id');
            result = await inspectProcessed(runtime, args[0], args[1]);
        }
        console.log(JSON.stringify(result));
    } finally {
        if (runtime.messageQueue) await runtime.messageQueue.close().catch(() => {});
        await runtime.sequelize.close().catch(() => {});
    }
}

run().catch((error) => {
    console.error('WORKER_RESTART_REHEARSAL_FAILED', error.message);
    process.exitCode = 1;
});
