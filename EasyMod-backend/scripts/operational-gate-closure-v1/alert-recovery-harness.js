'use strict';

/**
 * Guarded synthetic alert and webhook-receipt recovery rehearsal.
 *
 * Commands:
 *   preflight
 *   post <run-id>
 *   inspect-held <run-id>
 *   prepare-replay <run-id>
 *   reconcile <run-id>
 *   inspect-recovered <run-id>
 *   cleanup <run-id>
 *
 * This harness uses only the named closure E2E database, a local signed
 * webhook, a synthetic opt-in event, and the internal PII-free alert sink. It
 * never emits provider/customer content or prints any environment value,
 * signature, token, encrypted replay body, or database URL.
 */

const crypto = require('node:crypto');
const http = require('node:http');
const { assertDisposableDatabase } = require('../../tests/helpers/disposable-database');

const EXPECTED_PROJECT = 'easymod-operational-gate-closure-v1';
const EXPECTED_DATABASE = 'easymod_ops_gate_e2e';
const EXPECTED_DATABASE_HOST = 'postgres';
const EXPECTED_TENANT_NAME = 'Operational Gate Closure E2E Tenant';
const SHOP_A_CODE = 'OGCE2E-A';
const SHOP_B_CODE = 'OGCE2E-B';
const SHOP_A_NAME = 'Ops Closure Synthetic Shop A';
const SHOP_B_NAME = 'Ops Closure Synthetic Shop B';
const PAGE_PREFIX = 'OPS_E2E_ALERT_PAGE_';
const SENDER_PREFIX = 'OPS_E2E_ALERT_SENDER_';
const RUN_ID_PATTERN = /^alert-[0-9]{8}T[0-9]{6}Z-[0-9]{1,10}$/;
const SEED_CONFIRMATION = 'SEED_LOCAL_OPS_E2E_ONLY';
const PROJECT_CONFIRMATION = 'easymod-operational-gate-closure-v1';
const WORKER_STOPPED_CONFIRMATION = 'WORKER_STOPPED_FOR_ALERT_REHEARSAL';
const TEST_PROVIDER_MARKER = 'LOCAL_NO_EGRESS_TEST_KEY_NOT_A_CREDENTIAL';
const ALERT_SINK_URL = 'http://alert-sink:8081/webhook';
const ALERT_SINK_RECEIPT_URL = 'http://alert-sink:8081/receipt';
const LOCAL_API_HOST = '127.0.0.1';
const LOCAL_API_PORT = 3000;
const ALERT_TIMEOUT_MS = 8_000;
const ALERT_POLL_MS = 200;
const RETRY_CLAIM_STALE_MS = 15 * 60 * 1000;
const ORPHANED_RECEIVED_MS = 60 * 1000;
const CONSERVATIVE_RETENTION_DAYS = 7;

class HarnessError extends Error {}

function refuse(message) {
    throw new HarnessError(message);
}

