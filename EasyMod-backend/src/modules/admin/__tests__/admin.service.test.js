'use strict';

jest.mock('../../entities', () => ({
  Shop:         { count: jest.fn(), findAndCountAll: jest.fn(), findByPk: jest.fn() },
  Subscription: { count: jest.fn(), findOne: jest.fn() },
  Message:      { count: jest.fn() },
  Order:        { count: jest.fn() },
  MetaChannel:  { count: jest.fn() },
  AuditLog:     { findAndCountAll: jest.fn() },
  User:         {},
}));
jest.mock('../../../utils/cache.service', () => ({
  get: jest.fn(async () => null),
  set: jest.fn(async () => {}),
  deleteForShop: jest.fn(async () => {}),
}));

const entities = require('../../entities');
const cacheService = require('../../../utils/cache.service');
const subscriptionService = require('../../subscription/subscription.service');
const metaChannelService = require('../../channel-providers/meta-channel.service');
const shopService = require('../../shop/shop.service');
const adminService = require('../admin.service');

describe('admin.service.getDashboard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('buckets shop counts by subscription status and returns Phase-2 nulls', async () => {
    entities.Shop.count.mockResolvedValue(10);
    entities.Subscription.count
      .mockResolvedValueOnce(6)  // active
      .mockResolvedValueOnce(3)  // trialing
      .mockResolvedValueOnce(1); // suspended
    entities.Message.count
      .mockResolvedValueOnce(120) // messages today
      .mockResolvedValueOnce(45); // ai replies today
    entities.Order.count.mockResolvedValue(8);

    const data = await adminService.getDashboard();

    expect(data.shops).toEqual({ total: 10, active: 6, trial: 3, suspended: 1 });
    expect(data.today.messages).toBe(120);
    expect(data.today.aiAutoReplies).toBe(45);
    expect(data.today.orders).toBe(8);
    expect(data.today.failedAiReplies).toBeNull();
    expect(data.today.courierFailures).toBeNull();
    expect(data.today.estimatedAiCost).toBeNull();
    expect(data.today.systemErrors).toBeNull();
  });
});

describe('admin.service.listShops', () => {
  beforeEach(() => jest.clearAllMocks());

  it('searches by shop name and owner identity using a dialect-safe LIKE', async () => {
    entities.Shop.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    const res = await adminService.listShops({ search: 'owner@example.com' });

    expect(res.items).toEqual([]);
    const query = entities.Shop.findAndCountAll.mock.calls[0][0];
    const [orSymbol] = Object.getOwnPropertySymbols(query.where);
    expect(orSymbol).toBeDefined();
    expect(query.where[orSymbol]).toHaveLength(3);
    expect(query.include[1]).toEqual(expect.objectContaining({
      as: 'users',
      required: false,
      through: expect.objectContaining({ where: { role: 'owner' } }),
    }));
    expect(query.subQuery).toBe(false);
  });
});

describe('admin.service mutations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('setShopStatus suspends and busts the subscription cache', async () => {
    const update = jest.fn().mockResolvedValue(true);
    entities.Subscription.findOne.mockResolvedValue({ status: 'active', update });

    const res = await adminService.setShopStatus('shop-1', 'suspended');

    expect(update).toHaveBeenCalledWith({ status: 'suspended' });
    expect(cacheService.deleteForShop).toHaveBeenCalledWith('shop-1', 'subscription:status');
    expect(res).toEqual({ before: { status: 'active' }, after: { status: 'suspended' } });
  });

  it('setShopStatus rejects an invalid status', async () => {
    await expect(adminService.setShopStatus('shop-1', 'frozen')).rejects.toThrow(/status must be/);
  });

  it('extendTrial advances trial_ends_at and keeps trialing', async () => {
    const update = jest.fn().mockResolvedValue(true);
    const existingEnd = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    entities.Subscription.findOne.mockResolvedValue({ status: 'trialing', trial_ends_at: existingEnd, update });

    const res = await adminService.extendTrial('shop-1', 7);

    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0][0];
    expect(arg.status).toBe('trialing');
    // 2 existing + 7 added = ~9 days out
    const daysOut = (new Date(arg.trial_ends_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysOut).toBeGreaterThan(8.5);
    expect(res.after.status).toBe('trialing');
  });

  it('addCredits calls grantBonusConversations with the amount', async () => {
    jest.spyOn(subscriptionService, 'grantBonusConversations').mockResolvedValue({});
    entities.Subscription.findOne
      .mockResolvedValueOnce({ topup_balance: 10 })  // before
      .mockResolvedValueOnce({ topup_balance: 60 }); // after

    const res = await adminService.addCredits('shop-1', 50, 'admin_grant');

    expect(subscriptionService.grantBonusConversations).toHaveBeenCalledWith('shop-1', 50, 'admin_grant');
    expect(res.after).toEqual({ topup_balance: 60, granted: 50 });
  });

  it('markChannelReconnect sets the channel to TOKEN_EXPIRED', async () => {
    jest.spyOn(metaChannelService, 'listByShop').mockResolvedValue([{ id: 'ch-1', status: 'CONNECTED' }]);
    jest.spyOn(metaChannelService, 'updateStatus').mockResolvedValue({});

    const res = await adminService.markChannelReconnect('shop-1', 'ch-1');

    expect(metaChannelService.updateStatus).toHaveBeenCalledWith('ch-1', 'TOKEN_EXPIRED', expect.any(String));
    expect(res).toEqual({ before: { status: 'CONNECTED' }, after: { status: 'TOKEN_EXPIRED' } });
  });

  it('emergencyDisableAi sets MANUAL on every channel + shop level', async () => {
    jest.spyOn(metaChannelService, 'listByShop').mockResolvedValue([{ id: 'ch-1' }, { id: 'ch-2' }]);
    jest.spyOn(metaChannelService, 'getSettings').mockResolvedValue({ automation_mode: 'AI_ACTIVE' });
    jest.spyOn(metaChannelService, 'updateSettings').mockResolvedValue({});
    jest.spyOn(shopService, 'updateShopAiSettings').mockResolvedValue({});

    const res = await adminService.emergencyDisableAi('shop-1', 'admin-1');

    expect(metaChannelService.updateSettings).toHaveBeenCalledWith('ch-1', { automation_mode: 'MANUAL' });
    expect(metaChannelService.updateSettings).toHaveBeenCalledWith('ch-2', { automation_mode: 'MANUAL' });
    expect(shopService.updateShopAiSettings).toHaveBeenCalledWith('shop-1', 'admin-1', { automation_mode: 'MANUAL' });
    expect(res.after).toEqual({ automation_mode: 'MANUAL', channelsAffected: 2 });
  });
});
