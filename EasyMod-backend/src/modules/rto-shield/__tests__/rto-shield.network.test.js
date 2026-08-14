'use strict';

/**
 * rto-shield.network.test.js
 *
 * Unit tests for the cross-shop "network" behavior of RtoShieldService:
 *  - getNetworkStats aggregation
 *  - evaluateNetworkPromotion thresholds (promote / hold / refresh)
 *  - checkPhone risk tiers (block / verify / clear), whitelist override, enforce opt-out
 *  - whitelistPhone appeal path
 *
 * The two Sequelize entities are mocked; the real phone validator is used.
 */

const mockBlacklistFindOne = jest.fn();
const mockBlacklistCreate = jest.fn();
const mockStatsFindOne = jest.fn();

jest.mock('../rto-blacklist.entity', () => ({
  findOne: (...a) => mockBlacklistFindOne(...a),
  create: (...a) => mockBlacklistCreate(...a),
  findAndCountAll: jest.fn()
}));

jest.mock('../customer-delivery-stats.entity', () => ({
  findOne: (...a) => mockStatsFindOne(...a),
  findOrCreate: jest.fn()
}));

const RtoShieldService = require('../rto-shield.service');
const { THRESHOLDS, TIERS, WHITELIST_REASON } = RtoShieldService;

const PHONE = '01712345678';

beforeEach(() => {
  mockBlacklistFindOne.mockReset();
  mockBlacklistCreate.mockReset();
  mockStatsFindOne.mockReset();
  mockBlacklistCreate.mockImplementation(async (row) => ({ ...row, update: jest.fn() }));
});

describe('getNetworkStats', () => {
  it('aggregates distinct shops, attempts, rtos and computes rate', async () => {
    mockStatsFindOne.mockResolvedValueOnce({ shops_reported: '4', total_attempts: '10', total_rtos: '6' });
    const stats = await RtoShieldService.getNetworkStats(PHONE);
    expect(stats).toEqual({ shops_reported: 4, total_attempts: 10, total_rtos: 6, rto_rate: 0.6 });
  });

  it('returns zeros for an invalid phone without querying', async () => {
    const stats = await RtoShieldService.getNetworkStats('not-a-phone');
    expect(stats).toEqual({ shops_reported: 0, total_attempts: 0, total_rtos: 0, rto_rate: 0 });
    expect(mockStatsFindOne).not.toHaveBeenCalled();
  });
});

describe('evaluateNetworkPromotion', () => {
  it('does NOT promote when too few shops report', async () => {
    mockStatsFindOne.mockResolvedValueOnce({ shops_reported: '2', total_attempts: '8', total_rtos: '6' });
    const result = await RtoShieldService.evaluateNetworkPromotion(PHONE);
    expect(result).toBeNull();
    expect(mockBlacklistCreate).not.toHaveBeenCalled();
  });

  it('promotes to a global blacklist entry when cross-shop thresholds are crossed', async () => {
    mockStatsFindOne.mockResolvedValueOnce({
      shops_reported: String(THRESHOLDS.NETWORK_MIN_SHOPS),
      total_attempts: String(THRESHOLDS.NETWORK_MIN_ATTEMPTS),
      total_rtos: String(THRESHOLDS.NETWORK_MIN_ATTEMPTS) // 100% rate
    });
    mockBlacklistFindOne.mockResolvedValueOnce(null); // no existing global entry
    await RtoShieldService.evaluateNetworkPromotion(PHONE);
    expect(mockBlacklistCreate).toHaveBeenCalledTimes(1);
    const created = mockBlacklistCreate.mock.calls[0][0];
    expect(created.is_global).toBe(true);
    expect(created.shop_id).toBeNull();
    expect(created.risk_score).toBeGreaterThanOrEqual(THRESHOLDS.BLOCK_SCORE);
  });

  it('refreshes (not downgrades) an existing global entry', async () => {
    mockStatsFindOne.mockResolvedValueOnce({ shops_reported: '5', total_attempts: '10', total_rtos: '6' }); // 60%
    const update = jest.fn();
    mockBlacklistFindOne.mockResolvedValueOnce({ risk_score: 95, update });
    await RtoShieldService.evaluateNetworkPromotion(PHONE);
    expect(mockBlacklistCreate).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ risk_score: 95 })); // keeps the higher score
  });
});

