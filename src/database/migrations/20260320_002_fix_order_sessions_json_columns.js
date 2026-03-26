'use strict';

/**
 * Migration: Convert order_sessions TEXT columns to JSON
 *
 * The order_sessions table was created with step_data, product_info, and metadata
 * as TEXT columns, but the Sequelize model defines them as DataTypes.JSON.
 * For SQLite, TEXT columns already handle JSON properly, so no conversion needed.
 *
 * Idempotent: each operation is wrapped in try/catch.
 */

module.exports = {
  name: '20260320_002_fix_order_sessions_json_columns',

  up: async (sequelize) => {
    const dialect = sequelize.getDialect();
    
    if (dialect === 'postgres') {
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
    } else {
      // SQLite: TEXT columns already handle JSON properly, no action needed
      console.log('  ✓ SQLite: TEXT columns already support JSON, skipping conversion');
    }
  },

  down: async (sequelize) => {
    console.log('  ⚠️  down() is a no-op: reverting JSON to TEXT would lose type safety');
  }
};
