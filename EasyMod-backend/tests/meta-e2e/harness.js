'use strict';

/**
 * Meta-shaped E2E harness.
 *
 * `deliver()` puts a signed, Meta-shaped `messages` webhook into the REAL
 * webhook route and returns everything the pipeline produced downstream:
 *
 *     signed webhook  →  meta-webhook.routes (HMAC, rate limit, dispatcher)
 *                     →  meta-webhook-events.handler (receipt, dedup, consent)
 *                     →  Redis / BullMQ  (real queue, real job payload)
 *                     →  message-worker.processMessageJob (real guard chain)
 *                     →  intent-router  (real shop-scoped catalog + FAQ reads)
 *                     →  llm.service    (real provider chain; wire response scripted)
 *                     →  outbound grounding gate (real, unmocked)
 *                     →  policy engine  (real)
 *                     →  MetaMessengerProvider.sendMessage (real)
 *                     →  Graph transport CAPTURE          ← the only Meta stub
 *
 * Queue boundary: the worker is invoked by draining the jobs the webhook really
 * enqueued in Redis, rather than by racing a live BullMQ Worker process. The
 * job payload, the queue round-trip and the worker handler are all real; what
 * this does not cover is BullMQ's own scheduler timing, which
 * pipeline-canary.job.js already probes in production.
 * ponytail: drain-and-invoke, swap for a live Worker if scheduler regressions
 * ever become the failure mode.
 */

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const grounding = require('../../src/modules/ai/grounding');
const transport = require('./transport');
const fixtures = require('./fixtures');

const WEBHOOK_PATH = '/api/webhooks/meta';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── App under test ───────────────────────────────────────────────────────────

/**
 * The real webhook router, at the real mount path, with no body parser in front
 * of it — the same shape as src/app.js, which deliberately mounts this router
 * above express.json() so the raw body survives for HMAC verification.
 */
const buildWebhookApp = () => {
    const app = express();
    app.use(WEBHOOK_PATH, require('../../src/modules/integration/meta-webhook.routes'));
    return app;
};

let app = null;
const webhookApp = () => (app || (app = buildWebhookApp()));

// ── Meta payload construction ────────────────────────────────────────────────

let midSeq = 0;

/** A Meta `page` webhook envelope carrying one inbound Messenger text message. */
const messagePayload = ({ pageId, psid, text, mid, attachments }) => ({
    object: 'page',
    entry: [{
        id: String(pageId),
        time: Date.now(),
        messaging: [{
            sender: { id: String(psid) },
            recipient: { id: String(pageId) },
            timestamp: Date.now(),
            message: {
                mid: mid || `m_e2e_${++midSeq}_${Date.now()}`,
                ...(text === undefined ? {} : { text }),
                ...(attachments ? { attachments } : {}),
            },
        }],
    }],
});

const sign = (raw) => 'sha256=' + crypto
    .createHmac('sha256', process.env.META_APP_SECRET)
    .update(raw)
    .digest('hex');

/**
 * POST a Meta-shaped webhook. `signature` overrides the computed one so tests
 * can prove an unsigned or wrongly-signed payload is rejected.
 */
const postWebhook = async (payload, { signature } = {}) => {
    const raw = JSON.stringify(payload);
    return request(webhookApp())
        .post(WEBHOOK_PATH)
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature === undefined ? sign(raw) : signature)
        .send(raw);
};

// ── Queue drain → worker ─────────────────────────────────────────────────────

const QUEUE_STATES = ['waiting', 'delayed', 'prioritized', 'paused'];

/** Jobs the webhook enqueued, as BullMQ sees them. Used to assert the queue hop. */
const pendingJobs = async () => {
    const { messageQueue } = require('../../src/jobs/message-queue');
    return messageQueue.getJobs(QUEUE_STATES, 0, -1);
};

/**
 * Wait for the queue to reach `count` jobs.
 *
 * The webhook handler dispatches without awaiting — acknowledging Meta must not
 * wait on Redis — so "the job is enqueued" is observable a tick later, not on
 * the HTTP response. Returns whatever is queued when the deadline passes so the
 * caller's own assertion produces the failure message.
 */
