'use strict';

module.exports = {
  name: '20260820_001_growth_os_user_roles',

  up: async (sequelize) => {
    const transaction = await sequelize.transaction();
    try {
      await sequelize.query(`
      CREATE TABLE IF NOT EXISTS growth_os_user_roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(32) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
        granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
        revoked_at TIMESTAMPTZ,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT growth_os_user_roles_role_check CHECK (
          role IN (
            'FOUNDER',
            'GROWTH_MANAGER',
            'BUSINESS_EXECUTIVE',
            'MARKETER',
            'CUSTOMER_SUCCESS',
            'READ_ONLY_ANALYST'
          )
        )
      );
      `, { transaction });

      await sequelize.query(`
      CREATE INDEX IF NOT EXISTS growth_os_user_roles_user_id_idx
      ON growth_os_user_roles (user_id);
      `, { transaction });

      await sequelize.query(`
      CREATE INDEX IF NOT EXISTS growth_os_user_roles_role_idx
      ON growth_os_user_roles (role);
      `, { transaction });

      await sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS growth_os_user_roles_one_active_role_per_user_idx
      ON growth_os_user_roles (user_id)
      WHERE is_active = true AND revoked_at IS NULL;
      `, { transaction });

      await transaction.commit();
      console.log('[migration] 20260820_001_growth_os_user_roles: UP complete');
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  down: async (sequelize) => {
    const transaction = await sequelize.transaction();
    try {
      await sequelize.query('DROP INDEX IF EXISTS growth_os_user_roles_one_active_role_per_user_idx;', { transaction });
      await sequelize.query('DROP INDEX IF EXISTS growth_os_user_roles_role_idx;', { transaction });
      await sequelize.query('DROP INDEX IF EXISTS growth_os_user_roles_user_id_idx;', { transaction });
      await sequelize.query('DROP TABLE IF EXISTS growth_os_user_roles;', { transaction });
      await transaction.commit();
      console.log('[migration] 20260820_001_growth_os_user_roles: DOWN complete');
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
