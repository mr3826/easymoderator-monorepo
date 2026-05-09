'use strict';

/**
 * Tests for DeliveryService (singleton instance exported from delivery.service.js)
 *
 * Mocks:
 *  - ./delivery-integration.entity  (DeliveryIntegration Sequelize model)
 *  - ./providers/provider.registry  (COURIER_REGISTRY)
 *
 * DeliveryService is exported as `new DeliveryService()` (singleton).
 * We mock the registry so we can control provider behaviour without
 * real HTTP calls, and mock the entity so we avoid a real DB.
 */

// ---- Mock registry BEFORE requiring the service ----
const mockNormalizePayload = jest.fn();
const mockNormalizeResponse = jest.fn();
const mockCreateOrder = jest.fn();
const MockProviderConstructor = jest.fn().mockImplementation(() => ({
  createOrder: mockCreateOrder,
}));

jest.mock('../providers/provider.registry', () => ({
  COURIER_REGISTRY: {
    steadfast: {
      Provider: MockProviderConstructor,
      label: 'Steadfast',
      normalizePayload: mockNormalizePayload,
      normalizeResponse: mockNormalizeResponse,
      statusMap: {
        delivered: 'delivered',
        cancelled: 'cancelled',
        pending: 'pending',
        'in_review': 'in_review',
      },
      credentialFields: ['api_key', 'secret_key'],
    },
    pathao: {
      Provider: MockProviderConstructor,
      label: 'Pathao',
      normalizePayload: mockNormalizePayload,
      normalizeResponse: mockNormalizeResponse,
      statusMap: {
        Delivered: 'delivered',
        Cancelled: 'cancelled',
      },
      credentialFields: ['client_id', 'client_secret'],
    },
  },
}));

jest.mock('../delivery-integration.entity', () => ({
  findOne: jest.fn(),
}));

const DeliveryIntegration = require('../delivery-integration.entity');
const deliveryService = require('../delivery.service');

const SHOP_ID = 'shop-abc';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIntegration(overrides = {}) {
  return {
    shop_id: SHOP_ID,
    provider: 'steadfast',
    is_active: true,
    is_connected: true,
    credentials: { api_key: 'key-123', secret_key: 'sec-456' },
    metadata: { store_id: 'store-1' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getProviderInstance
// ---------------------------------------------------------------------------

describe('DeliveryService.getProviderInstance', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns a constructed provider instance when integration exists', async () => {
    DeliveryIntegration.findOne.mockResolvedValue(makeIntegration());

    const instance = await deliveryService.getProviderInstance(SHOP_ID, 'steadfast');

    expect(DeliveryIntegration.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ shop_id: SHOP_ID, provider: 'steadfast', is_active: true }),
      })
    );
    expect(MockProviderConstructor).toHaveBeenCalledWith({ api_key: 'key-123', secret_key: 'sec-456' });
    expect(instance).toHaveProperty('createOrder');
  });

  test('throws when no active integration found', async () => {
    DeliveryIntegration.findOne.mockResolvedValue(null);

    await expect(
      deliveryService.getProviderInstance(SHOP_ID, 'steadfast')
    ).rejects.toThrow('No active steadfast integration found for this shop');
  });

  test('throws when provider name is not in registry', async () => {
    DeliveryIntegration.findOne.mockResolvedValue(makeIntegration({ provider: 'unknown_courier' }));

    await expect(
      deliveryService.getProviderInstance(SHOP_ID, 'unknown_courier')
    ).rejects.toThrow('Unknown provider: unknown_courier');
  });

  test('passes credentials from integration to provider constructor', async () => {
    const creds = { api_key: 'secret-api', secret_key: 'secret-sec' };
    DeliveryIntegration.findOne.mockResolvedValue(makeIntegration({ credentials: creds }));

    await deliveryService.getProviderInstance(SHOP_ID, 'steadfast');

    expect(MockProviderConstructor).toHaveBeenCalledWith(creds);
  });
});

// ---------------------------------------------------------------------------
// getActiveProvider
// ---------------------------------------------------------------------------

