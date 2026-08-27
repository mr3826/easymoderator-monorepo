'use strict';

/** Persist the courier environment selected during provider connection. */
module.exports = {
    name: '20260827_001_delivery_integrations_sandbox',

    up: async (sequelize) => {
        const dialect = typeof sequelize.getDialect === 'function'
            ? sequelize.getDialect()
            : 'postgres';

        if (dialect === 'postgres') {
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT FALSE;
            `);
            return;
        }

        const result = await sequelize.query("PRAGMA table_info('delivery_integrations')");
        const columns = Array.isArray(result?.[0]) ? result[0] : [];
        if (!columns.some((column) => column.name === 'is_sandbox')) {
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                ADD COLUMN is_sandbox BOOLEAN NOT NULL DEFAULT 0;
            `);
        }
    },

    down: async (sequelize) => {
        const dialect = typeof sequelize.getDialect === 'function'
            ? sequelize.getDialect()
            : 'postgres';

        if (dialect === 'postgres') {
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                DROP COLUMN IF EXISTS is_sandbox;
            `);
            return;
        }

        const result = await sequelize.query("PRAGMA table_info('delivery_integrations')");
        const columns = Array.isArray(result?.[0]) ? result[0] : [];
        if (columns.some((column) => column.name === 'is_sandbox')) {
            await sequelize.query(`
                ALTER TABLE delivery_integrations
                DROP COLUMN is_sandbox;
            `);
        }
    }
};
