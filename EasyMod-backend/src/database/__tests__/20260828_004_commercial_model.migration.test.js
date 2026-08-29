'use strict';

const migration = require('../migrations/20260828_004_commercial_model');

const makeSequelize = () => {
    const queries = [];
    return {
        sequelize: {
            getDialect: () => 'postgres',
            query: jest.fn(async (sql) => {
                queries.push(sql);
                return [[], { rowCount: 0 }];
            }),
        },
        queries,
    };
};

describe('commercial model migration', () => {
    it('is additive, ordered, and maps legacy subscription states safely', async () => {
        const { sequelize, queries } = makeSequelize();

        await migration.up(sequelize);

        const sql = queries.join('\n');
        expect(sql).toMatch(/ALTER TABLE subscriptions ALTER COLUMN conversations_limit SET DEFAULT 100/);
        expect(sql).toMatch(/trialing', 'trial_expired/);
        expect(sql).toMatch(/status = 'active'/);
        expect(sql).toMatch(/plan_code = 'SHURU'/);
        expect(sql).toMatch(/UPPER\(COALESCE\(plan_code, ''\)\) <> 'PARTNER'/);
        expect(sql).toMatch(/SET conversations_limit = 500/);
        expect(sql).toMatch(/'active', 'past_due', 'suspended'/);
        expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ/);
        expect(sql).toMatch(/idx_orders_shop_delivered_at/);
        expect(sql).toMatch(/delivered_at = updated_at/);
        expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS payment_id/);
        expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS metadata/);
        expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS partner_billing_adjustments/);
        expect(sql).toMatch(/idx_topup_bkash_payment/);
        expect(sql).toMatch(/idx_topup_bkash_trx/);
        expect(sql).toMatch(/idx_topup_shop_idempotency/);
        expect(sql).toMatch(/idx_invoices_payment_id/);
        expect(sql).toMatch(/idx_invoices_recurring_period/);

        const growthUpdate = queries.findIndex((query) => query.includes('SET conversations_limit = 500'));
        const cancelledUpdate = queries.findIndex((query) => query.includes("'cancelled', 'inactive'"));
        expect(growthUpdate).toBeGreaterThan(-1);
        expect(cancelledUpdate).toBeGreaterThan(growthUpdate);
    });

    it('can be safely re-applied and has a forward-only data rollback', async () => {
        const { sequelize, queries } = makeSequelize();

        await migration.up(sequelize);
        await migration.up(sequelize);
        await migration.down(sequelize);

        const sql = queries.join('\n');
        expect(sql).toMatch(/SET DEFAULT 300/);
        expect(sql).toMatch(/DROP INDEX IF EXISTS idx_orders_shop_delivered_at/);
        expect(sql).toMatch(/DROP COLUMN IF EXISTS delivered_at/);
        expect(sql).toMatch(/DROP COLUMN IF EXISTS payment_id/);
        expect(sql).toMatch(/DROP COLUMN IF EXISTS metadata/);
        expect(sql).toMatch(/DROP TABLE IF EXISTS partner_billing_adjustments/);
        expect(sql).toMatch(/DROP INDEX IF EXISTS idx_topup_bkash_payment/);
        expect(sql).toMatch(/DROP INDEX IF EXISTS idx_topup_bkash_trx/);
        expect(sql).toMatch(/DROP INDEX IF EXISTS idx_topup_shop_idempotency/);
        expect(sql).toMatch(/DROP COLUMN IF EXISTS idempotency_key/);
        expect(sql).toMatch(/DROP COLUMN IF EXISTS bkash_url/);
        expect(sql).toMatch(/DROP INDEX IF EXISTS idx_invoices_payment_id/);
        expect(sql).toMatch(/DROP INDEX IF EXISTS idx_invoices_recurring_period/);
    });
});
