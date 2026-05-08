'use strict';

module.exports = {
    name: '20260414_001_add_user_token_version',

    up: async (sequelize) => {
        const qi = sequelize.getQueryInterface();
        await qi.addColumn('users', 'token_version', {
            type: 'INTEGER',
            allowNull: false,
            defaultValue: 1,
        });
        console.log('✅ Added token_version column to users table');
    },

    down: async (sequelize) => {
        await sequelize.getQueryInterface().removeColumn('users', 'token_version');
        console.log('✅ Removed token_version column from users table');
    }
};
