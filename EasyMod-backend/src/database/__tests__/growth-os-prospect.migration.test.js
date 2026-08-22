'use strict';

const migration = require('../migrations/20260820_002_growth_os_prospects');

const transaction = {
  commit: jest.fn(),
  rollback: jest.fn(),
};
const sequelize = {
  transaction: jest.fn(),
  getDialect: jest.fn(),
  query: jest.fn(),
};

describe('Growth OS prospect migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sequelize.transaction.mockResolvedValue(transaction);
    sequelize.getDialect.mockReturnValue('postgres');
    sequelize.query.mockResolvedValue([]);
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates both tables with all lifecycle, provenance, and linkage checks', async () => {
    await migration.up(sequelize);

    const statements = sequelize.query.mock.calls.map(([sql]) => sql);
    expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS growth_os_prospects');
    expect(statements[1]).toContain('CREATE TABLE IF NOT EXISTS growth_os_prospect_events');

    expect(statements[0]).toMatch(/CONSTRAINT growth_os_prospects_status_check CHECK \(status IN \(/);
    expect(statements[0]).toMatch(/CONSTRAINT growth_os_prospects_source_check CHECK \(source IN \(/);
    expect(statements[0]).toContain('CONSTRAINT growth_os_prospects_merge_check');
    expect(statements[0]).toContain("(status = 'merged') = (merged_into_id IS NOT NULL)");
    expect(statements[0]).toContain('CONSTRAINT growth_os_prospects_converted_link_check');
    expect(statements[0]).toContain("status <> 'converted' OR linked_shop_id IS NOT NULL");
    expect(statements[0]).toContain('CONSTRAINT growth_os_prospects_channel_check');
    expect(statements[0]).toContain('normalized_phone IS NOT NULL OR normalized_email IS NOT NULL OR normalized_page IS NOT NULL');
    expect(statements[1]).toContain('CONSTRAINT growth_os_prospect_events_type_check');
    expect(statements[1]).toContain("'merge_target'");

    expect(sequelize.query.mock.calls.every(([, options]) => options.transaction === transaction)).toBe(true);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('creates every required index and retains each partial uniqueness predicate', async () => {
    await migration.up(sequelize);

    const sql = sequelize.query.mock.calls.map(([statement]) => statement).join('\n');
    const indexes = [
      'growth_os_prospects_status_created_idx',
      'growth_os_prospects_owner_status_created_idx',
      'growth_os_prospects_source_created_idx',
      'growth_os_prospects_normalized_business_name_idx',
      'growth_os_prospects_linked_shop_idx',
      'growth_os_prospects_merged_into_idx',
      'growth_os_prospects_normalized_phone_uq',
      'growth_os_prospects_normalized_email_uq',
      'growth_os_prospects_normalized_page_uq',
      'growth_os_prospects_source_reference_uq',
      'growth_os_prospect_events_prospect_created_idx',
    ];
    for (const index of indexes) {
      expect(sql).toContain(index);
    }

    expect(sql).toContain('ON growth_os_prospects (linked_shop_id) WHERE linked_shop_id IS NOT NULL');
    expect(sql).toContain('ON growth_os_prospects (merged_into_id) WHERE merged_into_id IS NOT NULL');
    expect(sql).toContain("ON growth_os_prospects (normalized_phone) WHERE normalized_phone IS NOT NULL AND status <> 'merged'");
    expect(sql).toContain("ON growth_os_prospects (normalized_email) WHERE normalized_email IS NOT NULL AND status <> 'merged'");
    expect(sql).toContain("ON growth_os_prospects (normalized_page) WHERE normalized_page IS NOT NULL AND status <> 'merged'");
    expect(sql).toContain('ON growth_os_prospects (source, source_reference) WHERE source_reference IS NOT NULL');
  });

  it('drops dependent event objects before the prospect table in dependency-safe order', async () => {
    await migration.down(sequelize);

    const drops = sequelize.query.mock.calls.map(([sql]) => sql.trim());
    expect(drops).toEqual([
      'DROP INDEX IF EXISTS growth_os_prospect_events_prospect_created_idx;',
      'DROP INDEX IF EXISTS growth_os_prospects_source_reference_uq;',
      'DROP INDEX IF EXISTS growth_os_prospects_normalized_page_uq;',
      'DROP INDEX IF EXISTS growth_os_prospects_normalized_email_uq;',
      'DROP INDEX IF EXISTS growth_os_prospects_normalized_phone_uq;',
      'DROP INDEX IF EXISTS growth_os_prospects_merged_into_idx;',
      'DROP INDEX IF EXISTS growth_os_prospects_linked_shop_idx;',
      'DROP INDEX IF EXISTS growth_os_prospects_normalized_business_name_idx;',
      'DROP INDEX IF EXISTS growth_os_prospects_source_created_idx;',
      'DROP INDEX IF EXISTS growth_os_prospects_owner_status_created_idx;',
      'DROP INDEX IF EXISTS growth_os_prospects_status_created_idx;',
      'DROP TABLE IF EXISTS growth_os_prospect_events;',
      'DROP TABLE IF EXISTS growth_os_prospects;',
    ]);
    expect(drops.indexOf('DROP TABLE IF EXISTS growth_os_prospect_events;'))
      .toBeLessThan(drops.indexOf('DROP TABLE IF EXISTS growth_os_prospects;'));
    expect(sequelize.query.mock.calls.every(([, options]) => options.transaction === transaction)).toBe(true);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('rolls back the migration transaction when a DDL statement fails', async () => {
    sequelize.query.mockRejectedValueOnce(new Error('ddl failed'));

    await expect(migration.up(sequelize)).rejects.toThrow('ddl failed');
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
    expect(transaction.commit).not.toHaveBeenCalled();
  });
});
