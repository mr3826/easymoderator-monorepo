'use strict';

/**
 * Migration: Add platform priority columns to shops
 *
 * payment_platform_priority: ordered JSON array of payment platform identifiers
 * delivery_platform_priority: ordered JSON array of delivery platform identifiers
 *
 * Index 0 = highest priority (AI defaults to this platform when responding to customers).
 */

module.exports = {
    name: '20260510_003_shop_platform_priority',

    up: async (sequelize) => {
        await sequelize.query(`
            ALTER TABLE shops
            ADD COLUMN IF NOT EXISTS payment_platform_priority JSONB NOT NULL DEFAULT '[]'
        `).catch(() =>
            sequelize.query(`ALTER TABLE shops ADD COLUMN payment_platform_priority TEXT NOT NULL DEFAULT '[]'`).catch(() => {})
        );

        await sequelize.query(`
            ALTER TABLE shops
            ADD COLUMN IF NOT EXISTS delivery_platform_priority JSONB NOT NULL DEFAULT '[]'
        `).catch(() =>
            sequelize.query(`ALTER TABLE shops ADD COLUMN delivery_platform_priority TEXT NOT NULL DEFAULT '[]'`).catch(() => {})
        );

        console.log('  ✓ Added payment_platform_priority column');
        console.log('  ✓ Added delivery_platform_priority column');
    },

    down: async (sequelize) => {
        const dialect = sequelize.getDialect();
        if (dialect === 'postgres') {
            await sequelize.query(`ALTER TABLE shops DROP COLUMN IF EXISTS payment_platform_priority`);
            await sequelize.query(`ALTER TABLE shops DROP COLUMN IF EXISTS delivery_platform_priority`);
        }
        console.log('  ✓ Dropped platform priority columns');
    }
};
