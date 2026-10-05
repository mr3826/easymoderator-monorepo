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
        await sequelize.query(`
            CREATE OR REPLACE FUNCTION preserve_meta_webhook_replay_payload()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                IF NEW.status = 'QUEUED'
                   AND OLD.payload_encrypted IS NOT NULL
                   AND NEW.payload_encrypted IS NULL THEN
                    NEW.payload_encrypted := OLD.payload_encrypted;
                    NEW.processed_at := NULL;
                    NEW.next_retry_at := NOW() + INTERVAL '15 minutes';
                END IF;
                RETURN NEW;
            END;
            $$
        `);
        await sequelize.query(`
            DROP TRIGGER IF EXISTS preserve_meta_webhook_replay_payload
            ON meta_webhook_receipts
        `);
        await sequelize.query(`
            CREATE TRIGGER preserve_meta_webhook_replay_payload
            BEFORE UPDATE ON meta_webhook_receipts
            FOR EACH ROW
            EXECUTE FUNCTION preserve_meta_webhook_replay_payload()
        `);
        console.log('[migration] 20260927_001_meta_webhook_queue_recovery: UP complete');
    },

    down: async (sequelize) => {
        await sequelize.query(`
            ALTER TABLE meta_webhook_receipts
            DROP COLUMN IF EXISTS queue_job_id
        `);
        await sequelize.query('DROP TRIGGER IF EXISTS preserve_meta_webhook_replay_payload ON meta_webhook_receipts');
        await sequelize.query('DROP FUNCTION IF EXISTS preserve_meta_webhook_replay_payload()');
        console.log('[migration] 20260927_001_meta_webhook_queue_recovery: DOWN complete');
    },
};
