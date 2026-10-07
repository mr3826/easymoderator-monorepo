'use strict';

const migration = require('../migrations/20261007_001_growth_os_prospect_integrity');

const transaction = {
  commit: jest.fn(),
  rollback: jest.fn(),
};
const sequelize = {
  getDialect: jest.fn(() => 'postgres'),
  transaction: jest.fn(),
  query: jest.fn(),
};

describe('Growth OS prospect integrity migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sequelize.transaction.mockResolvedValue(transaction);
    sequelize.query.mockResolvedValue([]);
  });

  it('replaces the merge foreign key and creates cohort access indexes', async () => {
    await migration.up(sequelize);

    const sql = sequelize.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('ON DELETE RESTRICT');
    expect(sql).toContain('growth_os_prospects_source_recorded_status_idx');
    expect(sql).toContain('growth_os_prospects_owner_source_recorded_idx');
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('restores the previous merge foreign-key action on rollback', async () => {
    await migration.down(sequelize);

    const sql = sequelize.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('ON DELETE SET NULL');
    expect(sql).toContain('DROP INDEX IF EXISTS growth_os_prospects_owner_source_recorded_idx');
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('rolls back when the database rejects the integrity change', async () => {
    sequelize.query.mockRejectedValueOnce(new Error('constraint failure'));

    await expect(migration.up(sequelize)).rejects.toThrow('constraint failure');
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
    expect(transaction.commit).not.toHaveBeenCalled();
  });
});
