/**
 * Tests for order-flow.service — the bridge that wires the deterministic order
 * step-machine into the live message worker.
 *
 * Regression context: the production Messenger/IG pipeline
 * (webhook → burst-coalescer → message-worker → processNewIntent → intentRouter)
 * was PURELY conversational. It never started or continued an order session, so
 * the LLM collected name/phone/address as chat and even claimed orders were
 * "confirmed" — but no Order row was ever created. This service restores order
 * capture by continuing an active session or starting one on clear purchase
 * intent for an identified product, BEFORE the LLM runs.
 */

const OrderSessionService = require('../../order/order-session-standalone.service');
const productSearch = require('../../product/product-search.service');
const Customer = require('../../customer/customer.entity');

jest.mock('../../order/order-session-standalone.service', () => ({
    getActiveSession: jest.fn(),
    processStep: jest.fn(),
    startOrderSession: jest.fn(),
    cancelSession: jest.fn(),
}));
jest.mock('../../product/product-search.service', () => ({
    searchForOrder: jest.fn(),
}));
jest.mock('../../customer/customer.entity', () => ({
    findOne: jest.fn(),
}));
jest.mock('../../ai/image-product-matcher.service', () => ({
    matchImageMessage: jest.fn(),
}));

const { matchImageMessage } = require('../../ai/image-product-matcher.service');
const { handleOrderFlow, hasPurchaseIntent, isOrderCancel } = require('../order-flow.service');

const SHOP = '11111111-1111-1111-1111-111111111111';
const PSID = 'fb-psid-123';

const base = (overrides = {}) => ({
    shopId: SHOP,
    customerChannelId: PSID,
    platform: 'facebook',
    message: '',
    entities: {},
    language: 'en',
    imageUrls: [],
    ...overrides,
});

beforeEach(() => {
    jest.clearAllMocks();
    Customer.findOne.mockResolvedValue({ id: 'cust-1' });
    matchImageMessage.mockResolvedValue({ products: [], method: 'no_match', confidence: 0 });
});

describe('handleOrderFlow — continue an active session', () => {
    test('routes every message to processStep while a session is ACTIVE (LLM skipped)', async () => {
        OrderSessionService.getActiveSession.mockResolvedValue({ id: 'sess-1', status: 'ACTIVE' });
        OrderSessionService.processStep.mockResolvedValue({
            prompt: 'আপনার মোবাইল নম্বর কত?',
            current_step: 'COLLECTING_PHONE',
            completed: false,
        });

        const res = await handleOrderFlow(base({ message: 'John Doe' }));

        expect(res.handled).toBe(true);
        expect(res.response).toBe('আপনার মোবাইল নম্বর কত?');
        expect(OrderSessionService.processStep).toHaveBeenCalledWith('sess-1', SHOP, 'John Doe', null);
        expect(OrderSessionService.startOrderSession).not.toHaveBeenCalled();
    });

    test('passes the image url through to the step machine (MFS screenshot step)', async () => {
        OrderSessionService.getActiveSession.mockResolvedValue({ id: 'sess-1', status: 'ACTIVE' });
        OrderSessionService.processStep.mockResolvedValue({ prompt: 'ok', current_step: 'COLLECTING_NOTES', completed: false });

        await handleOrderFlow(base({ message: '[image]', imageUrls: ['https://x/y.jpg'] }));

        expect(OrderSessionService.processStep).toHaveBeenCalledWith('sess-1', SHOP, '[image]', { imageUrl: 'https://x/y.jpg' });
    });

    test('a clear cancel message ends the session instead of stepping', async () => {
        OrderSessionService.getActiveSession.mockResolvedValue({ id: 'sess-1', status: 'ACTIVE' });

        const res = await handleOrderFlow(base({ message: 'cancel korbo' }));

        expect(res.handled).toBe(true);
        expect(OrderSessionService.cancelSession).toHaveBeenCalledWith('sess-1', SHOP);
        expect(OrderSessionService.processStep).not.toHaveBeenCalled();
        expect(res.response).toMatch(/cancel/i);
    });

    test('a negative add-more reply continues the active session instead of cancelling it', async () => {
        OrderSessionService.getActiveSession.mockResolvedValue({ id: 'sess-1', status: 'ACTIVE', current_step: 'ADD_MORE' });
        OrderSessionService.processStep.mockResolvedValue({
            prompt: 'অনুগ্রহ করে আপনার নাম দিন।',
            current_step: 'COLLECTING_NAME',
            completed: false,
        });

        const res = await handleOrderFlow(base({ message: 'আর লাগবে না', language: 'bn' }));

        expect(res.handled).toBe(true);
        expect(OrderSessionService.cancelSession).not.toHaveBeenCalled();
        expect(OrderSessionService.processStep).toHaveBeenCalledWith('sess-1', SHOP, 'আর লাগবে না', null);
        expect(res.meta).toEqual(expect.objectContaining({
            order_session: 'continue',
            step: 'COLLECTING_NAME',
        }));
    });
});

