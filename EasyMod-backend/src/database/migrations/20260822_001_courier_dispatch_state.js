'use strict';

/** Durable local claim/reconciliation state for external courier booking. */
module.exports = {
    name: '20260822_001_courier_dispatch_state',

    up: async (sequelize) => {
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS courier_dispatch (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                provider        VARCHAR(50) NOT NULL,
                idempotency_key VARCHAR(64) NOT NULL,
                status          VARCHAR(30) NOT NULL DEFAULT 'PENDING',
                consignment_id  VARCHAR(120),
                tracking_code   VARCHAR(120),
                error           TEXT,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_courier_dispatch_shop_order_provider
                ON courier_dispatch(shop_id, order_id, provider);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_courier_dispatch_shop_status
                ON courier_dispatch(shop_id, status);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_courier_dispatch_idempotency
                ON courier_dispatch(idempotency_key);
        `);
    },

    down: async (sequelize) => {
        await sequelize.query(`DROP TABLE IF EXISTS courier_dispatch CASCADE;`);
    },
};
