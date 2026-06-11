/**
 * Tests for chat-invoice.service — the lightweight (no-puppeteer) invoice used
 * by the chatbot order flow and payment webhooks. Persists an OrderInvoice row
 * and renders the bilingual text invoice delivered in chat.
 */

jest.mock('../../entities', () => ({
    OrderInvoice: { findOne: jest.fn(), create: jest.fn() },
    Shop: { findByPk: jest.fn() },
    OrderItem: { findAll: jest.fn() },
    Product: {},
}));

const { OrderInvoice, Shop, OrderItem } = require('../../entities');
const { issueInvoiceForOrder, renderInvoiceText } = require('../chat-invoice.service');

const order = {
    id: 'ord-1',
    shop_id: 'shop-1',
    order_number: '100001',
    customer_name: 'Evan',
    customer_phone: '01886895874',
    delivery_address: 'Mirpur, Dhaka',
    payment_method: 'cod',
    payment_status: 'unpaid',
    subtotal: '1650.00',   // Sequelize DECIMALs come back as strings
    discount: '0.00',
    delivery_fee: '60.00',
    total: '1710.00',
    createdAt: new Date('2026-06-11T08:04:45Z'),
};

const items = [{ name: 'Azal Lawn Two Piece', quantity: 1, price: 1650, total: 1650 }];

beforeEach(() => {
    jest.clearAllMocks();
    Shop.findByPk.mockResolvedValue({ id: 'shop-1', name: 'Evan Fashion House' });
    OrderInvoice.findOne.mockResolvedValue(null);
    OrderInvoice.create.mockImplementation(async (data) => ({ ...data }));
});

describe('issueInvoiceForOrder', () => {
    test('creates the OrderInvoice row with an order-tied number and snapshot', async () => {
        const { invoice, text } = await issueInvoiceForOrder(order, { items, channel: 'messenger' });

        expect(OrderInvoice.create).toHaveBeenCalledTimes(1);
        const row = OrderInvoice.create.mock.calls[0][0];
        expect(row).toEqual(expect.objectContaining({
            order_id: 'ord-1',
            shop_id: 'shop-1',
            invoice_number: 'INV-100001',
            status: 'sent',
            sent_via: ['messenger'],
        }));
        expect(row.order_data.total).toBe(1710);
        expect(row.customer_info.phone).toBe('01886895874');
        expect(invoice.invoice_number).toBe('INV-100001');

        // The rendered text is what the customer receives in chat
        expect(text).toContain('INV-100001');
        expect(text).toContain('#100001');
        expect(text).toContain('Azal Lawn Two Piece x1 — ৳1650');
        expect(text).toContain('৳1710');
        expect(text).toContain('Cash on Delivery');
        expect(text).toContain('Mirpur, Dhaka');
        expect(text).toContain('Evan Fashion House');
        // No items query needed when the caller supplies display items
        expect(OrderItem.findAll).not.toHaveBeenCalled();
    });

    test('is idempotent per order — an existing invoice is reused, not duplicated', async () => {
        OrderInvoice.findOne.mockResolvedValue({ invoice_number: 'INV-100001' });

        const { invoice, text } = await issueInvoiceForOrder(order, { items });

        expect(OrderInvoice.create).not.toHaveBeenCalled();
        expect(invoice.invoice_number).toBe('INV-100001');
        expect(text).toContain('INV-100001');
    });

    test('falls back to order_items rows when no display items are provided', async () => {
        OrderItem.findAll.mockResolvedValue([
            { quantity: 2, price: '500.00', total: '1000.00', product: { name: 'Blue Kurti' } },
        ]);

        const { text } = await issueInvoiceForOrder(order);

        expect(OrderItem.findAll).toHaveBeenCalled();
        expect(text).toContain('Blue Kurti x2 — ৳1000');
    });

    test('shop lookup failure does not block the invoice', async () => {
        Shop.findByPk.mockRejectedValue(new Error('db down'));

        const { text } = await issueInvoiceForOrder(order, { items });

        expect(text).toContain('INV-100001');
        expect(text).toContain('ধন্যবাদ');
    });

    test('rejects an order without an id', async () => {
        await expect(issueInvoiceForOrder(null)).rejects.toThrow(/order with id/i);
    });
});

describe('renderInvoiceText', () => {
    test('formats a structured (manual-order) delivery address', () => {
        const structured = { ...order, delivery_address: { street: 'House 5', area: 'Mirpur 10', city: 'Dhaka' } };
        const text = renderInvoiceText(structured, items, 'INV-100001', 'Shop');
        expect(text).toContain('House 5, Mirpur 10, Dhaka');
    });

    test('shows the paid label when payment is complete', () => {
        const paid = { ...order, payment_status: 'paid' };
        const text = renderInvoiceText(paid, items, 'INV-100001', 'Shop');
        expect(text).toContain('পরিশোধিত');
    });
});
