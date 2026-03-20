'use strict';

/**
 * Migration: Convert order_sessions TEXT columns to JSONB
 *
 * The order_sessions table was created with step_data, product_info, and metadata
 * as TEXT columns, but the Sequelize model defines them as DataTypes.JSON. PostgreSQL
 * with a TEXT column does not auto-deserialize JSON, so Sequelize receives raw strings
 * instead of objects. Converting to JSONB fixes deserialization.
 *
 * Idempotent: each ALTER is wrapped in try/catch (no-op if already JSONB).
 */

module.exports = {
  name: '20260320_002_fix_order_sessions_json_columns',

  up: async (sequelize) => {
    const already = (e) =>
      /cannot cast type jsonb to jsonb/i.test(e.message) ||
      /column.*does not exist/i.test(e.message);

    const toJsonb = async (column) => {
      try {
        await sequelize.query(`
          ALTER TABLE order_sessions
          ALTER COLUMN "${column}" TYPE JSONB
          USING CASE
            WHEN "${column}" IS NULL THEN NULL
            ELSE "${column}"::JSONB
          END
        `);
        console.log(`  ✓ order_sessions.${column} converted to JSONB`);
      } catch (err) {
        if (already(err) || /already type/i.test(err.message) || /jsonb/i.test(err.message)) {
          console.log(`  · order_sessions.${column} already JSONB, skipping`);
        } else {
          throw err;
        }
      }
    };

    await toJsonb('step_data');
    await toJsonb('product_info');
    await toJsonb('metadata');
  },

  down: async (sequelize) => {
    console.log('  ⚠️  down() is a no-op: reverting JSONB to TEXT would lose type safety');
  }
};
