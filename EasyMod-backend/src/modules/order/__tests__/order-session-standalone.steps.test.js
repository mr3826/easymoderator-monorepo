/**
 * Step-machine behavior tests for OrderSessionService.handleCurrentStep:
 *
 * 1. COLLECTING_NAME must not swallow a bare confirmation ("confirm korun",
 *    "ok") as the customer's name — re-prompts instead. Exact-match only, so
 *    real names that merely contain a confirm word ("Jia") still pass.
 * 2. ORDER_SUMMARY confirmation issues the customer's invoice and appends it
 *    to the success message; invoice failure never un-confirms the order.
 */

jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: { define: jest.fn(() => ({})), transaction: jest.fn() },
}));
jest.mock('../order.service', () => ({
    createOrderInternal: jest.fn(),
}));
jest.mock('../../payment/self-mfs-handler.service', () => ({ verifyPaymentScreenshot: jest.fn() }));
jest.mock('../../product/product-search.service', () => ({
    checkStock: jest.fn(),
    searchForOrder: jest.fn(),
}));
jest.mock('../../customer/customer.entity', () => ({ findByPk: jest.fn() }));
jest.mock('../../shop/shop.entity', () => ({ findByPk: jest.fn() }));
jest.mock('../../payment/payment-config.entity', () => ({ findAll: jest.fn() }));
jest.mock('../../shop/shop-bd-settings', () => ({ getBdSettings: jest.fn(), hasSelfMfs: jest.fn() }));
jest.mock('../../invoice/chat-invoice.service', () => ({ issueInvoiceForOrder: jest.fn() }));

const OrderSessionService = require('../order-session-standalone.service');
const { createOrderInternal } = require('../order.service');
const productSearch = require('../../product/product-search.service');
const { issueInvoiceForOrder } = require('../../invoice/chat-invoice.service');

const makeSession = (overrides = {}) => ({
    id: 'sess-1',
    shop_id: 'shop-1',
    customer_id: null,
    channel: 'messenger',
    current_step: 'COLLECTING_NAME',
    step_data: {},
    product_info: { id: 'prod-1', name: 'Azal Lawn Two Piece', price: 1650, quantity: 1 },
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides,
});

beforeEach(() => {
    jest.clearAllMocks();
    // Parcel dispatch is fire-and-forget via setImmediate — keep it out of tests.
    jest.spyOn(OrderSessionService, 'dispatchParcelWithRetry').mockResolvedValue(undefined);
});

describe('COLLECTING_NAME', () => {
    test.each(['Confirm korun', 'ok', 'YES', 'হ্যাঁ', 'ji'])(
        're-prompts instead of storing "%s" as the name', async (echo) => {
            const session = makeSession();
            const res = await OrderSessionService.handleCurrentStep(session, echo, null);

            expect(res.current_step).toBe('COLLECTING_NAME');
            expect(res.step_data.name).toBeUndefined();
            expect(res.prompt).toMatch(/নাম|name/i);
        });

    test.each(['Evan', 'Jia', 'Hannan'])('accepts the real name "%s"', async (name) => {
        const session = makeSession();
        const res = await OrderSessionService.handleCurrentStep(session, name, null);

        expect(res.current_step).toBe('COLLECTING_PHONE');
        expect(res.step_data.name).toBe(name);
    });
});

describe('ORDER_SUMMARY confirmation → order + invoice', () => {
    const stepData = {
        name: 'Evan',
        phone: '01886895874',
        address: 'Mirpur, Dhaka',
        delivery_charge: 60,
        payment_method: 'cod',
    };

    beforeEach(() => {
        productSearch.checkStock.mockResolvedValue({ available: true });
        createOrderInternal.mockResolvedValue({
            id: 'ord-1', order_number: '100001', total: 1710,
            shop_id: 'shop-1', customer_name: 'Evan', payment_method: 'cod',
        });
    });

    // The step machine fires parcel dispatch via setImmediate. Drain it while
    // the dispatch spy is still installed, or it leaks past test teardown.
    const drainImmediates = () => new Promise(resolve => setImmediate(resolve));

    test('appends the invoice to the confirmation message', async () => {
        issueInvoiceForOrder.mockResolvedValue({
            invoice: { invoice_number: 'INV-100001' },
            text: '🧾 ইনভয়েস / INVOICE\nইনভয়েস নং: INV-100001\n💰 সর্বমোট / Total: ৳1710',
        });
        const session = makeSession({ current_step: 'ORDER_SUMMARY', step_data: stepData });

        const res = await OrderSessionService.handleCurrentStep(session, 'YES', null);
        await drainImmediates();

        expect(OrderSessionService.dispatchParcelWithRetry).toHaveBeenCalled();
        expect(res.completed).toBe(true);
        expect(res.prompt).toContain('100001');           // order number
        expect(res.prompt).toContain('INV-100001');        // invoice attached
        const [orderArg, optsArg] = issueInvoiceForOrder.mock.calls[0];
        expect(orderArg.id).toBe('ord-1');
        expect(optsArg.items).toEqual([
            expect.objectContaining({ name: 'Azal Lawn Two Piece', quantity: 1, total: 1650 }),
        ]);
    });

    test('invoice failure does not un-confirm the order', async () => {
        issueInvoiceForOrder.mockRejectedValue(new Error('db hiccup'));
        const session = makeSession({ current_step: 'ORDER_SUMMARY', step_data: stepData });

        const res = await OrderSessionService.handleCurrentStep(session, 'YES', null);
        await drainImmediates();

        expect(res.completed).toBe(true);
        expect(res.prompt).toContain('100001');
        expect(res.prompt).toMatch(/অর্ডার সফলভাবে|placed successfully/);
    });
});
