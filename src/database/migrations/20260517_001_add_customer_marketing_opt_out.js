'use strict';

module.exports = {
    name: '20260517_001_add_customer_marketing_opt_out',

    up: async (sequelize) => {
        await sequelize.query(`
            ALTER TABLE customers
            ADD COLUMN IF NOT EXISTS marketing_opt_out BOOLEAN NOT NULL DEFAULT FALSE
        `);
    },

    down: async (sequelize) => {
        await sequelize.query(`
            ALTER TABLE customers
            DROP COLUMN IF EXISTS marketing_opt_out
        `);
    }
};