function assertTarget({ requireWorkerStopped = false } = {}) {
    if (process.env.NODE_ENV !== 'production') {
        refuse('Refusing rehearsal unless the isolated API remains NODE_ENV=production');
    }
    if (process.env.OPS_E2E_SEED_CONFIRM !== SEED_CONFIRMATION) {
        refuse(`Refusing rehearsal without OPS_E2E_SEED_CONFIRM=${SEED_CONFIRMATION}`);
    }
    if (process.env.OPS_E2E_PROJECT_CONFIRM !== PROJECT_CONFIRMATION) {
        refuse(`Refusing rehearsal without OPS_E2E_PROJECT_CONFIRM=${PROJECT_CONFIRMATION}`);
    }
    if (requireWorkerStopped
        && process.env.OPS_E2E_WORKER_STOPPED_CONFIRM !== WORKER_STOPPED_CONFIRMATION) {
        refuse(`Stop only the closure worker, verify it is exited, then set OPS_E2E_WORKER_STOPPED_CONFIRM=${WORKER_STOPPED_CONFIRMATION}`);
    }

    const databaseUrl = process.env.DATABASE_URL;
    let target;
    try {
        assertDisposableDatabase(databaseUrl, 'Operational Gate Closure alert recovery rehearsal');
        target = new URL(databaseUrl);
    } catch (_) {
        refuse('Refusing rehearsal: DATABASE_URL is not a disposable database target');
    }
    const database = target.pathname.replace(/^\//, '');
    if (target.hostname !== EXPECTED_DATABASE_HOST || database !== EXPECTED_DATABASE) {
        refuse('Refusing rehearsal: database host/name do not match the closure E2E target');
    }
    if (!target.username || !target.password || target.port !== '5432') {
        refuse('Refusing rehearsal: closure database connection is incomplete');
    }

    if (process.env.DB_SSL !== 'false'
        || process.env.RUN_MIGRATIONS_ON_STARTUP !== 'false'
        || process.env.START_EMBEDDED_WORKERS !== 'false') {
        refuse('Refusing rehearsal: closure runtime must disable startup migrations and embedded workers');
    }
    if (process.env.APP_URL !== 'https://app.localhost'
        || process.env.SLACK_ALERT_WEBHOOK_URL !== ALERT_SINK_URL
        || Boolean(process.env.SENTRY_DSN)
        || Boolean(process.env.OPS_ESCALATION_WEBHOOK_URL)) {
        refuse('Refusing rehearsal: alert or app origins are not closure-local');
    }
    const corsOrigins = String(process.env.CORS_ORIGINS || '').split(',').map((value) => value.trim());
    if (!corsOrigins.includes('https://app.localhost')
        || !corsOrigins.includes('https://127.0.0.1:54680')
        || corsOrigins.includes('*')) {
        refuse('Refusing rehearsal: credentialed CORS must use the exact closure HTTPS origins');
    }
    if (process.env.META_APP_ID !== '0000000000000001'
        || process.env.META_LOGIN_CONFIG_ID !== '0000000000000001'
        || typeof process.env.META_APP_SECRET !== 'string'
        || process.env.META_APP_SECRET.length < 32) {
        refuse('Refusing rehearsal: synthetic Meta marker configuration is required');
    }
    if (process.env.OPENAI_API_KEY !== TEST_PROVIDER_MARKER
        || process.env.GEMINI_API_KEY !== TEST_PROVIDER_MARKER
        || process.env.GOOGLE_GEMINI_API_KEY !== TEST_PROVIDER_MARKER
        || process.env.RESEND_API_KEY !== TEST_PROVIDER_MARKER) {
        refuse('Refusing rehearsal: synthetic provider markers are required; real credentials are not allowed');
    }

    const mustStayOff = [
        'AI_PHOTO_MATCH_ENABLED',
        'AI_VISION_ENABLED',
        'DOMAIN_AGENT_RUNTIME_ENABLED',
        'AI_ORDER_MUTATIONS_ENABLED',
        'AI_COURIER_BOOKING_ENABLED',
        'AI_PAYMENT_ACCEPTANCE_ENABLED',
        'AI_SUPPORT_CASE_ENABLED',
        'MOBILE_API_ENABLED',
        'GROWTH_OS_ENABLED',
        'TELEGRAM_ENABLED',
        'BKASH_ENABLED',
    ];
    if (mustStayOff.some((name) => process.env[name] !== 'false')) {
        refuse('Refusing rehearsal: a provider, mobile, or commerce side-effect flag is enabled');
    }
}

function parseRunId(value) {
    if (!value || !RUN_ID_PATTERN.test(value)) {
        refuse('run-id must use alert-YYYYMMDDTHHMMSSZ-<numeric-process-id> format');
    }
    return value;
}

function pageIdFor(runId) {
    return `${PAGE_PREFIX}${parseRunId(runId)}`;
}

function senderIdFor(runId) {
    return `${SENDER_PREFIX}${parseRunId(runId)}`;
}

function iso(value) {
    return value ? new Date(value).toISOString() : null;
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

async function openRuntime() {
    assertTarget();
    const { sequelize } = require('../../src/utils/database/database-setup');
    const entities = require('../../src/modules/entities');
    const MetaChannel = require('../../src/modules/channel-providers/meta-channel.entity');
    const MetaWebhookReceipt = require('../../src/modules/integration/meta-webhook-receipt.entity');
    const runtime = {
        sequelize,
        entities,
        MetaChannel,
        MetaWebhookReceipt,
    };
    try {
        await sequelize.authenticate();
    } catch (_) {
        await sequelize.close().catch(() => {});
        refuse('Could not authenticate to the named closure E2E database');
    }
    return runtime;
}

async function closeRuntime(runtime) {
    if (runtime?.sequelize) await runtime.sequelize.close().catch(() => {});
}

async function loadSyntheticShops(runtime) {
    const [shopA, shopB] = await Promise.all([
        runtime.entities.Shop.findOne({
            where: { unique_code: SHOP_A_CODE },
            attributes: ['id', 'tenant_id', 'unique_code', 'shop_name'],
        }),
        runtime.entities.Shop.findOne({
            where: { unique_code: SHOP_B_CODE },
            attributes: ['id', 'tenant_id', 'unique_code', 'shop_name'],
        }),
    ]);
    if (!shopA || !shopB
        || shopA.shop_name !== SHOP_A_NAME
        || shopB.shop_name !== SHOP_B_NAME
        || String(shopA.tenant_id) !== String(shopB.tenant_id)) {
        refuse('Run the guarded two-shop closure E2E seed before alert recovery');
    }
    const tenant = await runtime.entities.Tenant.findByPk(shopB.tenant_id, { attributes: ['name'] });
    if (!tenant || tenant.name !== EXPECTED_TENANT_NAME) {
        refuse('Refusing rehearsal: the selected shops do not belong to the closure E2E tenant');
    }

    const shopSettings = await runtime.entities.Shop.findByPk(shopB.id, { attributes: ['settings'] });
    const { normalizeAiReplyMode } = require('../../src/modules/shop/ai-reply-mode');
    const effectiveMode = normalizeAiReplyMode(shopSettings?.settings?.ai?.automation_mode);
    if (effectiveMode !== 'MANUAL') {
        refuse('Refusing rehearsal unless the synthetic Shop B effective automation mode is MANUAL');
    }
    return { shopA, shopB };
}

async function readSinkSnapshot() {
    let response;
    try {
        response = await fetch(ALERT_SINK_RECEIPT_URL, { signal: AbortSignal.timeout(3_000) });
    } catch (_) {
        refuse('The internal PII-free alert sink is not reachable');
    }
    if (!response.ok) refuse(`The internal alert sink receipt endpoint returned HTTP ${response.status}`);

    let body;
    try {
        body = await response.json();
    } catch (_) {
        refuse('The internal alert sink returned an invalid receipt response');
    }
    if (!Number.isInteger(body?.receiptCount)
        || !Number.isInteger(body?.retainedCount)
        || !Array.isArray(body?.receipts)) {
        refuse('The internal alert sink receipt shape is not recognized');
    }

    const receipts = body.receipts.map((item) => {
        if (!Number.isInteger(item?.sequence)
            || typeof item?.receivedAt !== 'string'
            || !Number.isInteger(item?.byteLength)
            || !/^[a-f0-9]{64}$/i.test(item?.bodySha256 || '')) {
            refuse('The internal alert sink returned an unexpected receipt entry');
        }
        return {
            sequence: item.sequence,
            receivedAt: item.receivedAt,
            byteLength: item.byteLength,
            bodySha256: item.bodySha256,
        };
    });
    return {
        receiptCount: body.receiptCount,
        retainedCount: body.retainedCount,
        receipts,
    };
}

function findNewSinkReceipt(snapshot, sequence) {
    return snapshot.receipts.find((item) => item.sequence === sequence) || null;
}

async function waitForAlertReceipt(previousCount) {
    const deadline = Date.now() + ALERT_TIMEOUT_MS;
    let snapshot;
    while (Date.now() <= deadline) {
        snapshot = await readSinkSnapshot();
        if (snapshot.receiptCount > previousCount) break;
        await new Promise((resolve) => setTimeout(resolve, ALERT_POLL_MS));
    }
    if (!snapshot || snapshot.receiptCount !== previousCount + 1) {
        refuse('Expected exactly one new local alert receipt; preserve the run and inspect the sink count');
    }
    const receipt = findNewSinkReceipt(snapshot, previousCount + 1);
    if (!receipt) refuse('The new local alert receipt is no longer in the sink retention window');
    return { snapshot, receipt };
}

async function postSignedWebhook(rawBody, signature) {
    return new Promise((resolve, reject) => {
        const request = http.request({
            host: LOCAL_API_HOST,
            port: LOCAL_API_PORT,
            path: '/api/webhooks/meta',
            method: 'POST',
            agent: false,
            headers: {
                'content-type': 'application/json',
                'content-length': rawBody.length,
                'x-hub-signature-256': signature,
            },
        }, (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode || 0));
        });
        request.setTimeout(5_000, () => request.destroy(new Error('local timeout')));
        request.on('error', () => reject(new HarnessError('The local signed webhook request failed')));
        request.end(rawBody);
    });
}

