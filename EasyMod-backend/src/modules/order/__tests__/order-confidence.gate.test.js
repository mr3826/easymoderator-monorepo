'use strict';

/**
 * RTO Shield v2 wiring inside the canonical booking boundary (ADR-0007).
 * The gate itself is exercised against real PostgreSQL in
 * order-confidence/__tests__/order-confidence.integration.test.js; this file
 * pins how bookForOrder reacts to each gate result.
 */

const mockOrder = { update: jest.fn().mockResolvedValue([1]) };
const mockCourierDispatch = { findOrCreate: jest.fn(), update: jest.fn(), findOne: jest.fn() };

jest.mock('../../entities', () => ({
    Order: mockOrder,
    OrderItem: {},
    Product: {},
    Customer: {},
    UserShop: {},
    OrderReturn: {},
    CourierDispatch: mockCourierDispatch,
}));
jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: { transaction: jest.fn(), query: jest.fn(), getDialect: jest.fn() },
}));
jest.mock('../../delivery/delivery.service', () => ({
    resolveAiDefaultProvider: jest.fn(),
    createDeliveryOrder: jest.fn(),
}));
jest.mock('../order-session-standalone.service', () => ({ persistDeliveryResult: jest.fn() }));
jest.mock('../../notification/merchant-notification.service', () => ({
    notifyShop: jest.fn().mockResolvedValue({ queued: true }),
}));
jest.mock('../../order-confidence/order-confidence.service', () => ({
    checkBookingGate: jest.fn(),
}));

const orderService = require('../order.service');
const deliveryService = require('../../delivery/delivery.service');
const merchantNotificationService = require('../../notification/merchant-notification.service');
const orderConfidence = require('../../order-confidence/order-confidence.service');

const makeOrder = (overrides = {}) => ({
    id: 'order-1',
    shop_id: 'shop-1',
    order_number: 'ORD-1',
    order_status: 'confirmed',
    customer_name: 'Rahim',
    customer_phone: '01711111111',
    delivery_address: 'House 12, Road 5, Dhanmondi, Dhaka',
    total: '1250.00',
    items: [{ name: 'Red Saree', quantity: 1 }],
    update: jest.fn(async function update(values) { Object.assign(this, values); }),
    ...overrides,
});

const HELD = {
    allowed: false,
    mode: 'enforce',
    decision: 'VERIFY',
    reasons: [{ code: 'ADDRESS_TOO_SHORT', severity: 'VERIFY' }],
    decisionVersion: 3,
};

beforeEach(() => {
    jest.clearAllMocks();
    deliveryService.resolveAiDefaultProvider.mockResolvedValue({ blocked: false, provider: 'pathao', pickup: null });
    deliveryService.createDeliveryOrder.mockResolvedValue({
        provider: 'pathao', consignment_id: 'CN-1', tracking_code: 'TRK-1', status: 'pending',
    });
    mockCourierDispatch.findOne.mockResolvedValue(null);
    mockCourierDispatch.findOrCreate.mockResolvedValue([{ id: 'd-1', status: 'PENDING' }, true]);
    mockCourierDispatch.update.mockResolvedValue([1]);
});

