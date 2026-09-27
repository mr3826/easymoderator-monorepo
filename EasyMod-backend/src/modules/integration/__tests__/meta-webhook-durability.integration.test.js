'use strict';

/**
 * Provider-shaped durable acceptance test.
 *
 * This suite uses the disposable PostgreSQL/Redis harness. It intentionally
 * flushes only the dedicated Redis queue database after the provider receives
 * a 200, then proves the database receipt and encrypted replay body reconstruct
 * the queue work without duplicating the stored customer message.
 */

process.env.META_APP_SECRET = 'integration-meta-app-secret';
process.env.META_WEBHOOK_APP_SECRET = 'integration-meta-app-secret';

const crypto = require('crypto');
const request = require('supertest');
const express = require('express');
const Redis = require('ioredis');
const { Worker } = require('bullmq');

const {
    IDS,
    syncSchema,
    truncateAll,
    seed,
} = require('../../../../tests/meta-e2e/fixtures');
const { sequelize } = require('../../../utils/database/database-setup');
const { Message } = require('../../conversation/conversation.entity');
const MetaWebhookReceipt = require('../meta-webhook-receipt.entity');
const receiptService = require('../meta-webhook-receipt.service');
const WebhookReceiptReconcilerJob = require('../../../jobs/webhook-receipt-reconciler.job');
const { messageQueue, connection } = require('../../../jobs/message-queue');
const { _private: workerPrivate } = require('../../../jobs/message-worker');

const APP_SECRET = 'integration-meta-app-secret';
const EVENT_ID = 'mid.integration.redis-recovery.1';
const SENDER_ID = '7000000000000999';

const buildPayload = (eventId = EVENT_ID) => ({
    object: 'page',
    entry: [{
        id: IDS.pageA,
        messaging: [{
            sender: { id: SENDER_ID },
            recipient: { id: IDS.pageA },
            timestamp: 1_800_000_000_000,
            message: { mid: eventId, text: 'Durability integration message' },
        }],
    }],
});

const signedPost = (app, payload) => {
    const body = Buffer.from(JSON.stringify(payload));
    const signature = `sha256=${crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
    return request(app)
        .post('/webhooks/meta')
        .set('Content-Type', 'application/octet-stream')
        .set('x-hub-signature-256', signature)
        .send(body);
};

describe('Meta webhook durable replay with real PostgreSQL and Redis', () => {
    let app;
    let queueRedis;
    let testWorker;

    beforeAll(async () => {
        await syncSchema();
        await seed();

        const router = require('../meta-webhook.routes');
        app = express();
        app.use('/webhooks/meta', router);

        queueRedis = new Redis({ ...connection });
        await queueRedis.flushdb();
    });

    afterAll(async () => {
        if (queueRedis) {
            await queueRedis.flushdb().catch(() => {});
            await queueRedis.quit().catch(() => {});
        }
        await testWorker?.close().catch(() => {});
        await messageQueue.close().catch(() => {});
        if (app) await truncateAll().catch(() => {});
        await sequelize.close().catch(() => {});
    });

    test('replays accepted work after queue data loss without duplicating the inbound message', async () => {
        const response = await signedPost(app, buildPayload());
        expect(response.status).toBe(200);

        const firstReceipt = await MetaWebhookReceipt.findOne({ where: { event_id: EVENT_ID } });
        expect(firstReceipt).toEqual(expect.objectContaining({
            status: 'QUEUED',
            page_id: IDS.pageA,
        }));
        expect(firstReceipt.payload_encrypted).toMatch(/^v1:/);
        expect(firstReceipt.queue_job_id).toBeTruthy();

        const originalJobId = firstReceipt.queue_job_id;
        await queueRedis.flushdb();
        await firstReceipt.update({ next_retry_at: new Date(Date.now() - 1000) });

        const recovery = await new WebhookReceiptReconcilerJob().execute();
        expect(recovery.processed).toBe(1);

        const recoveredReceipt = await MetaWebhookReceipt.findByPk(firstReceipt.id);
        expect(recoveredReceipt.status).toBe('QUEUED');
        expect(recoveredReceipt.payload_encrypted).toMatch(/^v1:/);
        expect(recoveredReceipt.queue_job_id).toBeTruthy();
        expect(recoveredReceipt.queue_job_id).not.toBe(originalJobId);

        const storedMessages = await Message.count({ where: { external_id: EVENT_ID } });
        expect(storedMessages).toBe(1);

        const recoveredJob = await messageQueue.getJob(recoveredReceipt.queue_job_id);
        expect(recoveredJob.data.receiptIds).toContain(firstReceipt.id);

        let completion;
        const completed = new Promise((resolve, reject) => {
            completion = { resolve, reject };
        });
        testWorker = new Worker('message-processing', async () => ({ recovered: true }), {
            connection: { ...connection },
        });
        testWorker.on('completed', async (job) => {
            try {
                await workerPrivate.settleInboundReceipts(job);
                completion.resolve();
            } catch (error) {
                completion.reject(error);
            }
        });
        testWorker.on('failed', (_job, error) => completion.reject(error));
        await recoveredJob.changeDelay(0);
        await completion;

        const settledReceipt = await MetaWebhookReceipt.findByPk(firstReceipt.id);
        expect(settledReceipt.status).toBe('PROCESSED');
        expect(settledReceipt.payload_encrypted).toBeNull();
        expect(settledReceipt.queue_job_id).toBeNull();
    });

    test('recovery claims and fences only one due durable receipt', async () => {
        const payload = buildPayload('mid.integration.redis-recovery.2');
        const { receipt } = await receiptService.recordReceipt({
            pageId: IDS.pageA,
            messaging: payload.entry[0].messaging[0],
        });
        await receipt.update({
            status: 'RETRY_PENDING',
            next_retry_at: new Date(Date.now() - 1000),
        });

        const [firstClaim, secondClaim] = await Promise.all([
            receiptService.claimDueReceipts(1),
            receiptService.claimDueReceipts(1),
        ]);

        expect(firstClaim.length + secondClaim.length).toBe(1);
        const claimed = firstClaim[0] || secondClaim[0];
        expect(claimed.receipt.processing_token).toBeTruthy();
    });
});