const waitForJobs = async (count = 1, { timeoutMs = 8000 } = {}) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const jobs = await pendingJobs();
        if (jobs.length >= count || Date.now() > deadline) return jobs;
        await sleep(25);
    }
};

/**
 * Run every queued job through the real worker handler, oldest first.
 * The webhook dispatches its job without awaiting, so this polls briefly for
 * the first job to appear rather than assuming it is already there.
 */
const drainQueue = async ({ timeoutMs = 8000 } = {}) => {
    const { processMessageJob } = require('../../src/jobs/message-worker');
    const results = [];
    const deadline = Date.now() + timeoutMs;

    for (;;) {
        const jobs = await pendingJobs();
        if (!jobs.length) {
            if (results.length || Date.now() > deadline) break;
            await sleep(25);
            continue;
        }
        jobs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        for (const job of jobs) {
            results.push(await processMessageJob(job));
            await job.remove().catch(() => { /* already gone */ });
        }
    }
    return results;
};

// ── Grounding observation ────────────────────────────────────────────────────
//
// The gate itself is never mocked. This wraps the decision LOG so a test can
// read the correlation record the worker really emitted — decision, reasonCode,
// productStatus, mediaStatus, verifiedProductIds, mediaProductId, knowledgeIds,
// violations, provider — which is the internal evidence the trust boundary
// document says every reply must carry.

let groundingDecisions = [];
let restoreGroundingObserver = null;

const installGroundingObserver = () => {
    const real = grounding.logGroundingDecision;
    grounding.logGroundingDecision = (params) => {
        const payload = real(params);
        groundingDecisions.push(payload);
        return payload;
    };
    restoreGroundingObserver = () => { grounding.logGroundingDecision = real; };
};

/** Every grounding decision emitted so far, oldest first. */
const decisions = () => [...groundingDecisions];

/** The decision for the most recent turn. */
const lastDecision = () => groundingDecisions[groundingDecisions.length - 1] || null;

// ── Persisted state ──────────────────────────────────────────────────────────

const conversationFor = async (shopId) => {
    const { Conversation } = require('../../src/modules/conversation/conversation.entity');
    return Conversation.findOne({ where: { shop_id: shopId }, order: [['created_at', 'DESC']] });
};

const messagesFor = async (conversationId) => {
    const { Message } = require('../../src/modules/conversation/conversation.entity');
    return Message.findAll({ where: { conversation_id: conversationId }, order: [['created_at', 'ASC']] });
};

/**
 * The AI reply row stored for the most recent turn, with its grounding stamps.
 *
 * Prefers the newest AI row that actually carries a grounding decision: on a
 * handoff the worker also stores EasyModerator's templated holding message,
 * which is written copy and carries no grounding metadata.
 */
const lastStoredAiMessage = async (shopId) => {
    const conversation = await conversationFor(shopId);
    if (!conversation) return null;
    const aiRows = (await messagesFor(conversation.id)).filter((m) => m.sender === 'ai').reverse();
    return aiRows.find((m) => m.metadata?.grounding_decision) || aiRows[0] || null;
};

/**
 * Insert an assistant turn directly into a conversation — used to reproduce an
 * earlier ungrounded statement and prove it cannot become evidence.
 */
const injectAssistantMessage = async (conversationId, content, sourceReferences = null) => {
    const { Message } = require('../../src/modules/conversation/conversation.entity');
    return Message.create({
        conversation_id: conversationId,
        content,
        sender: 'ai',
        external_id: null,
        source_references: sourceReferences,
        metadata: { type: 'ai_response', injected_by: 'meta-e2e' },
    });
};

// ── The main entry point ─────────────────────────────────────────────────────

/**
 * Deliver one customer message end to end.
 *
 * @param {object}  params
 * @param {string}  params.text        - the customer's message
 * @param {string} [params.candidate]  - scripted model output for this turn
 *                                       (string, Error, or per-provider map)
 * @param {string} [params.pageId]     - defaults to the Shop A tester Page
 * @param {string} [params.psid]       - defaults to the E2E customer PSID
 * @param {string} [params.mid]        - Meta message id, for redelivery tests
 * @returns {Promise<{status:number, jobResults:object[], sends:object[],
 *                    decision:object|null}>}
 */
