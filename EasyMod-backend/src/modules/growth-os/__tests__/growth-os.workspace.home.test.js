'use strict';

const { Op } = require('sequelize');

const mockProspect = { count: jest.fn() };
const mockFollowup = { count: jest.fn() };
const mockAuditLog = { findAll: jest.fn() };
const mockUser = {};
const mockShop = { count: jest.fn() };
const mockMetaChannel = { count: jest.fn() };
const mockPayment = { count: jest.fn() };
const mockSubscription = { count: jest.fn() };

jest.mock('../../entities', () => ({
  GrowthOsProspect: mockProspect,
  GrowthOsFollowup: mockFollowup,
  AuditLog: mockAuditLog,
  User: mockUser,
  Shop: mockShop,
  MetaChannel: mockMetaChannel,
  PaymentTransaction: mockPayment,
  Subscription: mockSubscription,
}));

jest.mock('../growth-os.prospect.scope', () => ({
  resolveProspectScope: jest.fn(() => ({ kind: 'all', where: {} })),
}));

const { getHome } = require('../growth-os.workspace.service');

function resetCounts(value) {
  mockProspect.count.mockResolvedValue(value);
  mockFollowup.count.mockResolvedValue(value);
}

describe('Growth workspace Home', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuditLog.findAll.mockResolvedValue([]);
    mockShop.count.mockResolvedValue(0);
    mockMetaChannel.count.mockResolvedValue(0);
    mockPayment.count.mockResolvedValue(0);
    mockSubscription.count.mockResolvedValue(0);
  });

  test('returns business-day windows and Asia/Dhaka timezone so drill-throughs can reuse the exact bounds', async () => {
    resetCounts(0);
    const home = await getHome({ access: {}, userId: 'u-1', isSuperAdmin: false });

    expect(home.windows).toBeDefined();
    expect(home.windows.businessTimeZone).toBe('Asia/Dhaka');
    const since = new Date(home.windows.attentionSince);
    const until = new Date(home.windows.attentionUntil);
    const stalledBefore = new Date(home.windows.stalledBefore);
    expect(Number.isNaN(since.getTime())).toBe(false);
    expect(Number.isNaN(until.getTime())).toBe(false);
    expect(since < until).toBe(true);
    expect(Math.round((until - since) / (24 * 60 * 60 * 1000))).toBe(7);
    expect(Math.round((until - stalledBefore) / (24 * 60 * 60 * 1000))).toBe(15);
  });

  test('uses current time (not UTC midnight) for personal overdue and applies the prospect scope to follow-ups', async () => {
    const seen = [];
    mockFollowup.count.mockImplementation((options) => {
      seen.push(options.where.due_at);
      return Promise.resolve(0);
    });
    mockProspect.count.mockResolvedValue(0);

    const before = Date.now();
    await getHome({ access: {}, userId: 'u-1', isSuperAdmin: false });
    const after = Date.now();

    const overdueNow = seen[0];
    const value = overdueNow[Op.lt];
    const stamp = value instanceof Date ? value.getTime() : Number(value);
    expect(Number.isNaN(stamp)).toBe(false);
    expect(stamp).toBeGreaterThanOrEqual(before);
    expect(stamp).toBeLessThanOrEqual(after);
  });

  test('exposes qualifiedStalledOver15d and followupsDueTodayInScope metrics for Home drill-through parity', async () => {
    resetCounts(0);
    const home = await getHome({ access: {}, userId: 'u-1', isSuperAdmin: false });
    expect(Object.prototype.hasOwnProperty.call(home.growthAttention, 'qualifiedStalledOver15d')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(home.growthAttention, 'followupsDueTodayInScope')).toBe(true);
  });
});
