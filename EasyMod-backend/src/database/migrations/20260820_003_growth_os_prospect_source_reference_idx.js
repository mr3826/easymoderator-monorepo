'use strict';

const INDEX_NAME = 'growth_os_prospects_source_reference_uq';

async function recreateIndex(sequelize, predicate) {
  const transaction = await sequelize.transaction();
  try {
    await sequelize.query(`DROP INDEX IF EXISTS ${INDEX_NAME};`, { transaction });
    await sequelize.query(
      `CREATE UNIQUE INDEX ${INDEX_NAME} ON growth_os_prospects (source, source_reference) ${predicate};`,
      { transaction },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

module.exports = {
  name: '20260820_003_growth_os_prospect_source_reference_idx',

  up: (sequelize) => recreateIndex(
    sequelize,
    "WHERE source_reference IS NOT NULL AND status <> 'merged'",
  ),

  down: (sequelize) => recreateIndex(
    sequelize,
    'WHERE source_reference IS NOT NULL',
  ),
};
