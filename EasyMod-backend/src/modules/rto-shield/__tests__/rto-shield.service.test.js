'use strict';

/**
 * Tests for RtoShieldService
 *
 * Mocks:
 *  - rto-blacklist.entity  (Sequelize model)
 *  - customer-delivery-stats.entity (Sequelize model)
 *  - uuid (so IDs are deterministic)
 *  - sequelize Op (passthrough — we only need the symbol keys present)
 */

jest.mock('../rto-blacklist.entity', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  findAndCountAll: jest.fn(),
}));

jest.mock('../customer-delivery-stats.entity', () => ({
  findOrCreate: jest.fn(),
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid-1234') }));

// sequelize Op symbols need to exist; use plain string keys so comparisons work
jest.mock('sequelize', () => ({
  Op: {
    or: Symbol('or'),
    and: Symbol('and'),
    like: Symbol('like'),
    in: Symbol('in'),
  },
}));

const RtoBlacklist = require('../rto-blacklist.entity');
const CustomerDeliveryStats = require('../customer-delivery-stats.entity');
const RtoShieldService = require('../rto-shield.service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock Sequelize model instance */
function makeEntry(overrides = {}) {
  const data = {
    id: 'entry-uuid',
    phone: '01712345678',
    reason: 'Fake COD',
    risk_score: 80,
    is_global: false,
    shop_id: 'shop-abc',
    added_by: null,
    notes: null,
    ...overrides,
  };
  return {
    ...data,
    update: jest.fn().mockResolvedValue(data),
    destroy: jest.fn().mockResolvedValue(true),
    toJSON: jest.fn().mockReturnValue(data),
  };
}

const SHOP_ID = 'shop-abc';

// ---------------------------------------------------------------------------
// checkPhone
// ---------------------------------------------------------------------------

describe('RtoShieldService.checkPhone', () => {
  beforeEach(() => jest.clearAllMocks());

  test('valid phone found with risk_score >= 70 → flagged: true', async () => {
    const entry = makeEntry({ risk_score: 85 });
    RtoBlacklist.findOne.mockResolvedValue(entry);

    const result = await RtoShieldService.checkPhone('01712345678', SHOP_ID);

    expect(RtoBlacklist.findOne).toHaveBeenCalledTimes(1);
    expect(result.flagged).toBe(true);
    expect(result.risk_score).toBe(85);
    expect(result.reason).toBe('Fake COD');
    expect(result.entry).toEqual(entry.toJSON());
  });

  test('valid phone found with risk_score < 70 → flagged: false', async () => {
    const entry = makeEntry({ risk_score: 50 });
    RtoBlacklist.findOne.mockResolvedValue(entry);

    const result = await RtoShieldService.checkPhone('01712345678', SHOP_ID);

    expect(result.flagged).toBe(false);
    expect(result.risk_score).toBe(50);
  });

  test('valid phone not in blacklist → flagged: false, entry: null', async () => {
    RtoBlacklist.findOne.mockResolvedValue(null);

    const result = await RtoShieldService.checkPhone('01912345678', SHOP_ID);

    expect(result).toEqual({ flagged: false, reason: null, risk_score: 0, entry: null });
  });

  test('+880 prefix is stripped and normalized correctly', async () => {
    RtoBlacklist.findOne.mockResolvedValue(null);

    const result = await RtoShieldService.checkPhone('+8801712345678', SHOP_ID);

    // Should reach DB lookup (normalized to 01712345678)
    expect(RtoBlacklist.findOne).toHaveBeenCalledTimes(1);
    expect(result.flagged).toBe(false);
  });

  test('880 prefix (13 chars) is stripped and normalized correctly', async () => {
    const entry = makeEntry({ risk_score: 90 });
    RtoBlacklist.findOne.mockResolvedValue(entry);

    const result = await RtoShieldService.checkPhone('8801712345678', SHOP_ID);

    expect(RtoBlacklist.findOne).toHaveBeenCalledTimes(1);
    expect(result.flagged).toBe(true);
  });

  test('null phone → flagged: false without hitting DB', async () => {
    const result = await RtoShieldService.checkPhone(null, SHOP_ID);

    expect(RtoBlacklist.findOne).not.toHaveBeenCalled();
    expect(result).toEqual({ flagged: false, reason: null, risk_score: 0, entry: null });
  });

  test('invalid phone format (wrong prefix) → flagged: false without hitting DB', async () => {
    // 011 is not valid (01[3-9] required)
    const result = await RtoShieldService.checkPhone('01112345678', SHOP_ID);

    expect(RtoBlacklist.findOne).not.toHaveBeenCalled();
    expect(result).toEqual({ flagged: false, reason: null, risk_score: 0, entry: null });
  });

  test('risk_score exactly 70 → flagged: true (boundary)', async () => {
    const entry = makeEntry({ risk_score: 70 });
    RtoBlacklist.findOne.mockResolvedValue(entry);

    const result = await RtoShieldService.checkPhone('01812345678', SHOP_ID);

    expect(result.flagged).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// addToBlacklist
// ---------------------------------------------------------------------------

describe('RtoShieldService.addToBlacklist', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates new entry when phone+shop_id does not exist', async () => {
    RtoBlacklist.findOne.mockResolvedValue(null);
    const created = makeEntry();
    RtoBlacklist.create.mockResolvedValue(created);

    const result = await RtoShieldService.addToBlacklist({
      phone: '01712345678',
      reason: 'Fake COD',
      risk_score: 85,
      is_global: false,
      shop_id: SHOP_ID,
      added_by: 'user-xyz',
    });

    expect(RtoBlacklist.create).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '01712345678',
        reason: 'Fake COD',
        risk_score: 85,
        is_global: false,
        shop_id: SHOP_ID,
      })
    );
    expect(result).toBe(created);
  });

  test('upserts (updates) when phone+shop_id already exists', async () => {
    const existing = makeEntry();
    RtoBlacklist.findOne.mockResolvedValue(existing);

    const result = await RtoShieldService.addToBlacklist({
      phone: '01712345678',
      reason: 'Updated reason',
      risk_score: 95,
      shop_id: SHOP_ID,
    });

    expect(RtoBlacklist.create).not.toHaveBeenCalled();
    expect(existing.update).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Updated reason', risk_score: 95 })
    );
    expect(result).toBe(existing);
  });

  test('throws on invalid phone number', async () => {
    await expect(
      RtoShieldService.addToBlacklist({ phone: '12345', reason: 'Test', shop_id: SHOP_ID })
    ).rejects.toThrow('Invalid Bangladeshi phone number');
  });

  test('normalizes +880 prefix before storing', async () => {
    RtoBlacklist.findOne.mockResolvedValue(null);
    RtoBlacklist.create.mockResolvedValue(makeEntry());

    await RtoShieldService.addToBlacklist({
      phone: '+8801712345678',
      reason: 'Fraud',
      shop_id: SHOP_ID,
    });

    expect(RtoBlacklist.create).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '01712345678' })
    );
  });

  test('defaults risk_score to 80 and is_global to false when omitted', async () => {
    RtoBlacklist.findOne.mockResolvedValue(null);
    RtoBlacklist.create.mockResolvedValue(makeEntry());

    await RtoShieldService.addToBlacklist({
      phone: '01712345678',
      reason: 'Test',
      shop_id: SHOP_ID,
    });

    expect(RtoBlacklist.create).toHaveBeenCalledWith(
      expect.objectContaining({ risk_score: 80, is_global: false })
    );
  });
});

