'use strict';

/**
 * Migration: Extend channel_type enum for channel_configs
 */

module.exports = {
  name: '20260209_003_extend_channel_types',

  up: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();
    const dialect = sequelize.getDialect();

    if (dialect !== 'postgres') {
      return;
    }

    const addEnumValue = async (value) => {
      await queryInterface.sequelize.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_type t
            JOIN pg_enum e ON t.oid = e.enumtypid
            WHERE t.typname = 'enum_channel_configs_channel_type'
              AND e.enumlabel = '${value}'
          ) THEN
            ALTER TYPE "enum_channel_configs_channel_type" ADD VALUE '${value}';
          END IF;
        END
        $$;
      `);
    };

    await addEnumValue('webchat');
    await addEnumValue('telegram');
  }
};
