'use strict';

/**
 * Migration: Add conversation_usage and topup_transactions tables
 *
 * conversation_usage: Per-conversation log used for billing, analytics, and threshold checks.
 * topup_transactions: Tracks BKash top-up purchases of extra conversation packs.
 */

module.exports = {
    name: '20260510_002_add_topup_and_conversation_log',

    up: async (sequelize) => {
        // conversation_usage: one row per conversation counted against the limit
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS conversation_usage (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id UUID NOT NULL,
                conversation_id TEXT NOT NULL,
                channel TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'package',
                counted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                billing_period TEXT NOT NULL,
                CONSTRAINT fk_conv_usage_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
            )
        `);

        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_conv_usage_shop_period
            ON conversation_usage(shop_id, billing_period)
        `);

        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_usage_unique
            ON conversation_usage(shop_id, conversation_id, billing_period)
        `);

        console.log('  ✓ Created conversation_usage table');

        // topup_transactions: tracks purchased conversation packs
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS topup_transactions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id UUID NOT NULL,
                pack_code TEXT NOT NULL,
                pack_conversations INTEGER NOT NULL,
                amount_bdt DECIMAL(10,2) NOT NULL,
                bkash_payment_id TEXT,
                bkash_trx_id TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                invoice_number TEXT,
                invoice_pdf_url TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMPTZ,
                CONSTRAINT fk_topup_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
            )
        `);

        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_topup_shop_status
            ON topup_transactions(shop_id, status)
        `);

        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_topup_bkash_trx
            ON topup_transactions(bkash_trx_id)
            WHERE bkash_trx_id IS NOT NULL
        `);

        console.log('  ✓ Created topup_transactions table');
    },

    down: async (sequelize) => {
        await sequelize.query(`DROP TABLE IF EXISTS topup_transactions`);
        await sequelize.query(`DROP TABLE IF EXISTS conversation_usage`);
        console.log('  ✓ Dropped topup_transactions and conversation_usage tables');
    }
};