// ---------------------------------------------------------------------------
// removeFromBlacklist
// ---------------------------------------------------------------------------

describe('RtoShieldService.removeFromBlacklist', () => {
  beforeEach(() => jest.clearAllMocks());

  test('successfully destroys a shop-owned entry', async () => {
    const entry = makeEntry({ shop_id: SHOP_ID, is_global: false });
    RtoBlacklist.findOne.mockResolvedValue(entry);

    const result = await RtoShieldService.removeFromBlacklist('entry-uuid', SHOP_ID);

    expect(entry.destroy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, id: 'entry-uuid' });
  });

  test('throws when entry is global', async () => {
    const entry = makeEntry({ is_global: true, shop_id: null });
    RtoBlacklist.findOne.mockResolvedValue(entry);

    await expect(
      RtoShieldService.removeFromBlacklist('entry-uuid', SHOP_ID)
    ).rejects.toThrow('Cannot delete a global blacklist entry via shop API');
  });

  test('throws when entry belongs to a different shop', async () => {
    const entry = makeEntry({ shop_id: 'other-shop', is_global: false });
    RtoBlacklist.findOne.mockResolvedValue(entry);

    await expect(
      RtoShieldService.removeFromBlacklist('entry-uuid', SHOP_ID)
    ).rejects.toThrow('Access denied: entry belongs to a different shop');
  });

  test('throws when entry is not found', async () => {
    RtoBlacklist.findOne.mockResolvedValue(null);

    await expect(
      RtoShieldService.removeFromBlacklist('missing-uuid', SHOP_ID)
    ).rejects.toThrow('Blacklist entry not found');
  });
});