describe('handleOrderFlow — start a session on purchase intent', () => {
    test('starts a session with the identified product linked (single match)', async () => {
        OrderSessionService.getActiveSession.mockResolvedValue(null);
        productSearch.searchForOrder.mockResolvedValue({
            products: [{ id: 'prod-1', name: 'Red Saree', price: 1200, in_stock: true }],
            wasFallback: false,
        });
        OrderSessionService.startOrderSession.mockResolvedValue({ session_id: 'sess-2', prompt: 'আপনার নাম কী?' });

        const res = await handleOrderFlow(base({ message: 'ei red saree ta nibo' }));

        expect(res.handled).toBe(true);
        expect(res.response).toBe('আপনার নাম কী?');
        const arg = OrderSessionService.startOrderSession.mock.calls[0][0];
        expect(arg.shop_id).toBe(SHOP);
        expect(arg.customer_channel_id).toBe(PSID);
        expect(arg.customer_id).toBe('cust-1');
        expect(arg.product_info).toEqual(expect.objectContaining({ id: 'prod-1', name: 'Red Saree' }));
        expect(arg.product_candidates).toBeFalsy();
        // The detected language is threaded into the session so its prompts reply
        // in one language matching the customer.
        expect(arg.language).toBe('en');
    });

    test('offers a numbered picker when multiple products match', async () => {
        OrderSessionService.getActiveSession.mockResolvedValue(null);
        productSearch.searchForOrder.mockResolvedValue({
            products: [
                { id: 'prod-1', name: 'Red Saree', price: 1200, in_stock: true },
                { id: 'prod-2', name: 'Blue Saree', price: 1500, in_stock: true },
            ],
            wasFallback: false,
        });
        OrderSessionService.startOrderSession.mockResolvedValue({ session_id: 'sess-3', prompt: 'Pick a number' });

        const res = await handleOrderFlow(base({ message: 'saree ta order korbo' }));

        expect(res.handled).toBe(true);
        const arg = OrderSessionService.startOrderSession.mock.calls[0][0];
        expect(arg.product_info).toBeFalsy();
        expect(arg.product_candidates).toHaveLength(2);
        expect(arg.product_candidates[0]).toEqual(expect.objectContaining({ id: 'prod-1' }));
    });

    // Live regression 2026-06-11 (afternoon): "evan, order korbo" matched no
    // product, fell through to the LLM, and the LLM claimed "amader system
    // ekhon apnar order process ta shuru korbe" — with no session existing.
    // Purchase intent with no product must get a deterministic which-product
    // ask, never an LLM turn that can hallucinate an order.
    test('asks which product (deterministically) when none can be identified', async () => {
        OrderSessionService.getActiveSession.mockResolvedValue(null);
        productSearch.searchForOrder.mockResolvedValue({ products: [], wasFallback: true });

        // base() language is 'en' → the which-product ask comes back in English only
        // (single language, matching the customer — never Bengali+English at once).
        const res = await handleOrderFlow(base({ message: 'evan, order korbo' }));

        expect(res.handled).toBe(true);
        expect(res.response).toMatch(/which product/i);
        expect(res.response).not.toMatch(/কোন প্রোডাক্ট/); // not dual-language
        expect(res.meta).toEqual(expect.objectContaining({ order_session: 'product_needed' }));
        expect(OrderSessionService.startOrderSession).not.toHaveBeenCalled();
    });

    test('the which-product ask is Bengali when the customer language is bn', async () => {
        OrderSessionService.getActiveSession.mockResolvedValue(null);
        productSearch.searchForOrder.mockResolvedValue({ products: [], wasFallback: true });

        const res = await handleOrderFlow(base({ message: 'অর্ডার করবো', language: 'bn' }));

        expect(res.handled).toBe(true);
        expect(res.response).toMatch(/কোন প্রোডাক্ট/);
    });

    test('relays an out-of-stock prompt without leaving a dangling session', async () => {
        OrderSessionService.getActiveSession.mockResolvedValue(null);
        productSearch.searchForOrder.mockResolvedValue({
            products: [{ id: 'prod-1', name: 'Red Saree', price: 1200, in_stock: false }],
            wasFallback: false,
        });
        OrderSessionService.startOrderSession.mockResolvedValue({ session_id: null, prompt: 'Sorry, out of stock', out_of_stock: true });

        const res = await handleOrderFlow(base({ message: 'red saree nibo' }));

        expect(res.handled).toBe(true);
        expect(res.response).toMatch(/out of stock/i);
    });
});

