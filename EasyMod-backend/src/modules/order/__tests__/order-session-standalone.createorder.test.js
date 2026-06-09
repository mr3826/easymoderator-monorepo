/**
 * Contract test for OrderSessionService.createOrderFromSession — the final link
 * in the chat→order chain that the live worker now reaches via order-flow.service.
 *
 * Before the order-flow wiring, this code path was never invoked in production
 * (the worker only ran the conversational LLM), so an Order was never created.
 * This locks the conversion contract: a completed session must produce a real
 * createOrderInternal call with the right shape, and a session with no linked
 * product must fail loudly rather than silently dead-end.
 */

// Make the module load without a live DB: stub the sequelize instance so the
// top-level model definitions resolve to plain objects.
jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: { define: jest.fn(() => ({})), transaction: jest.fn() },
}));
jest.mock('../order.service', () => ({
    createOrderInternal: jest.fn().mockResolvedValue({ id: 'ord-1', order_number: '1001', total: 1260 }),
}));
jest.mock('../../payment/self-mfs-handler.service', () => ({ verifyPaymentScreenshot: jest.fn() }));

const OrderSessionService = require('../order-session-standalone.service');
const { createOrderInternal } = require('../order.service');

beforeEach(() => jest.clearAllMocks());

describe('createOrderFromSession', () => {
    test('converts a completed session into a real Order (idempotent, catalog-priced)', async () => {
        const session = {
            id: 'sess-1',
            shop_id: 'shop-1',
            customer_id: 'cust-1',
            channel: 'messenger',
            product_info: { id: 'prod-1', name: 'Red Saree', price: 1200, quantity: 1 },
        };
        const stepData = {
            name: 'Rahim',
            phone: '01711111111',
            address: 'Mirpur 10, Dhaka',
            delivery_charge: 60,
            payment_method: 'cod',
            notes: null,
        };

        const order = await OrderSessionService.createOrderFromSession(session, stepData);

        expect(createOrderInternal).toHaveBeenCalledTimes(1);
        const [shopIdArg, orderData, requestId] = createOrderInternal.mock.calls[0];
        expect(shopIdArg).toBe('shop-1');
        expect(requestId).toBe('sess-1'); // session id == idempotency key (retry-safe)
        expect(orderData).toEqual(expect.objectContaining({
            customer_id: 'cust-1',
            customer_name: 'Rahim',
            customer_phone: '01711111111',
            delivery_address: 'Mirpur 10, Dhaka',
            delivery_fee: 60,
            payment_status: 'unpaid', // COD → unpaid
            payment_method: 'cod',
            idempotency_key: 'sess-1',
        }));
        // price omitted on purpose — the server uses the live catalog price
        expect(orderData.items).toEqual([{ product_id: 'prod-1', quantity: 1 }]);
        expect(order.order_number).toBe('1001');
    });

    test('refuses to create an order when no product is linked to the session', async () => {
        await expect(
            OrderSessionService.createOrderFromSession({ id: 's', shop_id: 'sh', product_info: null }, {})
        ).rejects.toThrow(/no product/i);
        expect(createOrderInternal).not.toHaveBeenCalled();
    });
});
