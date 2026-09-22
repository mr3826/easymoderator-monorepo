'use strict';

const mockProspect = { findAll: jest.fn() };
const mockEvent = { findAll: jest.fn() };
const mockShop = {};

jest.mock('../../entities', () => ({
  GrowthOsProspect: mockProspect,
  GrowthOsProspectEvent: mockEvent,
  Shop: mockShop,
}));
jest.mock('../growth-os.prospect.scope', () => ({
  resolveProspectScope: jest.fn(() => ({ kind: 'all', where: {} })),
}));

const { getGrowthAnalytics } = require('../growth-os.workspace.service');

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
      { prospect_id: row.id, event_type: 'status_changed', to_value: 'converted', created_at: new Date(new Date(row.source_recorded_at).getTime() + 14400000).toISOString() },
    ]);

    mockProspect.findAll
      .mockResolvedValueOnce([{ status: 'converted', count: 500 }])
      .mockResolvedValueOnce([{ source: 'partner_form', count: 500 }])
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce([]);
    mockEvent.findAll.mockResolvedValueOnce(events);

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
});