describe('DeliveryService.getActiveProvider', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns provider object with provider name, instance, and metadata', async () => {
    const integration = makeIntegration();
    // First call (getActiveProvider) → returns integration
    // Second call (getProviderInstance inside getActiveProvider) → returns same integration
    DeliveryIntegration.findOne.mockResolvedValue(integration);

    const result = await deliveryService.getActiveProvider(SHOP_ID);

    expect(result).toMatchObject({
      provider: 'steadfast',
      metadata: integration.metadata,
    });
    expect(result.instance).toHaveProperty('createOrder');
  });

  test('returns null when no active integration found', async () => {
    DeliveryIntegration.findOne.mockResolvedValue(null);

    const result = await deliveryService.getActiveProvider(SHOP_ID);

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeOrderPayload
// ---------------------------------------------------------------------------

describe('DeliveryService.normalizeOrderPayload', () => {
  beforeEach(() => jest.clearAllMocks());

  test('delegates to registry normalizePayload and returns result', () => {
    const orderData = { order_number: 'ORD-001', customer_name: 'John', total: 500 };
    const metadata = { store_id: 'store-1' };
    mockNormalizePayload.mockReturnValue({ invoice: 'ORD-001', cod_amount: 500 });

    const result = deliveryService.normalizeOrderPayload('steadfast', orderData, metadata);

    expect(mockNormalizePayload).toHaveBeenCalledWith(orderData, metadata);
    expect(result).toEqual({ invoice: 'ORD-001', cod_amount: 500 });
  });

  test('throws for unknown provider', () => {
    expect(() =>
      deliveryService.normalizeOrderPayload('unknown_courier', {}, {})
    ).toThrow('Unknown provider: unknown_courier');
  });

  test('passes empty metadata when not provided', () => {
    mockNormalizePayload.mockReturnValue({});

    deliveryService.normalizeOrderPayload('steadfast', { order_number: 'ORD-002', total: 0 });

    expect(mockNormalizePayload).toHaveBeenCalledWith(
      expect.anything(),
      {} // default providerMetadata
    );
  });
});

// ---------------------------------------------------------------------------
// normalizeOrderResponse
// ---------------------------------------------------------------------------

describe('DeliveryService.normalizeOrderResponse', () => {
  beforeEach(() => jest.clearAllMocks());

  test('merges provider fields over defaults and includes raw_response', () => {
    mockNormalizeResponse.mockReturnValue({
      consignment_id: 'CN-001',
      tracking_code: 'TRK-001',
      status: 'pending',
      delivery_fee: 60,
    });

    const raw = { consignment_id: 'CN-001', tracking_code: 'TRK-001', status: 'pending' };
    const result = deliveryService.normalizeOrderResponse('steadfast', raw);

    expect(result.provider).toBe('steadfast');
    expect(result.success).toBe(true);
    expect(result.consignment_id).toBe('CN-001');
    expect(result.tracking_code).toBe('TRK-001');
    expect(result.status).toBe('pending');
    expect(result.delivery_fee).toBe(60);
    expect(result.raw_response).toBe(raw);
  });

  test('defaults are overridden: null fields from registry replace null defaults', () => {
    mockNormalizeResponse.mockReturnValue({ consignment_id: 'CN-999' });

    const result = deliveryService.normalizeOrderResponse('steadfast', {});

    // Only consignment_id provided by registry; rest remain null default
    expect(result.consignment_id).toBe('CN-999');
    expect(result.tracking_code).toBeNull();
    expect(result.status).toBeNull();
  });

  test('throws for unknown provider', () => {
    expect(() =>
      deliveryService.normalizeOrderResponse('ghost_provider', {})
    ).toThrow('Unknown provider: ghost_provider');
  });
});

// ---------------------------------------------------------------------------
// normalizeDeliveryStatus
// ---------------------------------------------------------------------------

describe('DeliveryService.normalizeDeliveryStatus', () => {
  beforeEach(() => jest.clearAllMocks());

  test('maps known Steadfast status string to internal status', () => {
    expect(deliveryService.normalizeDeliveryStatus('steadfast', 'delivered')).toBe('delivered');
    expect(deliveryService.normalizeDeliveryStatus('steadfast', 'cancelled')).toBe('cancelled');
    expect(deliveryService.normalizeDeliveryStatus('steadfast', 'pending')).toBe('pending');
  });

  test('maps known Pathao status string (PascalCase) to internal status', () => {
    expect(deliveryService.normalizeDeliveryStatus('pathao', 'Delivered')).toBe('delivered');
    expect(deliveryService.normalizeDeliveryStatus('pathao', 'Cancelled')).toBe('cancelled');
  });

  test('returns lowercased original string when status is not in map', () => {
    expect(deliveryService.normalizeDeliveryStatus('steadfast', 'SomeUnknownStatus')).toBe('someunknownstatus');
  });

  test('returns lowercased original for completely unknown provider (graceful fallback)', () => {
    // provider not in registry → entry undefined → empty map → falls back to lowercase
    expect(deliveryService.normalizeDeliveryStatus('nonexistent', 'Pending')).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// createDeliveryOrder
// ---------------------------------------------------------------------------

describe('DeliveryService.createDeliveryOrder', () => {
  beforeEach(() => jest.clearAllMocks());

  const orderData = {
    order_number: 'ORD-001',
    customer_name: 'John Doe',
    customer_phone: '01712345678',
    delivery_address: 'Dhaka',
    total: 1500,
  };

  test('auto-detects active provider when preferredProvider is not specified', async () => {
    const integration = makeIntegration();
    DeliveryIntegration.findOne.mockResolvedValue(integration);

    mockNormalizePayload.mockReturnValue({ invoice: 'ORD-001', cod_amount: 1500 });
    mockCreateOrder.mockResolvedValue({ consignment_id: 'CN-AUTO', tracking_code: 'TRK-AUTO', status: 'pending' });
    mockNormalizeResponse.mockReturnValue({ consignment_id: 'CN-AUTO', tracking_code: 'TRK-AUTO', status: 'pending' });

    const result = await deliveryService.createDeliveryOrder(SHOP_ID, orderData);

    expect(result.provider).toBe('steadfast');
    expect(result.consignment_id).toBe('CN-AUTO');
  });

  test('uses preferredProvider when specified instead of querying active provider', async () => {
    // getProviderInstance (for preferred) + findOne for metadata
    DeliveryIntegration.findOne.mockResolvedValue(makeIntegration({ provider: 'pathao' }));

    mockNormalizePayload.mockReturnValue({ merchant_order_id: 'ORD-001' });
    mockCreateOrder.mockResolvedValue({ consignment_id: 'CN-PATHAO', status: 'pending' });
    mockNormalizeResponse.mockReturnValue({ consignment_id: 'CN-PATHAO', status: 'pending' });

    const result = await deliveryService.createDeliveryOrder(SHOP_ID, orderData, 'pathao');

    expect(result.provider).toBe('pathao');
    expect(result.consignment_id).toBe('CN-PATHAO');
  });

  test('throws and emits order_dispatch_failed when no active provider configured', async () => {
    // getActiveProvider returns null (no integration)
    DeliveryIntegration.findOne.mockResolvedValue(null);

    const failedListener = jest.fn();
    deliveryService.on('order_dispatch_failed', failedListener);

    await expect(
      deliveryService.createDeliveryOrder(SHOP_ID, orderData)
    ).rejects.toThrow('No active delivery provider configured');

    expect(failedListener).toHaveBeenCalledWith(
      expect.objectContaining({ shop_id: SHOP_ID, order_number: 'ORD-001' })
    );

    deliveryService.removeAllListeners('order_dispatch_failed');
  });

  test('emits order_dispatched event on success', async () => {
    DeliveryIntegration.findOne.mockResolvedValue(makeIntegration());

    mockNormalizePayload.mockReturnValue({});
    mockCreateOrder.mockResolvedValue({ consignment_id: 'CN-EVT', status: 'pending' });
    mockNormalizeResponse.mockReturnValue({ consignment_id: 'CN-EVT', tracking_code: 'TRK-EVT', status: 'pending' });

    const dispatchedListener = jest.fn();
    deliveryService.on('order_dispatched', dispatchedListener);

    await deliveryService.createDeliveryOrder(SHOP_ID, orderData, 'steadfast');

    expect(dispatchedListener).toHaveBeenCalledWith(
      expect.objectContaining({
        shop_id: SHOP_ID,
        order_number: 'ORD-001',
        provider: 'steadfast',
        consignment_id: 'CN-EVT',
      })
    );

    deliveryService.removeAllListeners('order_dispatched');
  });

  test('propagates provider createOrder error with order_dispatch_failed event', async () => {
    DeliveryIntegration.findOne.mockResolvedValue(makeIntegration());

    mockNormalizePayload.mockReturnValue({});
    mockCreateOrder.mockRejectedValue(new Error('Provider API timeout'));

    const failedListener = jest.fn();
    deliveryService.on('order_dispatch_failed', failedListener);

    await expect(
      deliveryService.createDeliveryOrder(SHOP_ID, orderData, 'steadfast')
    ).rejects.toThrow('Provider API timeout');

    expect(failedListener).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Provider API timeout',
        shop_id: SHOP_ID,
      })
    );

    deliveryService.removeAllListeners('order_dispatch_failed');
  });

  test('normalizeOrderPayload is called with provider and orderData before createOrder', async () => {
    DeliveryIntegration.findOne.mockResolvedValue(makeIntegration());

    const normalizedPayload = { invoice: 'ORD-001', cod_amount: 1500 };
    mockNormalizePayload.mockReturnValue(normalizedPayload);
    mockCreateOrder.mockResolvedValue({ consignment_id: 'CN-003', status: 'pending' });
    mockNormalizeResponse.mockReturnValue({ consignment_id: 'CN-003', status: 'pending' });

    await deliveryService.createDeliveryOrder(SHOP_ID, orderData, 'steadfast');

    expect(mockNormalizePayload).toHaveBeenCalledWith(orderData, expect.any(Object));
    expect(mockCreateOrder).toHaveBeenCalledWith(normalizedPayload);
  });
});