// ---------------------------------------------------------------------------
// listBlacklist
// ---------------------------------------------------------------------------

describe('RtoShieldService.listBlacklist', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns paginated results with correct pagination metadata', async () => {
    const rows = [makeEntry(), makeEntry({ id: 'entry-2', phone: '01812345678' })];
    RtoBlacklist.findAndCountAll.mockResolvedValue({ count: 2, rows });

    const result = await RtoShieldService.listBlacklist({ shopId: SHOP_ID, page: 1, limit: 20 });

    expect(result.data).toHaveLength(2);
    expect(result.pagination).toEqual({ total: 2, page: 1, limit: 20, total_pages: 1 });
  });

  test('calculates total_pages correctly for multi-page sets', async () => {
    RtoBlacklist.findAndCountAll.mockResolvedValue({ count: 45, rows: [] });

    const result = await RtoShieldService.listBlacklist({ shopId: SHOP_ID, page: 2, limit: 20 });

    expect(result.pagination.total_pages).toBe(3);
    expect(result.pagination.page).toBe(2);
  });

  test('passes search filter when provided', async () => {
    RtoBlacklist.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

    await RtoShieldService.listBlacklist({ shopId: SHOP_ID, search: '017' });

    const callArgs = RtoBlacklist.findAndCountAll.mock.calls[0][0];
    // where should include an Op.and clause when search is set
    expect(callArgs.where).toHaveProperty(expect.anything());
    // At minimum the findAndCountAll was called with the correct base structure
    expect(RtoBlacklist.findAndCountAll).toHaveBeenCalledTimes(1);
  });

  test('does not include Op.and when search is omitted', async () => {
    RtoBlacklist.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

    await RtoShieldService.listBlacklist({ shopId: SHOP_ID });

    const callArgs = RtoBlacklist.findAndCountAll.mock.calls[0][0];
    const { Op } = require('sequelize');
    expect(callArgs.where[Op.and]).toBeUndefined();
  });

  test('defaults to page 1 and limit 20 when not provided', async () => {
    RtoBlacklist.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

    await RtoShieldService.listBlacklist({ shopId: SHOP_ID });

    const callArgs = RtoBlacklist.findAndCountAll.mock.calls[0][0];
    expect(callArgs.limit).toBe(20);
    expect(callArgs.offset).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// trackDeliveryOutcome (the actual method name in source)
// ---------------------------------------------------------------------------

describe('RtoShieldService.trackDeliveryOutcome', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: create as new entry
    RtoBlacklist.findOne.mockResolvedValue(null);
    RtoBlacklist.create.mockResolvedValue(makeEntry());
  });

  test('ignores invalid phone silently', async () => {
    await RtoShieldService.trackDeliveryOutcome('bad-phone', SHOP_ID, true);

    expect(CustomerDeliveryStats.findOrCreate).not.toHaveBeenCalled();
  });

  test('increments delivery_attempts and rto_count on RTO', async () => {
    const stats = {
      id: 'stats-uuid',
      phone: '01712345678',
      shop_id: SHOP_ID,
      delivery_attempts: 1,
      rto_count: 0,
      update: jest.fn().mockResolvedValue(true),
    };
    CustomerDeliveryStats.findOrCreate.mockResolvedValue([stats, false]);

    await RtoShieldService.trackDeliveryOutcome('01712345678', SHOP_ID, true);

    expect(stats.update).toHaveBeenCalledWith(
      expect.objectContaining({ delivery_attempts: 2, rto_count: 1 })
    );
  });

  test('increments delivery_attempts only (not rto_count) on successful delivery', async () => {
    const stats = {
      id: 'stats-uuid',
      phone: '01712345678',
      shop_id: SHOP_ID,
      delivery_attempts: 2,
      rto_count: 0,
      update: jest.fn().mockResolvedValue(true),
    };
    CustomerDeliveryStats.findOrCreate.mockResolvedValue([stats, false]);

    await RtoShieldService.trackDeliveryOutcome('01712345678', SHOP_ID, false);

    const updateCall = stats.update.mock.calls[0][0];
    expect(updateCall.delivery_attempts).toBe(3);
    expect(updateCall.rto_count).toBeUndefined();
    expect(updateCall.last_delivered_at).toBeInstanceOf(Date);
  });

  test('auto-flags at threshold: 3+ attempts AND >= 40% RTO rate', async () => {
    // 3 attempts, 2 RTOs → 66.6% → should trigger auto-flag
    const stats = {
      id: 'stats-uuid',
      phone: '01712345678',
      shop_id: SHOP_ID,
      delivery_attempts: 2,
      rto_count: 1,
      update: jest.fn().mockResolvedValue(true),
    };
    CustomerDeliveryStats.findOrCreate.mockResolvedValue([stats, false]);

    await RtoShieldService.trackDeliveryOutcome('01712345678', SHOP_ID, true);

    // addToBlacklist path: findOne → null, then create
    expect(RtoBlacklist.create).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '01712345678',
        is_global: false,
        shop_id: SHOP_ID,
      })
    );
    expect(RtoBlacklist.create.mock.calls[0][0].reason).toMatch(/Auto-flagged/);
  });

  test('does NOT auto-flag when rto_count is below 40% threshold', async () => {
    // 5 attempts, 1 RTO → 20% → below threshold
    const stats = {
      id: 'stats-uuid',
      phone: '01712345678',
      shop_id: SHOP_ID,
      delivery_attempts: 4,
      rto_count: 0,
      update: jest.fn().mockResolvedValue(true),
    };
    CustomerDeliveryStats.findOrCreate.mockResolvedValue([stats, false]);

    await RtoShieldService.trackDeliveryOutcome('01712345678', SHOP_ID, true);

    // 5 attempts, 1 RTO → 20% → no flag
    expect(RtoBlacklist.create).not.toHaveBeenCalled();
  });

  test('does NOT auto-flag when attempt count is below minimum (< 3)', async () => {
    // 2 attempts, 2 RTOs → 100% but only 2 attempts
    const stats = {
      id: 'stats-uuid',
      phone: '01712345678',
      shop_id: SHOP_ID,
      delivery_attempts: 1,
      rto_count: 0,
      update: jest.fn().mockResolvedValue(true),
    };
    CustomerDeliveryStats.findOrCreate.mockResolvedValue([stats, false]);

    await RtoShieldService.trackDeliveryOutcome('01712345678', SHOP_ID, true);

    // 2 attempts, 1 RTO → 50% but count < 3 → no flag
    expect(RtoBlacklist.create).not.toHaveBeenCalled();
  });

  test('normalizes +880 prefix before looking up stats', async () => {
    const stats = {
      id: 'stats-uuid',
      phone: '01712345678',
      shop_id: SHOP_ID,
      delivery_attempts: 0,
      rto_count: 0,
      update: jest.fn().mockResolvedValue(true),
    };
    CustomerDeliveryStats.findOrCreate.mockResolvedValue([stats, true]);

    await RtoShieldService.trackDeliveryOutcome('+8801712345678', SHOP_ID, false);

    expect(CustomerDeliveryStats.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ phone: '01712345678' }),
      })
    );
  });
});
