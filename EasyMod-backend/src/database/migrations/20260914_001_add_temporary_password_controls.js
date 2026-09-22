'use strict';

const { DataTypes } = require('sequelize');

/**
 * Bind generated Growth OS invite/reset passwords to an expiring, forced
 * password-change state. Existing users remain normal users by default.
 */
module.exports = {
    name: '20260914_001_add_temporary_password_controls',

    up: async (sequelize) => {
        const dialect = sequelize.getDialect();
        if (dialect === 'postgres') {
            await sequelize.query(
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;'
            );
            await sequelize.query(
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS temporary_password_expires_at TIMESTAMPTZ;'
            );
        } else if (dialect === 'sqlite') {
            const [columns] = await sequelize.query('PRAGMA table_info("users")');
            const names = new Set(columns.map((column) => column.name));
            if (!names.has('must_change_password')) {
                await sequelize.query('ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT 0');
            }
            if (!names.has('temporary_password_expires_at')) {
                await sequelize.query('ALTER TABLE "users" ADD COLUMN "temporary_password_expires_at" DATETIME NULL');
            }
        } else {
            const queryInterface = sequelize.getQueryInterface();
            const columns = await queryInterface.describeTable('users');
            if (!columns.must_change_password) {
                await queryInterface.addColumn('users', 'must_change_password', {
                    type: DataTypes.BOOLEAN,
                    allowNull: false,
                    defaultValue: false,
                });
            }
            if (!columns.temporary_password_expires_at) {
                await queryInterface.addColumn('users', 'temporary_password_expires_at', {
                    type: DataTypes.DATE,
                    allowNull: true,
                });
            }
        }
        console.log('[migration] 20260914_001_add_temporary_password_controls: UP complete');
    },

    down: async (sequelize) => {
        const dialect = sequelize.getDialect();
        if (dialect === 'postgres') {
            await sequelize.query('ALTER TABLE users DROP COLUMN IF EXISTS temporary_password_expires_at;');
            await sequelize.query('ALTER TABLE users DROP COLUMN IF EXISTS must_change_password;');
        } else if (dialect === 'sqlite') {
            const [columns] = await sequelize.query('PRAGMA table_info("users")');
            const names = new Set(columns.map((column) => column.name));
            if (names.has('temporary_password_expires_at')) {
                await sequelize.query('ALTER TABLE "users" DROP COLUMN "temporary_password_expires_at"');
            }
            if (names.has('must_change_password')) {
                await sequelize.query('ALTER TABLE "users" DROP COLUMN "must_change_password"');
            }
        } else {
            const queryInterface = sequelize.getQueryInterface();
            const columns = await queryInterface.describeTable('users');
            if (columns.temporary_password_expires_at) {
                await queryInterface.removeColumn('users', 'temporary_password_expires_at');
            }
            if (columns.must_change_password) {
                await queryInterface.removeColumn('users', 'must_change_password');
            }
        }
        console.log('[migration] 20260914_001_add_temporary_password_controls: DOWN complete');
    },
};