async function rowsForPage(runtime, pageId) {
    return runtime.MetaWebhookReceipt.findAll({
        where: { page_id: pageId },
        attributes: [
            'id', 'page_id', 'event_type', 'status', 'retry_count', 'last_error_code',
            'next_retry_at', 'shop_id', 'meta_channel_id', 'queue_job_id', 'received_at',
            'processed_at', 'payload_hash', 'payload_encrypted',
        ],
        order: [['created_at', 'ASC']],
        limit: 2,
    });
}

async function getOnlyReceipt(runtime, runId) {
    const rows = await rowsForPage(runtime, pageIdFor(runId));
    if (rows.length !== 1) {
        refuse(rows.length === 0
            ? 'No receipt exists for this run-id'
            : 'More than one receipt exists for this run-id; preserve state and inspect manually');
    }
    const receipt = rows[0];
    if (receipt.event_type !== 'optin') refuse('Refusing to inspect a receipt that is not a synthetic optin event');
    return receipt;
}

function receiptEvidence(receipt) {
    return {
        receiptId: receipt.id,
        pageId: receipt.page_id,
        eventType: receipt.event_type,
        status: receipt.status,
        retryCount: receipt.retry_count,
        errorCode: receipt.last_error_code || null,
        receivedAt: iso(receipt.received_at),
        nextRetryAt: iso(receipt.next_retry_at),
        processedAt: iso(receipt.processed_at),
        shopId: receipt.shop_id || null,
        channelId: receipt.meta_channel_id || null,
        queueJobIdPresent: Boolean(receipt.queue_job_id),
        replayBodyPresent: Boolean(receipt.getDataValue('payload_encrypted')),
        payloadSha256: receipt.payload_hash,
    };
}

