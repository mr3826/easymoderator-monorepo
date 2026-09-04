'use strict';

const migration = require('../migrations/20260904_001_inbox_message_delivery_state');

const makeSequelize = () => {
    const queries = [];
    return {
        sequelize: {
            query: jest.fn(async (sql) => {
                queries.push(sql);
                return [[], { rowCount: 0 }];
            }),
        },
        queries,
    };
};

describe('20260904_001_inbox_message_delivery_state', () => {
    it('adds lifecycle fields, page-scoped customer identity, and safe provider indexes', async () => {
        const { sequelize, queries } = makeSequelize();

        await migration.up(sequelize);

        const sql = queries.join('\n');
        expect(migration.name).toBe('20260904_001_inbox_message_delivery_state');
        expect(sql).toMatch(/ALTER TABLE customers/);
        expect(sql).toMatch(/meta_channel_id UUID/);
        expect(sql).toMatch(/delivery_state VARCHAR\(32\)/);
        expect(sql).toMatch(/provider_message_id VARCHAR\(255\)/);
        expect(sql).toMatch(/send_idempotency_key VARCHAR\(128\)/);
        expect(sql).toMatch(/delivery_status.*pending/s);
        expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS messages_external_id_key/);
        expect(sql).toMatch(/idx_messages_conversation_send_idempotency/);
        expect(sql).toMatch(/idx_customers_shop_channel_page/);
    });

    it('does not restore unsafe global provider-MID uniqueness on rollback', async () => {
        const { sequelize, queries } = makeSequelize();

        await migration.down(sequelize);

        expect(queries.join('\n')).not.toMatch(/ADD CONSTRAINT.*external_id.*UNIQUE/i);
        expect(queries.join('\n')).toMatch(/DROP COLUMN IF EXISTS delivery_state/);
    });
});
