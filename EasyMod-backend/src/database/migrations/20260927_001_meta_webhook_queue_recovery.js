'use strict';

/**
 * Keep the BullMQ identity beside a durable webhook receipt until the worker
 * confirms completion. This lets the reconciler distinguish a live queue job
 * from a job lost during Redis recovery.
 */
module.exports = {
    name: '20260927_001_meta_webhook_queue_recovery',

    up: async (sequelize) => {
        await sequelize.query(`
            ALTER TABLE meta_webhook_receipts
            ADD COLUMN IF NOT EXISTS queue_job_id VARCHAR(191)
        `);
        console.log('[migration] 20260927_001_meta_webhook_queue_recovery: UP complete');
    },

    down: async (sequelize) => {
        await sequelize.query(`
            ALTER TABLE meta_webhook_receipts
            DROP COLUMN IF EXISTS queue_job_id
        `);
        console.log('[migration] 20260927_001_meta_webhook_queue_recovery: DOWN complete');
    },
};
