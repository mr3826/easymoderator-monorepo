'use strict';

const migration = require('../migrations/20260925_001_growth_os_followup_cancel_event_type');

const sequelize = {
  getDialect: jest.fn(),
  query: jest.fn(),
};

describe('Growth OS follow-up cancel event type migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sequelize.getDialect.mockReturnValue('postgres');
    sequelize.query.mockResolvedValue([]);
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('replaces the event-type CHECK with a superset that includes cancellation', async () => {
    await migration.up(sequelize);

    const statements = sequelize.query.mock.calls.map(([sql]) => sql);
    expect(statements[0]).toBe(
      'ALTER TABLE growth_os_prospect_events DROP CONSTRAINT IF EXISTS growth_os_prospect_events_type_check',
    );
    expect(statements[1]).toContain(
      'ADD CONSTRAINT growth_os_prospect_events_type_check CHECK (event_type IN (',
    );
    expect(statements[1]).toContain("'followup_cancelled'");
    expect(statements[1]).toContain("'followup_completed'");
    expect(statements[1]).toContain("'activated'");
  });

  it('skips named CHECK replacement on non-PostgreSQL dialects', async () => {
    sequelize.getDialect.mockReturnValue('sqlite');

    await migration.up(sequelize);
    expect(sequelize.query).not.toHaveBeenCalled();

    await migration.down(sequelize);
    expect(sequelize.query).not.toHaveBeenCalled();
  });

  it('rolls the check back to the prior list only when cancellation rows are absent', async () => {
    sequelize.query.mockResolvedValueOnce([{ count: 0 }]);

    await migration.down(sequelize);

    const statements = sequelize.query.mock.calls.map(([sql]) => sql);
    expect(statements[0]).toContain('WHERE event_type NOT IN (');
    expect(statements[0]).not.toContain("'followup_cancelled'");
    expect(statements[2]).toContain("'followup_completed'");
    expect(statements[2]).not.toContain("'followup_cancelled'");
  });

  it('refuses to roll back while cancelled events exist', async () => {
    sequelize.query.mockResolvedValueOnce([{ count: 3 }]);

    await expect(migration.down(sequelize)).rejects.toThrow('Cannot roll back');
    expect(sequelize.query).toHaveBeenCalledTimes(1);
  });
});
