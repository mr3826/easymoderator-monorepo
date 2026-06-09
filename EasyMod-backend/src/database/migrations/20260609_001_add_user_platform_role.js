'use strict';

/**
 * Add nullable users.platform_role for EasyModerator operators.
 * NULL = normal merchant user. Distinct from the tenant user_shops.role.
 * STRING (not ENUM) — values are validated in code (PLATFORM_ROLES) and STRING
 * avoids the ENUM-migration friction this repo has hit before.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('users');
    if (!table.platform_role) {
      await queryInterface.addColumn('users', 'platform_role', {
        type: Sequelize.STRING(20),
        allowNull: true,
        defaultValue: null,
      });
    }
    await queryInterface
      .addIndex('users', ['platform_role'], { name: 'users_platform_role_idx' })
      .catch(() => { /* index may already exist */ });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('users', 'users_platform_role_idx').catch(() => {});
    await queryInterface.removeColumn('users', 'platform_role').catch(() => {});
  },
};