describe('checkPhone tiers', () => {
  it('returns BLOCK tier for a high-risk blacklist entry', async () => {
    mockBlacklistFindOne
      .mockResolvedValueOnce(null) // whitelist lookup
      .mockResolvedValueOnce({ risk_score: 85, reason: 'fraud', toJSON: () => ({ risk_score: 85 }) }); // entry
    mockStatsFindOne.mockResolvedValueOnce({ id: 'local-record' });
    mockStatsFindOne.mockResolvedValueOnce({ shops_reported: '1', total_attempts: '2', total_rtos: '2' });
    const res = await RtoShieldService.checkPhone(PHONE, 'shop-1');
    expect(res.tier).toBe(TIERS.TIER_BLOCK);
    expect(res.flagged).toBe(true);
  });

  it('returns VERIFY tier from a strong network signal with no blacklist entry', async () => {
    mockBlacklistFindOne
      .mockResolvedValueOnce(null) // whitelist
      .mockResolvedValueOnce(null); // no entry
    mockStatsFindOne.mockResolvedValueOnce({ id: 'local-record' });
    mockStatsFindOne.mockResolvedValueOnce({ shops_reported: '3', total_attempts: '6', total_rtos: '4' }); // 66%
    const res = await RtoShieldService.checkPhone(PHONE, 'shop-1');
    expect(res.tier).toBe(TIERS.TIER_VERIFY);
    expect(res.flagged).toBe(false);
  });

  it('returns CLEAR tier for a clean phone', async () => {
    mockBlacklistFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    mockStatsFindOne.mockResolvedValueOnce({ id: 'local-record' });
    mockStatsFindOne.mockResolvedValueOnce({ shops_reported: '1', total_attempts: '3', total_rtos: '0' });
    const res = await RtoShieldService.checkPhone(PHONE, 'shop-1');
    expect(res.tier).toBe(TIERS.TIER_CLEAR);
  });

  it('honors a per-shop whitelist override (returns clear)', async () => {
    mockBlacklistFindOne.mockResolvedValueOnce({ reason: WHITELIST_REASON }); // whitelist hit
    mockStatsFindOne.mockResolvedValueOnce({ id: 'local-record' });
    mockStatsFindOne.mockResolvedValueOnce({ shops_reported: '3', total_attempts: '6', total_rtos: '5' });
    const res = await RtoShieldService.checkPhone(PHONE, 'shop-1');
    expect(res.flagged).toBe(false);
    expect(res.tier).toBe(TIERS.TIER_CLEAR);
  });

  it('ignores global/network signals when enforceNetwork is false', async () => {
    mockBlacklistFindOne
      .mockResolvedValueOnce(null) // whitelist
      .mockResolvedValueOnce(null); // own-list entry (global excluded by filter)
    const res = await RtoShieldService.checkPhone(PHONE, 'shop-1', { enforceNetwork: false });
    expect(res.network).toBeNull();
    expect(res.tier).toBe(TIERS.TIER_CLEAR);
    expect(mockStatsFindOne).not.toHaveBeenCalled();
  });
});

describe('whitelistPhone', () => {
  it('creates a sentinel appeal entry for the shop', async () => {
    mockBlacklistFindOne.mockResolvedValueOnce(null);
    await RtoShieldService.whitelistPhone({ phone: PHONE, shop_id: 'shop-1', added_by: 'user-1' });
    const created = mockBlacklistCreate.mock.calls[0][0];
    expect(created.reason).toBe(WHITELIST_REASON);
    expect(created.risk_score).toBe(0);
    expect(created.shop_id).toBe('shop-1');
  });

  it('throws without a shop_id', async () => {
    await expect(RtoShieldService.whitelistPhone({ phone: PHONE })).rejects.toThrow(/shop_id/);
  });
});
