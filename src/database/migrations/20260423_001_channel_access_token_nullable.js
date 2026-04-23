'use strict';

/**
 * Make channel_configs.access_token nullable so disconnecting a channel
 * (which clears the token) doesn't fail with a NOT NULL constraint violation.
 */

module.exports = {
    name: '20260423_001_channel_access_token_nullable',

    up: async (sequelize) => {
        const dialect = sequelize.getDialect();
        if (dialect !== 'postgres') return;

        await sequelize.query(`
            ALTER TABLE channel_configs
            ALTER COLUMN access_token DROP NOT NULL;
        `);
    },

    down: async (sequelize) => {
        const dialect = sequelize.getDialect();
        if (dialect !== 'postgres') return;

        // Re-add NOT NULL — only safe if no rows have a null access_token
        await sequelize.query(`
            ALTER TABLE channel_configs
            ALTER COLUMN access_token SET NOT NULL;
        `);
    }
};