describe('handleOrderFlow — image-borne product (photo + "order korbo")', () => {
    // Live regression 2026-06-11: customer sent a product PHOTO + "Oder korbo".
    // The text carries no product name, so text search found nothing and the
    // whole turn fell through to the LLM, which role-played the order.
    test('identifies the product from the image when text search has no match', async () => {
        OrderSessionService.getActiveSession.mockResolvedValue(null);
        productSearch.searchForOrder.mockResolvedValue({ products: [], wasFallback: true });
        matchImageMessage.mockResolvedValue({
            products: [{ id: 'prod-9', name: 'Azal Lawn Two Piece', price: 1650, in_stock: true }],
            method: 'clip',
            confidence: 0.91,
        });
        OrderSessionService.startOrderSession.mockResolvedValue({ session_id: 'sess-9', prompt: 'আপনার নাম কী?' });

        const res = await handleOrderFlow(base({ message: 'Oder korbo', imageUrls: ['https://cdn/img.jpg'] }));

        expect(res.handled).toBe(true);
        expect(matchImageMessage).toHaveBeenCalledWith({ shopId: SHOP, imageUrl: 'https://cdn/img.jpg', text: 'Oder korbo' });
        const arg = OrderSessionService.startOrderSession.mock.calls[0][0];
        expect(arg.product_info).toEqual(expect.objectContaining({ id: 'prod-9', name: 'Azal Lawn Two Piece' }));
    });

    test('multiple image matches become a numbered picker', async () => {
        OrderSessionService.getActiveSession.mockResolvedValue(null);
        productSearch.searchForOrder.mockResolvedValue({ products: [], wasFallback: true });
        matchImageMessage.mockResolvedValue({
            products: [
                { id: 'p1', name: 'Lawn Two Piece Red', price: 1650, in_stock: true },
                { id: 'p2', name: 'Lawn Two Piece Blue', price: 1700, in_stock: true },
            ],
            method: 'rag',
            confidence: 0.82,
        });
        OrderSessionService.startOrderSession.mockResolvedValue({ session_id: 'sess-10', prompt: 'Pick a number' });

        const res = await handleOrderFlow(base({ message: 'order korbo', imageUrls: ['https://cdn/img.jpg'] }));

        expect(res.handled).toBe(true);
        const arg = OrderSessionService.startOrderSession.mock.calls[0][0];
        expect(arg.product_info).toBeFalsy();
        expect(arg.product_candidates).toHaveLength(2);
    });

    test('asks which product when the image matches nothing', async () => {
        OrderSessionService.getActiveSession.mockResolvedValue(null);
        productSearch.searchForOrder.mockResolvedValue({ products: [], wasFallback: true });
        matchImageMessage.mockResolvedValue({ products: [], method: 'no_match', confidence: 0 });

        const res = await handleOrderFlow(base({ message: 'order korbo', imageUrls: ['https://cdn/img.jpg'] }));

        expect(res.handled).toBe(true);
        expect(res.meta).toEqual(expect.objectContaining({ order_session: 'product_needed' }));
        expect(OrderSessionService.startOrderSession).not.toHaveBeenCalled();
    });

    test('does not consult the image matcher when there is no image', async () => {
        OrderSessionService.getActiveSession.mockResolvedValue(null);
        productSearch.searchForOrder.mockResolvedValue({ products: [], wasFallback: true });

        const res = await handleOrderFlow(base({ message: 'order korbo' }));

        expect(res.meta).toEqual(expect.objectContaining({ order_session: 'product_needed' }));
        expect(matchImageMessage).not.toHaveBeenCalled();
    });

    test('image matcher failure is non-fatal (still asks which product)', async () => {
        OrderSessionService.getActiveSession.mockResolvedValue(null);
        productSearch.searchForOrder.mockResolvedValue({ products: [], wasFallback: true });
        matchImageMessage.mockRejectedValue(new Error('vision quota'));

        const res = await handleOrderFlow(base({ message: 'order korbo', imageUrls: ['https://cdn/img.jpg'] }));

        expect(res.handled).toBe(true);
        expect(res.meta).toEqual(expect.objectContaining({ order_session: 'product_needed' }));
    });
});