async function preflight(runtime) {
    await loadSyntheticShops(runtime);
    const sink = await readSinkSnapshot();
    return {
        mode: 'preflight',
        project: EXPECTED_PROJECT,
        database: EXPECTED_DATABASE,
        databaseHost: EXPECTED_DATABASE_HOST,
        seededSyntheticShops: [SHOP_A_CODE, SHOP_B_CODE],
        shopBMode: 'MANUAL',
        providerKeys: 'synthetic-marker-values-only',
        externalAlertSinks: 'disabled',
        localSinkReceiptCount: sink.receiptCount,
        workerMustBeStoppedForPostAndReconcile: true,
    };
}

async function postIncident(runtime, runId) {
    const { shopB } = await loadSyntheticShops(runtime);
    const pageId = pageIdFor(runId);
    const senderId = senderIdFor(runId);

    if ((await rowsForPage(runtime, pageId)).length !== 0) {
        refuse('Refusing duplicate run-id: a receipt already exists for this synthetic Page');
    }
    const channelRows = await runtime.MetaChannel.findAll({
        where: { meta_asset_id: pageId },
        attributes: ['id'],
        limit: 2,
    });
    if (channelRows.length !== 0) {
        refuse('Refusing duplicate run-id: a channel row already exists for this synthetic Page');
    }

    const before = await readSinkSnapshot();
    const timestamp = Date.now();
    const messaging = {
        sender: { id: senderId },
        recipient: { id: pageId },
        timestamp,
        optin: {
            ref: `closure-alert-${runId}`,
            user_ref: `closure-alert-user-${runId}`,
        },
    };
    const payload = {
        object: 'page',
        entry: [{ id: pageId, time: timestamp, messaging: [messaging] }],
    };
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = `sha256=${crypto.createHmac('sha256', process.env.META_APP_SECRET).update(rawBody).digest('hex')}`;
    const responseCode = await postSignedWebhook(rawBody, signature);
    if (responseCode !== 200) {
        refuse(`The local signed webhook returned HTTP ${responseCode}; inspect state before retrying`);
    }

    const rows = await rowsForPage(runtime, pageId);
    if (rows.length !== 1) refuse('The signed webhook did not create exactly one durable receipt');
    const receipt = rows[0];
    const expectedPayloadHash = sha256(Buffer.from(JSON.stringify(messaging), 'utf8'));
    if (receipt.event_type !== 'optin'
        || receipt.status !== 'IDENTITY_NOT_RESOLVED'
        || receipt.retry_count !== 0
        || receipt.last_error_code !== 'PAGE_NOT_CONNECTED'
        || receipt.shop_id
        || receipt.meta_channel_id
        || receipt.queue_job_id
        || !receipt.getDataValue('payload_encrypted')
        || receipt.payload_hash !== expectedPayloadHash) {
        refuse('The signed webhook did not produce the expected held synthetic optin receipt');
    }

    const { snapshot: after, receipt: alertReceipt } = await waitForAlertReceipt(before.receiptCount);
    return {
        mode: 'post',
        runId,
        shop: SHOP_B_CODE,
        httpStatus: responseCode,
        receipt: receiptEvidence(receipt),
        alertReceipt,
        localAlertReceiptCount: after.receiptCount,
        senderIdWithheld: true,
        eventBodyWithheld: true,
    };
}

