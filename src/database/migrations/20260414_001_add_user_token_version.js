/**
 * Migration: Add token_version column to users table
 * Purpose: Support token invalidation on password reset for security
 */

module.exports = {
    up: async (queryInterface, Sequelize) => {
        const { DataTypes } = Sequelize;

        // Add token_version column to users table
        await queryInterface.addColumn('users', 'token_version', {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 1,
            comment: 'Version counter for token invalidation on password reset'
        });

        console.log('✅ Added token_version column to users table');
    },

    down: async (queryInterface, Sequelize) => {
        // Remove token_version column from users table
        await queryInterface.removeColumn('users', 'token_version');

        console.log('✅ Removed token_version column from users table');
    }
};
