'use strict';

const migration = require('../migrations/20260820_003_growth_os_prospect_source_reference_idx');

const transaction = {
  commit: jest.fn(),
  rollback: jest.fn(),
};
const sequelize = {
  transaction: jest.fn(),
  query: jest.fn(),
};

describe('Growth OS source-reference index migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sequelize.transaction.mockResolvedValue(transaction);
    sequelize.query.mockResolvedValue([]);
  });

  it('recreates source-reference uniqueness without merged tombstones', async () => {
    await migration.up(sequelize);

    expect(sequelize.query).toHaveBeenNthCalledWith(
      1,
      'DROP INDEX IF EXISTS growth_os_prospects_source_reference_uq;',
      { transaction },
    );
    expect(sequelize.query).toHaveBeenNthCalledWith(
      2,
      "CREATE UNIQUE INDEX growth_os_prospects_source_reference_uq ON growth_os_prospects (source, source_reference) WHERE source_reference IS NOT NULL AND status <> 'merged';",
      { transaction },
    );
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('restores the original predicate on rollback', async () => {
    await migration.down(sequelize);

    expect(sequelize.query.mock.calls[1][0]).toBe(
      'CREATE UNIQUE INDEX growth_os_prospects_source_reference_uq ON growth_os_prospects (source, source_reference) WHERE source_reference IS NOT NULL;',
    );
  });

  it('rolls back when index recreation fails', async () => {
    sequelize.query.mockRejectedValueOnce(new Error('index failure'));

    await expect(migration.up(sequelize)).rejects.toThrow('index failure');
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
    expect(transaction.commit).not.toHaveBeenCalled();
  });
});
