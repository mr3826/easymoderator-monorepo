'use strict';

const { sequelize } = require('../../utils/database/database-setup');
const repair = require('../migrations/20260901_001_reconcile_commercial_entity_drift');
const { randomUUID } = require('crypto');

let fixtureId;
let fixtureShopId;
let fixtureTenantId;

describe('commercial entity drift repair on PostgreSQL', () => {
    beforeAll(async () => {
        await sequelize.query(`
            ALTER TABLE public.orders DROP COLUMN IF EXISTS metadata;
            ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS threshold_debt;
            ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS usage_reset_at;
        `);
        await repair.up(sequelize);

        fixtureTenantId = randomUUID();
        fixtureShopId = randomUUID();
        fixtureId = randomUUID();
        await sequelize.query(
            `INSERT INTO public.tenants (id, name) VALUES (:tenantId, 'schema-drift-test-tenant')`,
            { replacements: { tenantId: fixtureTenantId } },
        );
        await sequelize.query(
            `INSERT INTO public.shops (id, unique_code, tenant_id, shop_name, name)
             VALUES (:shopId, :uniqueCode, :tenantId, 'schema-drift-test-shop', 'schema-drift-test-shop')`,
            { replacements: { shopId: fixtureShopId, uniqueCode: `drift-${process.pid}`, tenantId: fixtureTenantId } },
        );
        await sequelize.query(
            `INSERT INTO public.subscriptions (id, shop_id, current_period_end, next_billing_date)
             VALUES (:id, :shopId, NOW() + INTERVAL '30 days', NOW() + INTERVAL '30 days')`,
            { replacements: { id: fixtureId, shopId: fixtureShopId } },
        );
        const [[fixture]] = await sequelize.query(`
            SELECT id, threshold_conversations
              FROM public.subscriptions
             WHERE id = :id
        `, { replacements: { id: fixtureId } });
        expect(fixture).toBeDefined();
        await sequelize.query(
            'UPDATE public.subscriptions SET threshold_conversations = 7 WHERE id = :id',
            { replacements: { id: fixtureId } },
        );
    });

    afterAll(async () => {
        if (fixtureId) {
            await sequelize.query('DELETE FROM public.subscriptions WHERE id = :id', { replacements: { id: fixtureId } });
            await sequelize.query('DELETE FROM public.shops WHERE id = :id', { replacements: { id: fixtureShopId } });
            await sequelize.query('DELETE FROM public.tenants WHERE id = :id', { replacements: { id: fixtureTenantId } });
        }
        await repair.up(sequelize);
        await sequelize.close();
    });

    test('restores exact definitions without translating the grace buffer', async () => {
        const [columns] = await sequelize.query(`
            SELECT table_name, column_name, data_type, is_nullable, column_default
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND ((table_name = 'orders' AND column_name = 'metadata')
                 OR (table_name = 'subscriptions' AND column_name IN ('threshold_debt', 'usage_reset_at')))
        `);
        const byKey = new Map(columns.map((row) => [`${row.table_name}.${row.column_name}`, row]));
        expect(byKey.get('orders.metadata')).toMatchObject({
            data_type: 'jsonb', is_nullable: 'YES', column_default: expect.stringContaining("'{}'::jsonb"),
        });
        expect(byKey.get('subscriptions.threshold_debt')).toMatchObject({
            data_type: 'integer', is_nullable: 'NO', column_default: expect.stringMatching(/\b0\b/),
        });
        expect(byKey.get('subscriptions.usage_reset_at')).toMatchObject({
            data_type: 'timestamp with time zone', is_nullable: 'YES',
        });

        const [[subscription]] = await sequelize.query(
            'SELECT threshold_conversations, threshold_debt FROM public.subscriptions WHERE id = :id',
            { replacements: { id: fixtureId } },
        );
        expect(subscription.threshold_conversations).toBe(7);
        expect(subscription.threshold_debt).toBe(0);
    });

    test('rerun preserves an intentional debt value', async () => {
        await sequelize.query(
            'UPDATE public.subscriptions SET threshold_debt = 11 WHERE id = :id',
            { replacements: { id: fixtureId } },
        );
        await repair.up(sequelize);
        const [[subscription]] = await sequelize.query(
            'SELECT threshold_debt FROM public.subscriptions WHERE id = :id',
            { replacements: { id: fixtureId } },
        );
        expect(subscription.threshold_debt).toBe(11);
    });
});
