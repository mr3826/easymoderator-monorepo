'use strict';

/** Add an ownership token so stale dispatch callers cannot write terminal state. */
module.exports = {
    name: '20260828_003_courier_dispatch_claim_owner',

    up: async (sequelize) => {
        const dialect = typeof sequelize.getDialect === 'function'
            ? sequelize.getDialect()
            : 'postgres';
        if (dialect === 'postgres') {
            await sequelize.query(`
                ALTER TABLE courier_dispatch
                    ADD COLUMN IF NOT EXISTS dispatch_owner_token VARCHAR(64);
            `);
            return;
        }

        const [columns] = await sequelize.query('PRAGMA table_info(courier_dispatch);');
        if (!columns.some(column => column.name === 'dispatch_owner_token')) {
            await sequelize.query(
                'ALTER TABLE courier_dispatch ADD COLUMN dispatch_owner_token VARCHAR(64);'
            );
        }
    },

    down: async (sequelize) => {
        const dialect = typeof sequelize.getDialect === 'function'
            ? sequelize.getDialect()
            : 'postgres';
        if (dialect === 'postgres') {
            await sequelize.query(`
                ALTER TABLE courier_dispatch
                    DROP COLUMN IF EXISTS dispatch_owner_token;
            `);
            return;
        }

        if (typeof sequelize.getQueryInterface === 'function') {
            await sequelize.getQueryInterface().removeColumn('courier_dispatch', 'dispatch_owner_token');
        }
    },
};