describe('handleOrderFlow — pass-through (no order handling)', () => {
    test('a price question is left to the LLM (no search, no session)', async () => {
        OrderSessionService.getActiveSession.mockResolvedValue(null);

        const res = await handleOrderFlow(base({ message: 'ei saree tar dam koto?' }));

        expect(res.handled).toBe(false);
        expect(productSearch.searchForOrder).not.toHaveBeenCalled();
        expect(OrderSessionService.startOrderSession).not.toHaveBeenCalled();
    });

    test('an order-status query (contains order number) is not treated as a new order', async () => {
        OrderSessionService.getActiveSession.mockResolvedValue(null);

        const res = await handleOrderFlow(base({ message: 'amar order 123456 kothay?' }));

        expect(res.handled).toBe(false);
        expect(productSearch.searchForOrder).not.toHaveBeenCalled();
    });
});

describe('hasPurchaseIntent', () => {
    test.each([
        'nibo',
        'order korbo',
        'order dibo',
        'kinte chai',
        'I want to order this',
        'অর্ডার করব',
        'নিব',
        'কিনবো',
        // Live regression 2026-06-11: typo'd "order" + bare confirm phrases
        'Oder korbo',
        'odar dibo',
        'ordar korte chai',
        'Confirm korun',
        'confirm koren',
        'কনফার্ম করুন',
    ])('detects purchase intent in: %s', (msg) => {
        expect(hasPurchaseIntent(msg)).toBe(true);
    });

    test.each([
        'ei saree tar dam koto?',
        'just looking',
        'do you have this in blue?',
        'amar order 123456 kothay?',
        'delivery koto din lagbe?',
    ])('does NOT fire on: %s', (msg) => {
        expect(hasPurchaseIntent(msg)).toBe(false);
    });
});

describe('isOrderCancel', () => {
    test.each(['cancel', 'cancel korbo', 'order cancel', 'অর্ডার বাতিল', 'বাতিল', "don't want this order"])(
        'detects cancel in: %s', (msg) => {
            expect(isOrderCancel(msg)).toBe(true);
        });

    test.each([
        'লাগবে না',
        'lagbe na',
        'আর লাগবে না',
        'ar lagbe na',
        'no',
        'না',
        'no, confirm this',
        'cancel blue shirt',
        'হ্যাঁ',
        'yes',
        'John Doe',
        'Mirpur 10',
    ])('does NOT fire on: %s', (msg) => {
        expect(isOrderCancel(msg)).toBe(false);
    });
});
