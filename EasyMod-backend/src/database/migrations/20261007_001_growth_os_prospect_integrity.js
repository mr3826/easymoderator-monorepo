'use strict';

// Keeps the merged-row CHECK consistent with the self-referential foreign key
// and adds the indexes used by source-cohort analytics. The original table
// migration used ON DELETE SET NULL, which can leave a merged tombstone with a
// null target and violate its own invariant when a target is deleted.

const MERGED_FK = 'growth_os_prospects_merged_into_fk';
const SOURCE_COHORT_INDEX = 'growth_os_prospects_source_recorded_status_idx';
const OWNER_COHORT_INDEX = 'growth_os_prospects_owner_source_recorded_idx';

async function replaceMergedForeignKey(sequelize, onDelete) {
  await sequelize.query(`
    DO $$
    DECLARE
      constraint_name text;
    BEGIN
      IF to_regclass('growth_os_prospects') IS NULL THEN
        RETURN;
      END IF;

      SELECT con.conname
        INTO constraint_name
        FROM pg_constraint con
        JOIN pg_attribute attr
          ON attr.attrelid = con.conrelid
         AND attr.attnum = ANY(con.conkey)
       WHERE con.conrelid = 'growth_os_prospects'::regclass
         AND con.confrelid = 'growth_os_prospects'::regclass
         AND con.contype = 'f'
         AND attr.attname = 'merged_into_id'
       LIMIT 1;

      IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE growth_os_prospects DROP CONSTRAINT %I', constraint_name);
      END IF;

      EXECUTE 'ALTER TABLE growth_os_prospects ADD CONSTRAINT ${MERGED_FK}
        FOREIGN KEY (merged_into_id) REFERENCES growth_os_prospects(id) ON DELETE ${onDelete}';
    END $$;
  `);
}

async function ensureIndexes(sequelize) {
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS ${SOURCE_COHORT_INDEX}
      ON growth_os_prospects (source, source_recorded_at DESC, status);
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS ${OWNER_COHORT_INDEX}
      ON growth_os_prospects (owner_user_id, source_recorded_at DESC, status);
  `);
}

module.exports = {
  name: '20261007_001_growth_os_prospect_integrity',

  async up(sequelize) {
    if (sequelize.getDialect() !== 'postgres') return;
    const transaction = await sequelize.transaction();
    try {
      await replaceMergedForeignKey({
        query: (sql) => sequelize.query(sql, { transaction }),
      }, 'RESTRICT');
      await ensureIndexes({
        query: (sql) => sequelize.query(sql, { transaction }),
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(sequelize) {
    if (sequelize.getDialect() !== 'postgres') return;
    const transaction = await sequelize.transaction();
    try {
      await sequelize.query(`DROP INDEX IF EXISTS ${OWNER_COHORT_INDEX};`, { transaction });
      await sequelize.query(`DROP INDEX IF EXISTS ${SOURCE_COHORT_INDEX};`, { transaction });
      await replaceMergedForeignKey({
        query: (sql) => sequelize.query(sql, { transaction }),
      }, 'SET NULL');
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
