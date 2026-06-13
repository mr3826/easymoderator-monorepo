/**
 * Multi-product polish (PR C):
 *  1. parseLineItems — split a single free-text message ("2 lawn + 1 dupatta")
 *     into multiple {quantity, query} line items. Conservative: only splits on
 *     explicit "and"-style connectors, never mid product-name, and leaves a
 *     single-item message alone (returns []).
 *  2. detectCartEdit — recognise per-line edits at the summary step:
 *     "remove the dupatta", "make the saree 3" — matched against the live cart.
 *  3. Step-machine integration: ADDING_PRODUCT carts every parsed line; the
 *     ORDER_SUMMARY non-confirmation branch applies an edit and re-shows the
 *     summary instead of dead-ending.
 */

jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: { define: jest.fn(() => ({})), transaction: jest.fn() },
}));
jest.mock('../order.service', () => ({ createOrderInternal: jest.fn() }));
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
const productSearch = require('../../product/product-search.service');

beforeEach(() => jest.clearAllMocks());

// ─── 1. parseLineItems ──────────────────────────────────────────────────────
describe('parseLineItems', () => {
    test('splits "2 lawn + 1 dupatta" into two quantified items', () => {
        expect(OrderSessionService.parseLineItems('2 lawn + 1 dupatta')).toEqual([
            { quantity: 2, query: 'lawn' },
            { quantity: 1, query: 'dupatta' },
        ]);
    });

    test('splits a comma list, defaulting quantity to 1', () => {
        expect(OrderSessionService.parseLineItems('lawn, dupatta, saree')).toEqual([
            { quantity: 1, query: 'lawn' },
            { quantity: 1, query: 'dupatta' },
            { quantity: 1, query: 'saree' },
        ]);
    });

    test('handles Banglish "ar" + spoken quantity word "ekta"', () => {
        expect(OrderSessionService.parseLineItems('azal lawn ar ekta dupatta')).toEqual([
            { quantity: 1, query: 'azal lawn' },
            { quantity: 1, query: 'dupatta' },
        ]);
    });

    test('handles "N ta X and M ta Y"', () => {
        expect(OrderSessionService.parseLineItems('2 ta lawn and 3 ta dupatta')).toEqual([
            { quantity: 2, query: 'lawn' },
            { quantity: 3, query: 'dupatta' },
        ]);
    });

    test('handles Bengali digits and the আর connector', () => {
        expect(OrderSessionService.parseLineItems('১টা লন আর ২টা দুপাট্টা')).toEqual([
            { quantity: 1, query: 'লন' },
            { quantity: 2, query: 'দুপাট্টা' },
        ]);
    });

    test('preserves a number-word that is part of the product name (mid-segment)', () => {
        // Leading "1" is the quantity; the "two" inside "two piece" must survive.
        expect(OrderSessionService.parseLineItems('1 azal lawn two piece + 1 dupatta')).toEqual([
            { quantity: 1, query: 'azal lawn two piece' },
            { quantity: 1, query: 'dupatta' },
        ]);
    });

    test('returns [] for a single item (no connector) so the normal flow is unchanged', () => {
        expect(OrderSessionService.parseLineItems('red saree')).toEqual([]);
        expect(OrderSessionService.parseLineItems('3 lawn')).toEqual([]);
    });

    test('returns [] for empty/garbage input', () => {
        expect(OrderSessionService.parseLineItems('')).toEqual([]);
        expect(OrderSessionService.parseLineItems(null)).toEqual([]);
        expect(OrderSessionService.parseLineItems('   ')).toEqual([]);
    });
});