const deliver = async ({
    text,
    candidate,
    pageId = fixtures.IDS.pageA,
    psid = fixtures.CUSTOMER_PSID,
    mid,
    attachments,
} = {}) => {
    if (candidate !== undefined) transport.setCandidate(candidate);

    const sendsBefore = transport.capturedSends().length;
    const decisionsBefore = groundingDecisions.length;

    const response = await postWebhook(messagePayload({ pageId, psid, text, mid, attachments }));
    const jobResults = await drainQueue();

    // Scoped to THIS delivery: a turn that produced no grounding decision must
    // report null rather than silently re-asserting the previous turn's.
    const turnDecisions = groundingDecisions.slice(decisionsBefore);

    return {
        status: response.status,
        jobResults,
        sends: transport.capturedSends().slice(sendsBefore),
        decision: turnDecisions[turnDecisions.length - 1] || null,
        decisions: turnDecisions,
    };
};

// ── Assertion helpers ────────────────────────────────────────────────────────

/** Text bodies in the captured Graph sends. */
const sentTexts = (sends) => sends.map((b) => b?.message?.text).filter(Boolean);

/** Attachment payloads in the captured Graph sends. */
const sentAttachments = (sends) => sends
    .map((b) => b?.message?.attachment)
    .filter(Boolean);

/** Every attachment URL that would have reached Meta. */
const sentAttachmentUrls = (sends) => sentAttachments(sends)
    .map((a) => a?.payload?.url)
    .filter(Boolean);

/** The concatenation of everything the customer would have received. */
const sentBody = (sends) => [
    ...sentTexts(sends),
    ...sentAttachmentUrls(sends),
].join('\n');

// ── Lifecycle ────────────────────────────────────────────────────────────────

let restoreMeta = null;
let restoreLlm = null;

const setupSuite = async () => {
    restoreMeta = transport.installMetaTransport();
    restoreLlm = transport.installLlmTransport();
    installGroundingObserver();
    await fixtures.syncSchema();
};

/** Wipe every store the pipeline touches so each scenario starts from zero. */
const resetRun = async () => {
    const { cacheRedis, rateLimitRedis } = require('../../src/config/redis');
    const { messageQueue } = require('../../src/jobs/message-queue');

    await fixtures.truncateAll();
    await fixtures.seed();

    // Dedup keys, burst bookkeeping, AI pause flags and the LLM circuit-breaker
    // state all live in Redis and would otherwise leak between scenarios. The
    // webhook rate-limit bucket is cleared too so a long suite cannot 429 itself.
    await cacheRedis.flushdb();
    await rateLimitRedis.flushdb().catch(() => { /* memory fallback */ });
    await messageQueue.obliterate({ force: true }).catch(() => { /* empty queue */ });

    transport.resetTransports();
    groundingDecisions = [];
};

const teardownSuite = async () => {
    const { sequelize } = require('../../src/utils/database/database-setup');
    const { messageQueue } = require('../../src/jobs/message-queue');
    const redis = require('../../src/config/redis');

    if (restoreGroundingObserver) restoreGroundingObserver();
    if (restoreMeta) restoreMeta();
    if (restoreLlm) restoreLlm();

    await messageQueue.close().catch(() => {});
    await sequelize.close().catch(() => {});
    if (typeof redis.closeAllRedis === 'function') await redis.closeAllRedis().catch(() => {});
};

module.exports = {
    // pipeline
    deliver,
    postWebhook,
    messagePayload,
    sign,
    drainQueue,
    pendingJobs,
    waitForJobs,
    // evidence
    decisions,
    lastDecision,
    lastStoredAiMessage,
    conversationFor,
    messagesFor,
    injectAssistantMessage,
    // captured outbound
    sentTexts,
    sentAttachments,
    sentAttachmentUrls,
    sentBody,
    // lifecycle
    setupSuite,
    resetRun,
    teardownSuite,
    WEBHOOK_PATH,
};
