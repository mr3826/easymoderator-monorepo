'use strict';

/**
 * referral.service.test.js
 *
 * Unit tests for the invite-a-shop acquisition loop:
 *  - recordReferral: resolves the referrer by code, rewards both sides, is idempotent,
 *    rejects self-referral and unknown codes
 *  - getReferralStats: returns code + aggregated lifetime stats
 *  - lookupCode: validates an invite code without consuming it
 *
 * Shop entity + subscription.service are mocked; no DB is touched.
 */

const mockShopFindOne = jest.fn();
const mockShopFindByPk = jest.fn();
const mockReferralFindOne = jest.fn();
const mockReferralCreate = jest.fn();
const mockGrantBonus = jest.fn();

jest.mock('../../entities', () => ({
  Shop: {
    findOne: (...a) => mockShopFindOne(...a),
    findByPk: (...a) => mockShopFindByPk(...a)
  }
}));

jest.mock('../referral.entity', () => ({
  findOne: (...a) => mockReferralFindOne(...a),
  create: (...a) => mockReferralCreate(...a)
}));

jest.mock('../../subscription/subscription.service', () => ({
  grantBonusConversations: (...a) => mockGrantBonus(...a)
}));

const referralService = require('../referral.service');
const { REFERRER_REWARD, REFERRED_REWARD } = referralService.REWARDS;

const REFERRER_SHOP = { id: 'shop-referrer', shop_name: 'Referrer Shop', name: 'Referrer Shop' };

beforeEach(() => {
  mockShopFindOne.mockReset();
  mockShopFindByPk.mockReset();
  mockReferralFindOne.mockReset();
  mockReferralCreate.mockReset();
  mockGrantBonus.mockReset();
  mockGrantBonus.mockResolvedValue({ granted: true });
  mockReferralCreate.mockImplementation(async (row) => ({ id: 'ref-1', ...row }));
});

describe('recordReferral', () => {
  it('records a referral and rewards both shops', async () => {
    mockShopFindOne.mockResolvedValueOnce(REFERRER_SHOP);
    mockReferralFindOne.mockResolvedValueOnce(null);

    const result = await referralService.recordReferral({
      code: 'abc123',
      referredShopId: 'shop-new',
      referredUserId: 'user-new'
    });

    expect(mockShopFindOne).toHaveBeenCalledWith({ where: { unique_code: 'ABC123' } });
    expect(mockReferralCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        referrer_shop_id: 'shop-referrer',
        referred_shop_id: 'shop-new',
        code: 'ABC123',
        status: 'rewarded'
      })
    );
    expect(mockGrantBonus).toHaveBeenCalledWith('shop-referrer', REFERRER_REWARD, 'referral_reward');
    expect(mockGrantBonus).toHaveBeenCalledWith('shop-new', REFERRED_REWARD, 'referral_welcome');
    expect(result).toMatchObject({ referrer_shop_id: 'shop-referrer' });
  });

  it('returns null for an empty code without querying', async () => {
    const result = await referralService.recordReferral({ code: '', referredShopId: 'shop-new' });
    expect(result).toBeNull();
    expect(mockShopFindOne).not.toHaveBeenCalled();
  });

  it('returns null when the code matches no shop', async () => {
    mockShopFindOne.mockResolvedValueOnce(null);
    const result = await referralService.recordReferral({ code: 'NOPE', referredShopId: 'shop-new' });
    expect(result).toBeNull();
    expect(mockReferralCreate).not.toHaveBeenCalled();
  });

  it('rejects self-referral (same shop)', async () => {
    mockShopFindOne.mockResolvedValueOnce({ ...REFERRER_SHOP, id: 'shop-new' });
    const result = await referralService.recordReferral({ code: 'ABC123', referredShopId: 'shop-new' });
    expect(result).toBeNull();
    expect(mockReferralCreate).not.toHaveBeenCalled();
    expect(mockGrantBonus).not.toHaveBeenCalled();
  });

  it('is idempotent — does not double-reward an already-referred shop', async () => {
    mockShopFindOne.mockResolvedValueOnce(REFERRER_SHOP);
    mockReferralFindOne.mockResolvedValueOnce({ id: 'existing', referred_shop_id: 'shop-new' });
    const result = await referralService.recordReferral({ code: 'ABC123', referredShopId: 'shop-new' });
    expect(result).toMatchObject({ id: 'existing' });
    expect(mockReferralCreate).not.toHaveBeenCalled();
    expect(mockGrantBonus).not.toHaveBeenCalled();
  });
});

describe('getReferralStats', () => {
  it('returns the shop code plus aggregated totals', async () => {
    mockShopFindByPk.mockResolvedValueOnce({ id: 'shop-referrer', unique_code: 'ABC123' });
    mockReferralFindOne.mockResolvedValueOnce({ total_referrals: '3', conversations_earned: '150' });

    const stats = await referralService.getReferralStats('shop-referrer');
    expect(stats).toEqual({ code: 'ABC123', total_referrals: 3, conversations_earned: 150 });
  });

  it('returns zeros when the shop has no referrals yet', async () => {
    mockShopFindByPk.mockResolvedValueOnce({ id: 'shop-x', unique_code: 'XYZ999' });
    mockReferralFindOne.mockResolvedValueOnce(null);
    const stats = await referralService.getReferralStats('shop-x');
    expect(stats).toEqual({ code: 'XYZ999', total_referrals: 0, conversations_earned: 0 });
  });
});

describe('lookupCode', () => {
  it('returns valid + shop name for a known code', async () => {
    mockShopFindOne.mockResolvedValueOnce(REFERRER_SHOP);
    const res = await referralService.lookupCode('abc123');
    expect(res).toEqual({ valid: true, shop_name: 'Referrer Shop' });
  });

  it('returns invalid for an unknown code', async () => {
    mockShopFindOne.mockResolvedValueOnce(null);
    const res = await referralService.lookupCode('NOPE');
    expect(res).toEqual({ valid: false, shop_name: null });
  });
});