// ─── 2. detectCartEdit ──────────────────────────────────────────────────────
describe('detectCartEdit', () => {
    const cart = () => ([
        { product_id: 'p1', name: 'Red Saree', price: 1200, quantity: 1 },
        { product_id: 'p2', name: 'Silk Dupatta', name_bn: 'সিল্ক দুপাট্টা', price: 500, quantity: 2 },
    ]);

    test('"remove the dupatta" → remove that line', () => {
        expect(OrderSessionService.detectCartEdit('remove the dupatta', cart()))
            .toEqual({ action: 'remove', index: 1 });
    });

    test('Banglish "dupatta baad dao" → remove that line', () => {
        expect(OrderSessionService.detectCartEdit('dupatta baad dao', cart()))
            .toEqual({ action: 'remove', index: 1 });
    });

    test('"saree baad" → remove the saree line', () => {
        expect(OrderSessionService.detectCartEdit('saree baad', cart()))
            .toEqual({ action: 'remove', index: 0 });
    });

    test('"make the saree 3" → set quantity of that line', () => {
        expect(OrderSessionService.detectCartEdit('make the saree 3', cart()))
            .toEqual({ action: 'setqty', index: 0, quantity: 3 });
    });

    test('"dupatta 5 ta koro" → set quantity', () => {
        expect(OrderSessionService.detectCartEdit('dupatta 5 ta koro', cart()))
            .toEqual({ action: 'setqty', index: 1, quantity: 5 });
    });

    test('a bare confirmation is NOT an edit', () => {
        expect(OrderSessionService.detectCartEdit('yes', cart())).toEqual({ action: null });
        expect(OrderSessionService.detectCartEdit('confirm korun', cart())).toEqual({ action: null });
    });

    test('a message with no product match is NOT an edit', () => {
        expect(OrderSessionService.detectCartEdit('change my address', cart())).toEqual({ action: null });
    });
});

// ─── 3. Step-machine integration ────────────────────────────────────────────
describe('ADDING_PRODUCT carts every parsed line item', () => {
    test('"2 lawn and 1 dupatta" adds both, each resolved + in stock', async () => {
        productSearch.searchForOrder
            .mockResolvedValueOnce({ products: [{ id: 'lawn-1', name: 'Lawn', price: 800 }], wasFallback: false })
            .mockResolvedValueOnce({ products: [{ id: 'dup-1', name: 'Dupatta', price: 400 }], wasFallback: false });
        productSearch.checkStock.mockResolvedValue({ available: true });

        const session = {
            id: 'sess-1', shop_id: 'shop-1', channel: 'messenger',
            current_step: 'ADDING_PRODUCT',
            step_data: { language: 'en', cart: [{ product_id: 'x', name: 'Existing', price: 100, quantity: 1 }] },
            product_info: { id: 'x' },
            update: jest.fn().mockResolvedValue(undefined),
        };

        const res = await OrderSessionService.handleCurrentStep(session, '2 lawn and 1 dupatta', null);

        expect(res.current_step).toBe('ADD_MORE');
        const cart = res.step_data.cart;
        expect(cart).toHaveLength(3); // existing + lawn + dupatta
        expect(cart[1]).toMatchObject({ product_id: 'lawn-1', quantity: 2 });
        expect(cart[2]).toMatchObject({ product_id: 'dup-1', quantity: 1 });
    });
});

describe('ORDER_SUMMARY applies a per-line edit instead of dead-ending', () => {
    const makeSummarySession = () => ({
        id: 'sess-1', shop_id: 'shop-1', channel: 'messenger',
        current_step: 'ORDER_SUMMARY',
        step_data: {
            language: 'en',
            name: 'Rahim', phone: '01711111111', address: 'Mirpur', delivery_charge: 60,
            payment_method: 'cod',
            cart: [
                { product_id: 'p1', name: 'Red Saree', price: 1200, quantity: 1 },
                { product_id: 'p2', name: 'Silk Dupatta', price: 500, quantity: 2 },
            ],
        },
        product_info: { id: 'p2' },
        update: jest.fn().mockResolvedValue(undefined),
    });

    test('"remove the dupatta" drops the line and re-shows the summary (stays on ORDER_SUMMARY)', async () => {
        const session = makeSummarySession();
        const res = await OrderSessionService.handleCurrentStep(session, 'remove the dupatta', null);

        expect(res.current_step).toBe('ORDER_SUMMARY');
        expect(res.completed).toBeFalsy();
        expect(res.step_data.cart).toHaveLength(1);
        expect(res.step_data.cart[0].product_id).toBe('p1');
        expect(res.prompt).toContain('Red Saree');
        expect(res.prompt).not.toContain('Silk Dupatta');
    });

    test('"make the saree 3" updates the quantity and re-shows the summary', async () => {
        const session = makeSummarySession();
        const res = await OrderSessionService.handleCurrentStep(session, 'make the saree 3', null);

        expect(res.current_step).toBe('ORDER_SUMMARY');
        const saree = res.step_data.cart.find(c => c.product_id === 'p1');
        expect(saree.quantity).toBe(3);
        expect(res.prompt).toContain('Red Saree');
    });
});