async function inspectHeld(runtime, runId) {
    const receipt = await getOnlyReceipt(runtime, runId);
    if (receipt.status !== 'IDENTITY_NOT_RESOLVED'
        || receipt.last_error_code !== 'PAGE_NOT_CONNECTED'
        || receipt.retry_count !== 0
        || !receipt.getDataValue('payload_encrypted')
        || receipt.shop_id
        || receipt.meta_channel_id
        || receipt.queue_job_id) {
        refuse('Held receipt assertions failed; preserve state and inspect manually');
    }
    const sink = await readSinkSnapshot();
    return {
        mode: 'inspect-held',
        runId,
        receipt: receiptEvidence(receipt),
        localAlertReceiptCount: sink.receiptCount,
    };
}

async function prepareReplay(runtime, runId) {
    const { shopB } = await loadSyntheticShops(runtime);
    const pageId = pageIdFor(runId);
    const pageRows = await runtime.MetaChannel.findAll({
        where: { meta_asset_id: pageId },
        attributes: ['id'],
        limit: 2,
    });
    if (pageRows.length !== 0) refuse('Refusing replay setup: this synthetic Page already has a channel row');

    const now = new Date();
    const prepared = await runtime.sequelize.transaction(async (transaction) => {
        const receipt = await runtime.MetaWebhookReceipt.findOne({
            where: {
                page_id: pageId,
                event_type: 'optin',
                status: 'IDENTITY_NOT_RESOLVED',
            },
            attributes: [
                'id', 'page_id', 'event_type', 'status', 'shop_id', 'meta_channel_id',
                'queue_job_id', 'payload_encrypted', 'next_retry_at',
            ],
            transaction,
            lock: transaction.LOCK.UPDATE,
        });
        if (!receipt
            || !receipt.getDataValue('payload_encrypted')
            || receipt.shop_id
            || receipt.meta_channel_id
            || receipt.queue_job_id) {
            refuse('Refusing replay setup: the matching held receipt is missing or already bound');
        }

        const existing = await runtime.MetaChannel.findAll({
            where: { meta_asset_id: pageId },
            attributes: ['id'],
            transaction,
            lock: transaction.LOCK.UPDATE,
            limit: 2,
        });
        if (existing.length !== 0) refuse('Refusing replay setup: synthetic Page ownership is ambiguous');

        const channel = await runtime.MetaChannel.create({
            shop_id: shopB.id,
            platform: 'facebook',
            meta_asset_id: pageId,
            display_name: `Closure alert recovery ${runId}`,
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
        }, { transaction });
        const storedToken = channel.getDataValue('page_access_token_ct');
        if (storedToken != null && storedToken !== '') {
            refuse('Refusing replay setup: synthetic channel unexpectedly contains token ciphertext');
        }

        receipt.next_retry_at = new Date(Date.now() - 1);
        await receipt.save({ transaction, fields: ['next_retry_at'] });
        return { receipt, channel };
    });

    return {
        mode: 'prepare-replay',
        runId,
        shop: SHOP_B_CODE,
        receiptId: prepared.receipt.id,
        pageId,
        channelId: prepared.channel.id,
        channelStatus: prepared.channel.status,
        tokenConfigured: false,
        retryMadeDueAt: iso(prepared.receipt.next_retry_at),
    };
}

