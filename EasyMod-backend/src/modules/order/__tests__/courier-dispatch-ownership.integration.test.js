'use strict';

jest.mock('../../delivery/delivery.service', () => ({
    resolveAiDefaultProvider: jest.fn(),
    createDeliveryOrder: jest.fn(),
}));

jest.mock('../order-session-standalone.service', () => ({
    persistDeliveryResult: jest.fn(),
}));

const deliveryService = require('../../delivery/delivery.service');
const sessionService = require('../order-session-standalone.service');
const orderService = require('../order.service');
const { Tenant, Shop, Customer, Order, CourierDispatch } = require('../../entities');

const SHOP_PROVIDER = {
    blocked: false,
    provider: 'pathao',
    pickup: { provider_store_id: 'sandbox-store-1' },
};

const makeOrderData = () => ({
    customer_name: 'Courier Race Buyer',
    customer_phone: '01711111111',
    delivery_address: {
        street_address: 'Road 1',
        upazila: 'Dhanmondi',
        district: 'Dhaka',
    },
    total: 1250,
    items: [{ name: 'Courier Race Item', quantity: 1 }],
    order_status: 'confirmed',
    fulfillment_status: 'unfulfilled',
    payment_status: 'pending',
});

describe('courier dispatch ownership on PostgreSQL', () => {
    let tenant;
    let shop;
    let customer;
    let order;

    beforeAll(async () => {
        tenant = await Tenant.create({ name: `Courier ownership ${Date.now()}` });
        shop = await Shop.create({
            unique_code: `CR-${Date.now()}-${Math.floor(Math.random() * 10000)}`.slice(0, 20),
            tenant_id: tenant.id,
            shop_name: 'Courier Ownership Shop',
            name: 'Courier Ownership Shop',
        });
        customer = await Customer.create({
            shop_id: shop.id,
            name: 'Courier Race Buyer',
            channel_type: 'manual',
            channel_user_id: `courier-race-${Date.now()}`,
            phone: '01711111111',
        });
    });

    beforeEach(async () => {
        deliveryService.resolveAiDefaultProvider.mockResolvedValue(SHOP_PROVIDER);
        sessionService.persistDeliveryResult.mockImplementation(async (target, result) => {
            await target.update({
                delivery_provider: result.provider,
                delivery_consignment_id: result.consignment_id,
                delivery_tracking_code: result.tracking_code,
                delivery_status: result.status,
            });
            return result;
        });
        deliveryService.createDeliveryOrder.mockResolvedValue({
            provider: 'pathao',
            consignment_id: 'CN-OWNERSHIP-1',
            tracking_code: 'TRK-OWNERSHIP-1',
            status: 'pending',
        });
        order = await Order.create({
            shop_id: shop.id,
            customer_id: customer.id,
            order_number: `ORD-CR-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            ...makeOrderData(),
        });
    });

    afterEach(async () => {
        await CourierDispatch.destroy({ where: { order_id: order.id } });
        await Order.destroy({ where: { id: order.id } });
        jest.clearAllMocks();
    });

    afterAll(async () => {
        await Customer.destroy({ where: { id: customer.id } });
        await Shop.destroy({ where: { id: shop.id } });
        await Tenant.destroy({ where: { id: tenant.id } });
    });

    test('allows one owner to book while a concurrent loser remains blocked', async () => {
        let providerStarted;
        let releaseProvider;
        const providerReady = new Promise(resolve => { providerStarted = resolve; });
        const providerResult = new Promise(resolve => { releaseProvider = resolve; });

        deliveryService.createDeliveryOrder.mockImplementation(async () => {
            providerStarted();
            return providerResult;
        });

        const winnerPromise = orderService.bookForOrder(order, { shopId: shop.id });
        await providerReady;
        const loserResult = await orderService.bookForOrder(order, { shopId: shop.id });

        expect(loserResult).toMatchObject({
            blocked: true,
            reason: 'existing_courier_dispatch_claim',
        });
        expect(deliveryService.createDeliveryOrder).toHaveBeenCalledTimes(1);

        releaseProvider({
            provider: 'pathao',
            consignment_id: 'CN-OWNERSHIP-RACE',
            tracking_code: 'TRK-OWNERSHIP-RACE',
            status: 'pending',
        });
        await winnerPromise;

        const dispatches = await CourierDispatch.findAll({ where: { shop_id: shop.id, order_id: order.id } });
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]).toMatchObject({
            status: 'COMMITTED',
            consignment_id: 'CN-OWNERSHIP-RACE',
            tracking_code: 'TRK-OWNERSHIP-RACE',
        });
        expect(order.delivery_consignment_id).toBe('CN-OWNERSHIP-RACE');
        expect(order.delivery_tracking_code).toBe('TRK-OWNERSHIP-RACE');
    });

    test('rejects a stale terminal transition after the winner commits', async () => {
        await orderService.bookForOrder(order, { shopId: shop.id });
        const committed = await CourierDispatch.findOne({ where: { shop_id: shop.id, order_id: order.id } });

        const transition = await orderService.transitionCourierDispatchRecord(
            committed,
            { status: 'INDETERMINATE', error: 'stale loser' },
            {
                ownerToken: committed.dispatch_owner_token,
                expectedStatus: 'PENDING',
            },
        );

        expect(transition.updated).toBe(false);
        await committed.reload();
        expect(committed.status).toBe('COMMITTED');
        expect(committed.error).toBeNull();
        expect(deliveryService.createDeliveryOrder).toHaveBeenCalledTimes(1);
    });
});
