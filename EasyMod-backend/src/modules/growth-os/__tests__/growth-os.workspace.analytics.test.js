'use strict';

const mockProspect = { findAll: jest.fn() };
const mockEvent = { findAll: jest.fn() };
const mockFollowup = { count: jest.fn() };
const mockUser = { findAll: jest.fn().mockResolvedValue([]) };
const mockShop = {};

jest.mock('../../entities', () => ({
  GrowthOsProspect: mockProspect,
  GrowthOsProspectEvent: mockEvent,
  GrowthOsFollowup: mockFollowup,
  User: mockUser,
  Shop: mockShop,
}));
jest.mock('../growth-os.prospect.scope', () => ({
  resolveProspectScope: jest.fn(() => ({ kind: 'all', where: {} })),
}));

const { getGrowthAnalytics } = require('../growth-os.workspace.service');
const { resolveProspectScope } = require('../growth-os.prospect.scope');

describe('Growth workspace analytics', () => {
  beforeEach(() => jest.clearAllMocks());

  test('uses source cohorts, excludes merged rows, and aggregates timing beyond 500 rows', async () => {
    const base = new Date('2026-09-01T00:00:00.000Z');
    const prospects = Array.from({ length: 501 }, (_, index) => ({
      id: `prospect-${index}`,
      source: 'partner_form',
      source_recorded_at: new Date(base.getTime() + index * 1000).toISOString(),
      created_at: new Date('2026-09-14T00:00:00.000Z').toISOString(),
      status: index === 500 ? 'merged' : 'converted',
      disqualified_reason: null,
    }));
    const active = prospects.slice(0, 500);
    const events = active.flatMap((row) => [
      { prospect_id: row.id, event_type: 'status_changed', to_value: 'contacted', created_at: new Date(new Date(row.source_recorded_at).getTime() + 3600000).toISOString() },
      { prospect_id: row.id, event_type: 'status_changed', to_value: 'qualified', created_at: new Date(new Date(row.source_recorded_at).getTime() + 7200000).toISOString() },
      { prospect_id: row.id, event_type: 'followup_created', to_value: null, created_at: new Date(new Date(row.source_recorded_at).getTime() + 10800000).toISOString() },
      { prospect_id: row.id, event_type: 'activated', to_value: 'converted', created_at: new Date(new Date(row.source_recorded_at).getTime() + 14400000).toISOString() },
    ]);

    mockProspect.findAll
      .mockResolvedValueOnce([{ status: 'converted', count: 500 }])
      .mockResolvedValueOnce([{ source: 'partner_form', count: 500 }])
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce([]);
    mockEvent.findAll.mockResolvedValueOnce(events);
    mockFollowup.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(2);
    mockProspect.findAll
      .mockResolvedValueOnce([{
        ownerUserId: 'owner-1', created: 50, qualified: 20, converted: 5,
      }])
      .mockResolvedValueOnce([{
        openCount: 3,
        oldestAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      }]);
    mockUser.findAll.mockResolvedValueOnce([{
      id: 'owner-1', full_name: 'Rumi Operator', email: 'rumi@example.test',
    }]);

    const result = await getGrowthAnalytics({ access: {}, userId: 'growth-user', windowDays: 90 });

    expect(result.funnel.created).toBe(500);
    expect(result.funnel.activated).toBe(500);
    expect(result.leadToActivation).toBe(100);
    expect(result.timing.medianHoursToQualification).toBe(2);
    expect(result.timing.medianHoursToFirstFollowup).toBe(3);
    expect(result.sourceToActivation.partner_form).toBe(100);
    expect(result.lostReasons).toEqual({});
    expect(mockProspect.findAll.mock.calls.every(([options]) => options.limit === undefined)).toBe(true);
    expect(mockProspect.findAll.mock.calls[3][0].where.source_recorded_at).toBeDefined();
    expect(mockEvent.findAll.mock.calls[0][0].order).toEqual([['created_at', 'ASC'], ['id', 'ASC']]);
  });

  test('aggregates follow-up discipline, owner performance, and unassigned age', async () => {
    mockProspect.findAll
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        ownerUserId: 'owner-1', created: 4, qualified: 2, converted: 1,
      }, {
        ownerUserId: 'owner-gone', created: 2, qualified: 0, converted: 0,
      }])
      .mockResolvedValueOnce([{ openCount: 2, oldestAt: '2026-09-01T06:00:00.000Z' }]);
    mockEvent.findAll.mockResolvedValueOnce([]);
    mockFollowup.count
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);
    mockUser.findAll.mockResolvedValueOnce([
      { id: 'owner-1', full_name: 'Rumi Operator', email: 'rumi@example.test' },
    ]);

    const result = await getGrowthAnalytics({ access: {}, userId: 'growth-user', windowDays: 90 });

    expect(result.followupDiscipline).toEqual({
      total: 9,
      open: 3,
      completed: 5,
      cancelled: 1,
      completedOnTime: 4,
      completedLate: 1,
      overdueOpen: 2,
      onTimeRatePct: 80,
    });
    expect(result.byOwner).toEqual([
      expect.objectContaining({
        ownerUserId: 'owner-1',
        displayName: 'Rumi Operator',
        created: 4,
        qualified: 2,
        converted: 1,
        qualificationRatePct: 50,
        activationRatePct: 25,
      }),
      expect.objectContaining({
        ownerUserId: 'owner-gone',
        displayName: 'Former operator (account removed)',
        qualificationRatePct: 0,
        activationRatePct: 0,
      }),
    ]);
    expect(result.unassigned.openCount).toBe(2);
    expect(result.unassigned.oldestSourceRecordedAt).toBe('2026-09-01T06:00:00.000Z');
    expect(result.unassigned.oldestAgeDays).toBeGreaterThanOrEqual(0);
  });

  test('hides owner display names from redacted source scopes', async () => {
    resolveProspectScope.mockReturnValueOnce({
      kind: 'source', where: { source: 'facebook' }, redacted: true,
    });
    mockProspect.findAll
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        ownerUserId: 'owner-1', created: 2, qualified: 1, converted: 1,
      }])
      .mockResolvedValueOnce([]);
    mockEvent.findAll.mockResolvedValueOnce([]);
    mockFollowup.count.mockResolvedValue(0);
    mockUser.findAll.mockResolvedValueOnce([
      { id: 'owner-1', full_name: 'Visible Name', email: 'v@example.test' },
    ]);

    const result = await getGrowthAnalytics({ access: {}, userId: 'marketer-1', windowDays: 90 });

    expect(result.byOwner[0].displayName).toBe('Operator details restricted');
    expect(result.byOwner[0].ownerUserId).toBeNull();
    expect(JSON.stringify(result.byOwner)).not.toContain('Visible Name');
    expect(JSON.stringify(result.byOwner)).not.toContain('owner-1');
  });

  test('reports null discipline rates instead of dividing by zero', async () => {
    mockProspect.findAll
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockEvent.findAll.mockResolvedValueOnce([]);
    mockFollowup.count.mockResolvedValue(0);

    const result = await getGrowthAnalytics({ access: {}, userId: 'growth-user', windowDays: 90 });

    expect(result.followupDiscipline.onTimeRatePct).toBeNull();
    expect(result.unassigned).toEqual({
      openCount: 0,
      oldestSourceRecordedAt: null,
      oldestAgeDays: null,
    });
    expect(result.byOwner).toEqual([]);
  });
});
