/**
 * Chat invoice
 * ────────────
 * Lightweight invoice for orders confirmed in chat (and other automated
 * flows): persists an OrderInvoice row and renders a bilingual (BN/EN)
 * plain-text invoice that can be delivered on the same channel the order
 * was placed on (Messenger/Instagram).
 *
 * Deliberately NO PDF: the legacy invoice/invoice.service.js requires
 * puppeteer at module load, and puppeteer is not installed in the production
 * image — merely require()-ing it crashes the caller. A text invoice is also
 * what BD f-commerce customers actually use (screenshot/forward in chat).
 */

const { OrderInvoice, Shop } = require('../entities');

const PAYMENT_METHOD_LABELS = {
    'cod':      'ক্যাশ অন ডেলিভারি / Cash on Delivery (COD)',
    'self-mfs': 'বিকাশ / নগদ (MFS)',
};

const PAYMENT_STATUS_LABELS = {
    paid:    'পরিশোধিত ✅ / Paid',
    pending: 'ডেলিভারিতে পরিশোধ / Due on delivery',
    unpaid:  'ডেলিভারিতে পরিশোধ / Due on delivery',
};

const asNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

// orders.delivery_address may be a plain string (chatbot) or a structured
// object (manual order form) — the entity getter JSON.parses when possible.
const formatAddress = (address) => {
    if (!address) return null;
    if (typeof address === 'string') return address;
    if (typeof address === 'object') {
        return Object.values(address).filter(v => v && typeof v === 'string').join(', ') || null;
    }
    return String(address);
};

const formatDate = (d) => {
    const date = d instanceof Date ? d : new Date(d || Date.now());
    if (Number.isNaN(date.getTime())) return '';
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${date.getFullYear()}`;
};

/**
 * Render the invoice text sent to the customer.
 * @param {object} order        - Order row (or plain object with the same fields)
 * @param {Array}  items        - [{ name, quantity, price, total }]
 * @param {string} invoiceNumber
 * @param {string} [shopName]
 */
function renderInvoiceText(order, items, invoiceNumber, shopName) {
    const lines = [
        '🧾 ইনভয়েস / INVOICE',
        '────────────────',
        `ইনভয়েস নং: ${invoiceNumber}`,
        `অর্ডার নং: #${order.order_number}`,
        `তারিখ: ${formatDate(order.createdAt || order.created_at)}`,
        '',
    ];

    for (const item of items) {
        const qty = item.quantity || 1;
        const lineTotal = item.total != null ? asNumber(item.total) : asNumber(item.price) * qty;
        lines.push(`🛍️ ${item.name} x${qty} — ৳${lineTotal}`);
    }

    const deliveryFee = asNumber(order.delivery_fee);
    const discount = asNumber(order.discount);
    if (deliveryFee > 0) lines.push(`🚚 ডেলিভারি চার্জ / Delivery: ৳${deliveryFee}`);
    if (discount > 0) lines.push(`🏷️ ডিসকাউন্ট / Discount: -৳${discount}`);
    lines.push(`💰 সর্বমোট / Total: ৳${asNumber(order.total)}`);
    lines.push('');

    const methodLabel = PAYMENT_METHOD_LABELS[order.payment_method] || order.payment_method || 'N/A';
    const statusLabel = PAYMENT_STATUS_LABELS[order.payment_status] || order.payment_status || '';
    lines.push(`💳 পেমেন্ট: ${methodLabel}${statusLabel ? ` — ${statusLabel}` : ''}`);

    const address = formatAddress(order.delivery_address);
    if (address) lines.push(`📍 ঠিকানা: ${address}`);
    if (order.customer_name) {
        lines.push(`👤 ${order.customer_name}${order.customer_phone ? ` | 📞 ${order.customer_phone}` : ''}`);
    }

    lines.push('');
    lines.push(`${shopName ? `${shopName} — ` : ''}আপনার অর্ডারের জন্য ধন্যবাদ! 🙏`);

    return lines.join('\n');
}

/**
 * Load display items for an order. Prefers caller-provided items (the chatbot
 * session already knows name/price/qty); falls back to order_items rows.
 */
async function loadItems(order, items) {
    if (Array.isArray(items) && items.length) return items;

    const { OrderItem, Product } = require('../entities');
    const rows = await OrderItem.findAll({
        where: { order_id: order.id },
        include: [{ model: Product, as: 'product', attributes: ['id', 'name'] }],
    }).catch(() => []);

    if (rows.length) {
        return rows.map(r => ({
            name: r.product?.name || 'Product',
            quantity: r.quantity || 1,
            price: asNumber(r.price),
            total: asNumber(r.total),
        }));
    }

    // Last resort: single synthetic line so the invoice still balances.
    return [{ name: 'Order items', quantity: 1, price: asNumber(order.subtotal), total: asNumber(order.subtotal) }];
}

/**
 * Create (or fetch) the invoice for an order and render its chat text.
 * Idempotent per order — a retried confirmation returns the same invoice.
 *
 * @param {object} order - created Order row
 * @param {object} [opts]
 * @param {Array}  [opts.items]   - display items [{ name, quantity, price, total }]
 * @param {string} [opts.channel] - delivery channel recorded on the invoice (e.g. 'messenger')
 * @returns {Promise<{invoice: object, text: string}>}
 */
async function issueInvoiceForOrder(order, { items = null, channel = 'chat' } = {}) {
    if (!order || !order.id) throw new Error('issueInvoiceForOrder: order with id is required');

    const shop = await Shop.findByPk(order.shop_id, { attributes: ['id', 'name'] }).catch(() => null);
    const displayItems = await loadItems(order, items);

    let invoice = await OrderInvoice.findOne({ where: { order_id: order.id } });
    if (!invoice) {
        invoice = await OrderInvoice.create({
            order_id: order.id,
            shop_id: order.shop_id,
            // Tied to the (unique) order number so it's recognisable in support chats.
            invoice_number: `INV-${order.order_number}`,
            status: 'sent',
            sent_via: [channel],
            customer_info: {
                name: order.customer_name || null,
                phone: order.customer_phone || null,
            },
            order_data: {
                order_number: order.order_number,
                items: displayItems,
                subtotal: asNumber(order.subtotal),
                discount: asNumber(order.discount),
                delivery_fee: asNumber(order.delivery_fee),
                total: asNumber(order.total),
            },
            payment_info: {
                method: order.payment_method || null,
                status: order.payment_status || null,
            },
            delivery_info: {
                address: formatAddress(order.delivery_address),
                zone: order.delivery_zone || null,
            },
        });
    }

    const text = renderInvoiceText(order, displayItems, invoice.invoice_number, shop?.name);
    return { invoice, text };
}

module.exports = { issueInvoiceForOrder, renderInvoiceText };
