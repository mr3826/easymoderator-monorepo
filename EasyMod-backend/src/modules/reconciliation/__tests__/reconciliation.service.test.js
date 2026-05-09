'use strict';

/**
 * Tests for ReconciliationService
 *
 * Mocks:
 *  - ./courier-collection.entity      (CourierCodCollection)
 *  - ./reconciliation-dispute.entity  (ReconciliationDispute)
 *  - ../entities                      ({ DeliveryIntegration, Order })
 *  - ../delivery/delivery.service     (singleton deliveryService)
 *  - ../../utils/structured-logger    (no-op logger)
 *  - uuid
 *  - sequelize
 *
 * Discrepancy thresholds under test:
 *   flat:  > ৳100
 *   pct:   > 5% of claimed amount
 */

jest.mock('../courier-collection.entity', () => ({
  findOrCreate: jest.fn(),
}));

jest.mock('../reconciliation-dispute.entity', () => ({
  create: jest.fn(),
}));

jest.mock('../entities', () => ({
  DeliveryIntegration: { findOne: jest.fn() },
  Order: { findAll: jest.fn() },
}));

jest.mock('../delivery/delivery.service', () => ({
  getProviderInstance: jest.fn(),
}));

jest.mock('../../utils/structured-logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

jest.mock('sequelize', () => ({
  Op: {
    or: Symbol('or'),
    and: Symbol('and'),
    like: Symbol('like'),
    in: Symbol('in'),
  },
}));

const CourierCodCollection = require('../courier-collection.entity');
const ReconciliationDispute = require('../reconciliation-dispute.entity');
const { DeliveryIntegration, Order } = require('../entities');
const deliveryService = require('../delivery/delivery.service');
const ReconciliationService = require('../reconciliation.service');

const SHOP_ID = 'shop-abc';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCollection(overrides = {}) {
  return { id: 'col-uuid', shop_id: SHOP_ID, provider: 'steadfast', ...overrides };
}

function makeRawPayment(overrides = {}) {
  return {
    id: 'pay-001',
    amount: '1000',
    date: '2026-05-01',
    consignment_ids: ['c-1', 'c-2'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// pullSteadfastPayments
// ---------------------------------------------------------------------------

describe('ReconciliationService.pullSteadfastPayments', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws when no active Steadfast integration exists', async () => {
    DeliveryIntegration.findOne.mockResolvedValue(null);

    await expect(
      ReconciliationService.pullSteadfastPayments(SHOP_ID)
    ).rejects.toThrow('No active Steadfast integration for this shop');
  });

  test('processes a list of payments and returns correct counts', async () => {
    DeliveryIntegration.findOne.mockResolvedValue({ shop_id: SHOP_ID, provider: 'steadfast' });

    const mockProvider = {
      getPayments: jest.fn().mockResolvedValue([makeRawPayment(), makeRawPayment({ id: 'pay-002' })]),
    };
    deliveryService.getProviderInstance.mockResolvedValue(mockProvider);

    const col1 = makeCollection({ id: 'col-1' });
    const col2 = makeCollection({ id: 'col-2' });

    // First payment: no dispute; second payment: dispute created
    CourierCodCollection.findOrCreate
      .mockResolvedValueOnce([col1, true])  // new
      .mockResolvedValueOnce([col2, true]); // new

    // calculateExpectedAmount: Order.findAll returns empty → fallback used → no discrepancy
    Order.findAll.mockResolvedValue([]);

    const result = await ReconciliationService.pullSteadfastPayments(SHOP_ID);

    expect(result.collected).toBe(2);
    expect(result.disputes).toBe(0);
  });

  test('counts dispute when a payment triggers auto-dispute', async () => {
    DeliveryIntegration.findOne.mockResolvedValue({ shop_id: SHOP_ID, provider: 'steadfast' });

    const mockProvider = {
      getPayments: jest.fn().mockResolvedValue([makeRawPayment({ amount: '2000' })]),
    };
    deliveryService.getProviderInstance.mockResolvedValue(mockProvider);

    const col = makeCollection();
    CourierCodCollection.findOrCreate.mockResolvedValue([col, true]);

    // Order returns a lower amount → discrepancy > ৳100 → dispute
    Order.findAll.mockResolvedValue([
      { total: '1500', delivery_fee: '100' }, // COD = 1400 vs claimed 2000 → diff 600 > 100
    ]);

    ReconciliationDispute.create.mockResolvedValue({ id: 'dispute-uuid' });

    const result = await ReconciliationService.pullSteadfastPayments(SHOP_ID);

    expect(result.collected).toBe(1);
    expect(result.disputes).toBe(1);
  });

  test('handles provider returning object with .data wrapper', async () => {
    DeliveryIntegration.findOne.mockResolvedValue({ shop_id: SHOP_ID, provider: 'steadfast' });

    const mockProvider = {
      getPayments: jest.fn().mockResolvedValue({ data: [makeRawPayment()] }),
    };
    deliveryService.getProviderInstance.mockResolvedValue(mockProvider);

    CourierCodCollection.findOrCreate.mockResolvedValue([makeCollection(), true]);
    Order.findAll.mockResolvedValue([]);

    const result = await ReconciliationService.pullSteadfastPayments(SHOP_ID);

    expect(result.collected).toBe(1);
  });

  test('handles provider returning object with .payments wrapper', async () => {
    DeliveryIntegration.findOne.mockResolvedValue({ shop_id: SHOP_ID, provider: 'steadfast' });

    const mockProvider = {
      getPayments: jest.fn().mockResolvedValue({ payments: [makeRawPayment()] }),
    };
    deliveryService.getProviderInstance.mockResolvedValue(mockProvider);

    CourierCodCollection.findOrCreate.mockResolvedValue([makeCollection(), true]);
    Order.findAll.mockResolvedValue([]);

    const result = await ReconciliationService.pullSteadfastPayments(SHOP_ID);

    expect(result.collected).toBe(1);
  });

  test('skips failed recordPayment calls and does not throw', async () => {
    DeliveryIntegration.findOne.mockResolvedValue({ shop_id: SHOP_ID, provider: 'steadfast' });

    const mockProvider = {
      getPayments: jest.fn().mockResolvedValue([makeRawPayment(), makeRawPayment({ id: 'pay-002' })]),
    };
    deliveryService.getProviderInstance.mockResolvedValue(mockProvider);

    // First payment succeeds, second throws
    CourierCodCollection.findOrCreate
      .mockResolvedValueOnce([makeCollection(), true])
      .mockRejectedValueOnce(new Error('DB error'));

    Order.findAll.mockResolvedValue([]);

    const result = await ReconciliationService.pullSteadfastPayments(SHOP_ID);

    expect(result.collected).toBe(1); // only one succeeded
    expect(result.disputes).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// recordPayment
// ---------------------------------------------------------------------------

describe('ReconciliationService.recordPayment', () => {
  beforeEach(() => jest.clearAllMocks());

  test('skips processing when payment was already recorded (findOrCreate returns created=false)', async () => {
    const existing = makeCollection();
    CourierCodCollection.findOrCreate.mockResolvedValue([existing, false]);

    const result = await ReconciliationService.recordPayment(SHOP_ID, 'steadfast', makeRawPayment());

    expect(Order.findAll).not.toHaveBeenCalled();
    expect(ReconciliationDispute.create).not.toHaveBeenCalled();
    expect(result.dispute).toBeNull();
    expect(result.collection).toBe(existing);
  });

  test('new record with matching amounts (no discrepancy) → no dispute created', async () => {
    const col = makeCollection();
    CourierCodCollection.findOrCreate.mockResolvedValue([col, true]);

    // claimed = 1000, order COD = 1000-0 = 1000 → exact match
    Order.findAll.mockResolvedValue([
      { total: '1000', delivery_fee: '0' },
    ]);

    const result = await ReconciliationService.recordPayment(SHOP_ID, 'steadfast', makeRawPayment({ amount: '1000' }));

    expect(ReconciliationDispute.create).not.toHaveBeenCalled();
    expect(result.dispute).toBeNull();
  });

  test('creates dispute when discrepancy exceeds ৳100 flat threshold', async () => {
    const col = makeCollection();
    CourierCodCollection.findOrCreate.mockResolvedValue([col, true]);

    // claimed = 2000, COD = 1890 → diff = 110 > 100
    Order.findAll.mockResolvedValue([
      { total: '1990', delivery_fee: '100' }, // COD = 1890
    ]);

    ReconciliationDispute.create.mockResolvedValue({ id: 'dispute-1' });

    const result = await ReconciliationService.recordPayment(SHOP_ID, 'steadfast', makeRawPayment({ amount: '2000' }));

    expect(ReconciliationDispute.create).toHaveBeenCalledTimes(1);
    expect(ReconciliationDispute.create).toHaveBeenCalledWith(
      expect.objectContaining({
        claimed_amount: 2000,
        expected_amount: 1890,
        dispute_status: 'open',
      })
    );
    expect(result.dispute).toEqual({ id: 'dispute-1' });
  });

  test('creates dispute when discrepancy exceeds 5% of claimed (percentage threshold)', async () => {
    const col = makeCollection();
    CourierCodCollection.findOrCreate.mockResolvedValue([col, true]);

    // claimed = 1000, COD = 940 → diff = 60 (6% > 5%, but ≤ ৳100)
    Order.findAll.mockResolvedValue([
      { total: '1000', delivery_fee: '60' }, // COD = 940
    ]);

    ReconciliationDispute.create.mockResolvedValue({ id: 'dispute-2' });

    const result = await ReconciliationService.recordPayment(SHOP_ID, 'steadfast', makeRawPayment({ amount: '1000' }));

    expect(ReconciliationDispute.create).toHaveBeenCalledTimes(1);
    expect(result.dispute).toBeDefined();
  });

  test('no dispute when discrepancy is below both thresholds (≤5% AND ≤৳100)', async () => {
    const col = makeCollection();
    CourierCodCollection.findOrCreate.mockResolvedValue([col, true]);

    // claimed = 1000, COD = 960 → diff = 40 (4% < 5% AND 40 < 100)
    Order.findAll.mockResolvedValue([
      { total: '1000', delivery_fee: '40' }, // COD = 960
    ]);

    const result = await ReconciliationService.recordPayment(SHOP_ID, 'steadfast', makeRawPayment({ amount: '1000' }));

    expect(ReconciliationDispute.create).not.toHaveBeenCalled();
    expect(result.dispute).toBeNull();
  });

  test('reads payment_id field as fallback for payment reference', async () => {
    const col = makeCollection();
    CourierCodCollection.findOrCreate.mockResolvedValue([col, true]);
    Order.findAll.mockResolvedValue([]);

    await ReconciliationService.recordPayment(SHOP_ID, 'steadfast', {
      payment_id: 'ref-99',
      total_amount: '500',
      payment_date: '2026-05-01',
      consignment_ids: [],
    });

    expect(CourierCodCollection.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ payment_reference: 'ref-99' }),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// calculateExpectedAmount
// ---------------------------------------------------------------------------

describe('ReconciliationService.calculateExpectedAmount', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns fallback when consignmentIds array is empty', async () => {
    const result = await ReconciliationService.calculateExpectedAmount(SHOP_ID, [], 999);

    expect(Order.findAll).not.toHaveBeenCalled();
    expect(result).toBe(999);
  });

  test('returns fallback when no matching orders found in DB', async () => {
    Order.findAll.mockResolvedValue([]);

    const result = await ReconciliationService.calculateExpectedAmount(SHOP_ID, ['c-1', 'c-2'], 500);

    expect(result).toBe(500);
  });

  test('sums COD (total - delivery_fee) across matched orders', async () => {
    Order.findAll.mockResolvedValue([
      { total: '1000', delivery_fee: '100' }, // COD = 900
      { total: '500', delivery_fee: '50' },   // COD = 450
    ]);

    const result = await ReconciliationService.calculateExpectedAmount(SHOP_ID, ['c-1', 'c-2'], 0);

    expect(result).toBeCloseTo(1350, 2);
  });

  test('handles missing delivery_fee (defaults to 0)', async () => {
    Order.findAll.mockResolvedValue([
      { total: '800', delivery_fee: null },
    ]);

    const result = await ReconciliationService.calculateExpectedAmount(SHOP_ID, ['c-1'], 0);

    expect(result).toBeCloseTo(800, 2);
  });

  test('handles missing total (defaults to 0)', async () => {
    Order.findAll.mockResolvedValue([
      { total: null, delivery_fee: '50' },
    ]);

    const result = await ReconciliationService.calculateExpectedAmount(SHOP_ID, ['c-1'], 0);

    expect(result).toBeCloseTo(-50, 2);
  });

  test('queries DB with the provided shopId and consignmentIds', async () => {
    Order.findAll.mockResolvedValue([{ total: '1000', delivery_fee: '100' }]);

    await ReconciliationService.calculateExpectedAmount(SHOP_ID, ['c-1', 'c-2'], 0);

    expect(Order.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ shop_id: SHOP_ID }),
      })
    );
  });
});
