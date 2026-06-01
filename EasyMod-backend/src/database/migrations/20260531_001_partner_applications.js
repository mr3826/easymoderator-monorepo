'use strict';

/**
 * Migration: 20260531_001_partner_applications
 *
 * Creates the partner_applications table backing the Partner onboarding flow
 * (apply → admin approve → switch shop to per-order billing). Dialect-aware and
 * idempotent. On db:sync environments the entity already creates the table;
 * this migration covers pure migrate-up (Postgres prod) deployments.
 */
module.exports = {
    name: '20260531_001_partner_applications',

    up: async (sequelize) => {
        const dialect = sequelize.getDialect();

        if (dialect === 'postgres') {
            await sequelize.query(`
                CREATE TABLE IF NOT EXISTS partner_applications (
                    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    shop_id       UUID,
                    business_name VARCHAR(255) NOT NULL,
                    phone         VARCHAR(32) NOT NULL,
                    page_link     TEXT NOT NULL,
                    status        VARCHAR(20) NOT NULL DEFAULT 'pending',
                    reviewed_by   VARCHAR(255),
                    reviewed_at   TIMESTAMPTZ,
                    notes         TEXT,
                    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
            `);
            await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_partner_app_status ON partner_applications(status);`);
            await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_partner_app_shop ON partner_applications(shop_id);`);
        } else {
            await sequelize.query(`
                CREATE TABLE IF NOT EXISTS partner_applications (
                    id            TEXT PRIMARY KEY,
                    shop_id       TEXT,
                    business_name TEXT NOT NULL,
                    phone         TEXT NOT NULL,
                    page_link     TEXT NOT NULL,
                    status        TEXT NOT NULL DEFAULT 'pending',
                    reviewed_by   TEXT,
                    reviewed_at   TEXT,
                    notes         TEXT,
                    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
            `);
            await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_partner_app_status ON partner_applications(status);`);
        }
    },

    down: async (sequelize) => {
        await sequelize.query(`DROP TABLE IF EXISTS partner_applications;`);
    }
};