async function assertOnlyTargetDue(runtime, targetReceipt) {
    const { Op } = require('sequelize');
    const now = new Date();
    const eligibleRows = await runtime.MetaWebhookReceipt.findAll({
        where: {
            [Op.or]: [
                {
                    status: { [Op.in]: require('../../src/modules/integration/meta-webhook-receipt.service').RECOVERABLE_STATUSES },
                    next_retry_at: { [Op.lte]: now },
                },
                {
                    status: 'PROCESSING',
                    updated_at: { [Op.lt]: new Date(now.getTime() - RETRY_CLAIM_STALE_MS) },
                },
                {
                    status: 'RECEIVED',
                    received_at: { [Op.lt]: new Date(now.getTime() - ORPHANED_RECEIVED_MS) },
                },
            ],
        },
        attributes: ['id'],
        limit: 3,
    });
    if (eligibleRows.length !== 1 || String(eligibleRows[0].id) !== String(targetReceipt.id)) {
        refuse('Refusing one-shot reconciliation: the synthetic database has another due receipt');
    }

    // The production job runs a retention sweep after replay. Refuse any
    // database with a receipt older than seven days so that the one-shot local
    // evidence command cannot prune unrelated closure receipts.
    const oldReceiptCount = await runtime.MetaWebhookReceipt.count({
        where: { created_at: { [Op.lt]: new Date(now.getTime() - CONSERVATIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000) } },
    });
    if (oldReceiptCount !== 0) {
        refuse('Refusing one-shot reconciliation: aged receipt evidence could be removed by the job retention sweep');
    }
}

function metricCount(snapshot, name) {
    return Number(snapshot?.[name]?.count || 0);
}

async function reconcile(runtime, runId) {
    const { shopB } = await loadSyntheticShops(runtime);
    const pageId = pageIdFor(runId);
    const senderId = senderIdFor(runId);
    const receipt = await getOnlyReceipt(runtime, runId);
    if (receipt.status !== 'IDENTITY_NOT_RESOLVED'
        || receipt.last_error_code !== 'PAGE_NOT_CONNECTED'
        || !receipt.next_retry_at
        || new Date(receipt.next_retry_at).getTime() > Date.now()
        || !receipt.getDataValue('payload_encrypted')) {
        refuse('Refusing reconciliation: the target receipt is not an eligible held synthetic optin');
    }

    const channel = await runtime.MetaChannel.findOne({
        where: { shop_id: shopB.id, platform: 'facebook', meta_asset_id: pageId, status: 'CONNECTED' },
        attributes: ['id', 'shop_id', 'platform', 'meta_asset_id', 'status', 'page_access_token_ct'],
    });
    const connectedRows = await runtime.MetaChannel.findAll({
        where: { meta_asset_id: pageId, status: 'CONNECTED' },
        attributes: ['id'],
        limit: 2,
    });
    if (!channel || connectedRows.length !== 1 || String(connectedRows[0].id) !== String(channel.id)) {
        refuse('Refusing reconciliation: no unique matching synthetic CONNECTED channel exists');
    }
    if (channel.getDataValue('page_access_token_ct') != null
        && channel.getDataValue('page_access_token_ct') !== '') {
        refuse('Refusing reconciliation: the synthetic channel unexpectedly contains token ciphertext');
    }
    await assertOnlyTargetDue(runtime, receipt);

    const beforeSink = await readSinkSnapshot();
    const metrics = require('../../src/modules/integration/meta-webhook-metrics');
    const beforeMetrics = metrics.getInboundEventMetrics();
    const Reconciler = require('../../src/jobs/webhook-receipt-reconciler.job');
    const result = await new Reconciler().execute({ dryRun: false });
    const afterMetrics = metrics.getInboundEventMetrics();

    const settled = await getOnlyReceipt(runtime, runId);
    const customers = await runtime.entities.Customer.findAll({
        where: {
            shop_id: shopB.id,
            channel_type: 'messenger',
            channel_user_id: senderId,
            meta_channel_id: channel.id,
        },
        attributes: ['id', 'shop_id', 'channel_type', 'channel_user_id', 'meta_channel_id'],
        limit: 2,
    });
    const consentEvents = customers.length === 1
        ? await runtime.entities.MetaChannelConsentEvent.findAll({
            where: {
                shop_id: shopB.id,
                channel_id: channel.id,
                customer_id: customers[0].id,
                event: 'OPT_IN_EXPLICIT',
                source: 'webhook_messaging_optins',
            },
            attributes: ['created_at'],
            limit: 2,
        })
        : [];
    const afterSink = await readSinkSnapshot();
    const recoveryAttemptDelta = metricCount(afterMetrics, 'inbound_recovery_attempt')
        - metricCount(beforeMetrics, 'inbound_recovery_attempt');
    const recoverySuccessDelta = metricCount(afterMetrics, 'inbound_recovery_success')
        - metricCount(beforeMetrics, 'inbound_recovery_success');

    if (result?.claimed !== 1
        || result?.processed !== 1
        || result?.failed !== 0
        || result?.unresolved !== 0
        || result?.skipped !== 0
        || result?.purged !== 0
        || settled.status !== 'PROCESSED'
        || String(settled.shop_id) !== String(shopB.id)
        || String(settled.meta_channel_id) !== String(channel.id)
        || settled.getDataValue('payload_encrypted')
        || settled.queue_job_id
        || !settled.processed_at
        || customers.length !== 1
        || consentEvents.length !== 1
        || recoveryAttemptDelta !== 1
        || recoverySuccessDelta !== 1
        || afterSink.receiptCount !== beforeSink.receiptCount) {
        refuse('Reconciliation assertions failed; preserve the synthetic run state for review');
    }

    return {
        mode: 'reconcile',
        runId,
        shop: SHOP_B_CODE,
        result: {
            claimed: result.claimed,
            processed: result.processed,
            skipped: result.skipped,
            failed: result.failed,
            unresolved: result.unresolved,
            purged: result.purged,
        },
        receipt: receiptEvidence(settled),
        syntheticCustomerCount: customers.length,
        explicitConsentEventCount: consentEvents.length,
        consentEventAt: iso(consentEvents[0].created_at),
        recoveryAttemptDelta,
        recoverySuccessDelta,
        queueJobIdPresent: Boolean(settled.queue_job_id),
        alertCountUnchangedDuringReplay: true,
        senderIdWithheld: true,
        eventBodyWithheld: true,
    };
}

