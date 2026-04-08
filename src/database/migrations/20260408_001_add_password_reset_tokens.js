'use strict';

module.exports = {
    name: '20260408_001_add_password_reset_tokens',

    up: async (sequelize) => {
        const qi = sequelize.getQueryInterface();

        await qi.createTable('password_reset_tokens', {
            id: {
                type: 'UUID',
                defaultValue: sequelize.literal('gen_random_uuid()'),
                primaryKey: true,
                allowNull: false,
            },
            user_id: {
                type: 'UUID',
                allowNull: false,
                references: { model: 'users', key: 'id' },
                onDelete: 'CASCADE',
            },
            token_hash: {
                type: 'VARCHAR(64)',
                allowNull: false,
                unique: true,
            },
            expires_at: {
                type: 'TIMESTAMPTZ',
                allowNull: false,
            },
            used_at: {
                type: 'TIMESTAMPTZ',
                allowNull: true,
            },
            created_at: {
                type: 'TIMESTAMPTZ',
                allowNull: false,
                defaultValue: sequelize.literal('NOW()'),
            },
        });

        await sequelize.query(
            `CREATE INDEX IF NOT EXISTS idx_prt_user_id ON password_reset_tokens(user_id)`
        );
        await sequelize.query(
            `CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash)`
        );
        await sequelize.query(
            `CREATE INDEX IF NOT EXISTS idx_prt_expires_at ON password_reset_tokens(expires_at)`
        );
    },

    down: async (sequelize) => {
        await sequelize.getQueryInterface().dropTable('password_reset_tokens');
    },
};