describe('bookForOrder × Order Confidence gate', () => {
    test('a held order never creates a dispatch claim and never reaches the provider', async () => {
        orderConfidence.checkBookingGate.mockResolvedValue(HELD);

        const result = await orderService.bookForOrder(makeOrder(), { shopId: 'shop-1' });

        expect(result).toEqual(expect.objectContaining({
            blocked: true,
            status: 'confidence_hold',
            decision: 'VERIFY',
            reasons: ['ADDRESS_TOO_SHORT'],
            decision_version: 3,
        }));
        expect(mockCourierDispatch.findOrCreate).not.toHaveBeenCalled();
        expect(deliveryService.createDeliveryOrder).not.toHaveBeenCalled();
        // Operational marker only — order_status / fulfillment_status untouched.
        expect(mockOrder.update).toHaveBeenCalledWith(
            { delivery_status: 'confidence_hold' },
            { where: expect.objectContaining({ id: 'order-1', shop_id: 'shop-1', delivery_consignment_id: null }) },
        );
        expect(merchantNotificationService.notifyShop).toHaveBeenCalledWith(
            'shop-1',
            'order_review_required',
            expect.objectContaining({ orderId: 'order-1', decision: 'VERIFY', reasonCodes: ['ADDRESS_TOO_SHORT'] }),
            expect.objectContaining({ dedupeKey: 'order-1:confidence_hold' }),
        );
    });

    test('the gate runs before the claim and receives the trigger', async () => {
        orderConfidence.checkBookingGate.mockResolvedValue({ allowed: true, mode: 'enforce', decision: 'READY' });

        const result = await orderService.bookForOrder(makeOrder(), { shopId: 'shop-1', trigger: 'MANUAL' });

        expect(orderConfidence.checkBookingGate).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'order-1' }), 'shop-1', { trigger: 'MANUAL' },
        );
        expect(mockCourierDispatch.findOrCreate).toHaveBeenCalledTimes(1);
        expect(deliveryService.createDeliveryOrder).toHaveBeenCalledTimes(1);
        expect(result).toEqual(expect.objectContaining({ tracking_code: 'TRK-1' }));
        const gateOrder = orderConfidence.checkBookingGate.mock.invocationCallOrder[0];
        const claimOrder = mockCourierDispatch.findOrCreate.mock.invocationCallOrder[0];
        expect(gateOrder).toBeLessThan(claimOrder);
    });

    test('automatic callers default to trigger AUTO', async () => {
        orderConfidence.checkBookingGate.mockResolvedValue({ allowed: true, mode: 'off' });
        await orderService.bookForOrder(makeOrder(), { shopId: 'shop-1' });
        expect(orderConfidence.checkBookingGate).toHaveBeenCalledWith(expect.anything(), 'shop-1', { trigger: 'AUTO' });
    });

    test('a held order with a COMMITTED claim still reconciles the real parcel (no new provider call)', async () => {
        orderConfidence.checkBookingGate.mockResolvedValue(HELD);
        const committed = { id: 'd-1', status: 'COMMITTED', provider: 'pathao', consignment_id: 'CN-9', tracking_code: 'TRK-9' };
        mockCourierDispatch.findOne.mockResolvedValue(committed);
        mockCourierDispatch.findOrCreate.mockResolvedValue([committed, false]);

        const result = await orderService.bookForOrder(makeOrder(), { shopId: 'shop-1' });

        expect(deliveryService.createDeliveryOrder).not.toHaveBeenCalled();
        expect(result).toEqual(expect.objectContaining({ tracking_code: 'TRK-9', provider: 'pathao' }));
        expect(mockOrder.update).not.toHaveBeenCalledWith({ delivery_status: 'confidence_hold' }, expect.anything());
    });

    test.each([
        ['confidence mode off', { allowed: true, mode: 'off' }],
        ['verified in enforce mode', { allowed: true, mode: 'enforce', decision: 'READY' }],
    ])('a Draft order cannot reach courier booking with %s', async (_label, decision) => {
        orderConfidence.checkBookingGate.mockResolvedValue(decision);
        const draft = makeOrder({ order_status: 'draft' });

        await expect(orderService.bookForOrder(draft, { shopId: 'shop-1' }))
            .rejects.toMatchObject({ status: 409, code: 'DRAFT_ORDER_NOT_BOOKABLE' });

        // IC-V1 reconciliation: the gate runs AFTER Order-Confidence (not before,
        // as in v6's original branch) so a confidence-HELD draft keeps answering
        // with the richer ORDER_CONFIDENCE_HOLD contract (order-confidence
        // integration suite pins that). The merchant-visible guarantee is
        // unchanged: a draft can never book a courier.
        expect(orderConfidence.checkBookingGate).toHaveBeenCalledWith(
            draft, 'shop-1', { trigger: 'AUTO' },
        );
        expect(mockCourierDispatch.findOrCreate).not.toHaveBeenCalled();
        expect(deliveryService.createDeliveryOrder).not.toHaveBeenCalled();
        expect(draft.order_status).toBe('draft');
    });

    // IC-V1 review F1: an unconfigured shop must never see the draft mutated or
    // notified by a booking attempt — DRAFT_ORDER_NOT_BOOKABLE answers BEFORE
    // any COURIER_SETUP_REQUIRED marking.
    test('a Draft in a shop without courier setup is rejected without marking or notifying', async () => {
        orderConfidence.checkBookingGate.mockResolvedValue({ allowed: true, mode: 'off' });
        deliveryService.resolveAiDefaultProvider.mockResolvedValue({ blocked: true });
        const draft = makeOrder({ order_status: 'draft' });

        await expect(orderService.bookForOrder(draft, { shopId: 'shop-1' }))
            .rejects.toMatchObject({ status: 409, code: 'DRAFT_ORDER_NOT_BOOKABLE' });

        expect(draft.update).not.toHaveBeenCalled();
        expect(merchantNotificationService.notifyShop).not.toHaveBeenCalled();
        expect(deliveryService.createDeliveryOrder).not.toHaveBeenCalled();
    });

    // IC-V1 review F2: a legacy draft whose dispatch already COMMITTED must
    // remain reconcilable (the parcel was really booked).
    test('a Draft with a COMMITTED dispatch still reconciles its real parcel', async () => {
        orderConfidence.checkBookingGate.mockResolvedValue({ allowed: true, mode: 'off' });
        mockCourierDispatch.findOne.mockResolvedValue({
            id: 'd-old', status: 'COMMITTED', provider: 'pathao',
            consignment_id: 'CN-OLD', tracking_code: 'TRK-OLD',
        });
        const draft = makeOrder({ order_status: 'draft' });

        const result = await orderService.bookForOrder(draft, { shopId: 'shop-1' });

        expect(deliveryService.createDeliveryOrder).not.toHaveBeenCalled();
        expect(mockCourierDispatch.findOrCreate).not.toHaveBeenCalled();
        expect(draft.update).not.toHaveBeenCalled();
        expect(result).toBeTruthy();
    });

    test('an already-booked order returns its parcel without consulting the gate', async () => {
        const result = await orderService.bookForOrder(
            makeOrder({ delivery_consignment_id: 'CN-OLD', delivery_tracking_code: 'TRK-OLD', delivery_provider: 'pathao' }),
            { shopId: 'shop-1' },
        );
        expect(orderConfidence.checkBookingGate).not.toHaveBeenCalled();
        expect(result).toEqual(expect.objectContaining({ tracking_code: 'TRK-OLD' }));
    });

    test('an engine failure in enforce mode holds and is reported as such', async () => {
        orderConfidence.checkBookingGate.mockResolvedValue({
            allowed: false, mode: 'enforce', engineFailure: true, decision: null,
            reasons: [{ code: 'ENGINE_UNAVAILABLE', severity: 'VERIFY' }],
        });
        const result = await orderService.bookForOrder(makeOrder(), { shopId: 'shop-1' });
        expect(result).toEqual(expect.objectContaining({ status: 'confidence_hold', engine_failure: true }));
        expect(deliveryService.createDeliveryOrder).not.toHaveBeenCalled();
    });
});