async function inspectRecovered(runtime, runId) {
    const { shopB } = await loadSyntheticShops(runtime);
    const receipt = await getOnlyReceipt(runtime, runId);
    const channel = await runtime.MetaChannel.findOne({
        where: { shop_id: shopB.id, platform: 'facebook', meta_asset_id: pageIdFor(runId) },
        attributes: ['id', 'status', 'page_access_token_ct'],
    });
    const customers = channel
        ? await runtime.entities.Customer.findAll({
            where: {
                shop_id: shopB.id,
                channel_type: 'messenger',
                channel_user_id: senderIdFor(runId),
                meta_channel_id: channel.id,
            },
            attributes: ['id'],
            limit: 2,
        })
        : [];
    const consentCount = channel && customers.length === 1
        ? await runtime.entities.MetaChannelConsentEvent.count({
            where: {
                shop_id: shopB.id,
                channel_id: channel.id,
                customer_id: customers[0].id,
                event: 'OPT_IN_EXPLICIT',
                source: 'webhook_messaging_optins',
            },
        })
        : 0;
    if (receipt.status !== 'PROCESSED' || !receipt.processed_at || receipt.getDataValue('payload_encrypted')) {
        refuse('Recovered receipt assertions failed');
    }
    return {
        mode: 'inspect-recovered',
        runId,
        receipt: receiptEvidence(receipt),
        channelStatus: channel?.status || null,
        tokenConfigured: Boolean(channel?.getDataValue('page_access_token_ct')),
        syntheticCustomerCount: customers.length,
        explicitConsentEventCount: consentCount,
    };
}

async function cleanup(runtime, runId) {
    const { shopB } = await loadSyntheticShops(runtime);
    const pageId = pageIdFor(runId);
    const senderId = senderIdFor(runId);

    return runtime.sequelize.transaction(async (transaction) => {
        const receipt = await runtime.MetaWebhookReceipt.findOne({
            where: { page_id: pageId, event_type: 'optin' },
            attributes: ['id', 'page_id', 'event_type', 'status', 'payload_encrypted'],
            transaction,
            lock: transaction.LOCK.UPDATE,
        });
        if (!receipt || receipt.status !== 'PROCESSED' || receipt.getDataValue('payload_encrypted')) {
            refuse('Refusing cleanup until the synthetic receipt is terminal and its replay body is cleared');
        }
        const pageRows = await runtime.MetaChannel.findAll({
            where: { meta_asset_id: pageId },
            attributes: ['id', 'shop_id', 'platform', 'meta_asset_id', 'status', 'page_access_token_ct'],
            transaction,
            lock: transaction.LOCK.UPDATE,
            limit: 2,
        });
        if (pageRows.length !== 1
            || String(pageRows[0].shop_id) !== String(shopB.id)
            || pageRows[0].platform !== 'facebook') {
            refuse('Refusing cleanup: synthetic Page ownership is missing or ambiguous');
        }
        const channel = pageRows[0];
        if (channel.getDataValue('page_access_token_ct') != null
            && channel.getDataValue('page_access_token_ct') !== '') {
            refuse('Refusing cleanup: synthetic channel unexpectedly contains token ciphertext');
        }
        const conversations = await runtime.entities.Conversation.findAll({
            where: { meta_channel_id: channel.id },
            attributes: ['id'],
            transaction,
            limit: 1,
        });
        if (conversations.length !== 0) {
            refuse('Refusing cleanup: a conversation is linked to the synthetic channel');
        }

        const customers = await runtime.entities.Customer.findAll({
            where: {
                shop_id: shopB.id,
                channel_type: 'messenger',
                channel_user_id: senderId,
            },
            attributes: ['id', 'meta_channel_id'],
            transaction,
            lock: transaction.LOCK.UPDATE,
            limit: 2,
        });
        if (customers.length > 1 || customers.some((customer) => (
            customer.meta_channel_id && String(customer.meta_channel_id) !== String(channel.id)
        ))) {
            refuse('Refusing cleanup: synthetic sender ownership is ambiguous');
        }
        const linkedCustomers = customers.filter((customer) => String(customer.meta_channel_id || '') === String(channel.id));
        for (const customer of linkedCustomers) {
            await customer.update({ meta_channel_id: null }, { transaction });
        }
        await channel.update({
            page_access_token_ct: null,
            status: 'DISCONNECTED',
            disconnected_at: new Date(),
            last_error: null,
        }, { transaction });

        return {
            mode: 'cleanup',
            runId,
            pageId,
            channelStatus: 'DISCONNECTED',
            tokenConfigured: false,
            detachedSyntheticCustomerLinks: linkedCustomers.length,
            receiptRetained: true,
            receiptStatus: receipt.status,
            consentAuditRetained: true,
        };
    });
}

async function run() {
    const [command, ...args] = process.argv.slice(2);
    const commandNeedsRunId = new Set([
        'post', 'inspect-held', 'prepare-replay', 'reconcile', 'inspect-recovered', 'cleanup',
    ]);
    const validCommands = new Set(['preflight', ...commandNeedsRunId]);
    if (!validCommands.has(command)) {
        refuse('Command must be preflight, post, inspect-held, prepare-replay, reconcile, inspect-recovered, or cleanup');
    }
    if (command === 'preflight' ? args.length !== 0 : args.length !== 1) {
        refuse(command === 'preflight' ? 'preflight takes no arguments' : `${command} requires exactly one run-id`);
    }
    const runId = commandNeedsRunId.has(command) ? parseRunId(args[0]) : null;
    const needsStoppedWorker = new Set(['post', 'inspect-held', 'prepare-replay', 'reconcile', 'inspect-recovered', 'cleanup']);
    assertTarget({ requireWorkerStopped: needsStoppedWorker.has(command) });

    let runtime;
    try {
        runtime = await openRuntime();
        let result;
        if (command === 'preflight') result = await preflight(runtime);
        else if (command === 'post') result = await postIncident(runtime, runId);
        else if (command === 'inspect-held') result = await inspectHeld(runtime, runId);
        else if (command === 'prepare-replay') result = await prepareReplay(runtime, runId);
        else if (command === 'reconcile') result = await reconcile(runtime, runId);
        else if (command === 'inspect-recovered') result = await inspectRecovered(runtime, runId);
        else result = await cleanup(runtime, runId);
        process.stdout.write(`${JSON.stringify(result)}\n`);
    } finally {
        await closeRuntime(runtime);
    }
}

run().catch((error) => {
    const safeMessage = error instanceof HarnessError
        ? error.message
        : 'Unexpected local failure; no diagnostic details emitted. Preserve the synthetic run state before retrying.';
    process.stderr.write(`${JSON.stringify({ error: 'ALERT_RECOVERY_REHEARSAL_FAILED', message: safeMessage })}\n`);
    process.exitCode = 1;
});
