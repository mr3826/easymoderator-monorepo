/**
 * Invoice Service
 * Generates PDF invoices and handles multi-channel delivery
 * Cost-optimized with Puppeteer for PDF generation
 */

const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { OrderInvoice, Order, Shop, Customer } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');
const { getOrigins, joinOrigin } = require('../../config/origins');

class InvoiceService {
    constructor() {
        this.logger = createLogger();
        this.invoiceDir = path.join(__dirname, '../../../uploads/invoices');
        this.ensureInvoiceDirectory();
    }

    /**
     * Ensure invoice directory exists
     */
    async ensureInvoiceDirectory() {
        try {
            await fs.mkdir(this.invoiceDir, { recursive: true });
        } catch (error) {
            // Directory might already exist
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
    }

    /**
     * Generate invoice for order
     */
    async generateInvoice(order) {
        try {
            // Generate invoice number
            const invoiceNumber = this.generateInvoiceNumber(order);
            
            // Get shop and customer details
            const shop = await Shop.findByPk(order.shop_id);
            const customer = order.customer_id ? await Customer.findByPk(order.customer_id) : null;

            // Prepare invoice data
            const invoiceData = {
                invoiceNumber,
                order,
                shop,
                customer,
                items: order.items || await this.getOrderItems(order),
                subtotal: order.subtotal,
                tax: order.tax || 0,
                deliveryFee: order.delivery_fee || 0,
                total: order.total,
                paymentMethod: order.payment_method,
                paymentStatus: order.payment_status,
                orderDate: order.created_at,
                dueDate: order.payment_status === 'paid' ? order.paid_at : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            };

            // Generate PDF
            const pdfUrl = await this.generatePDFInvoice(invoiceData);

            // Create invoice record
            const invoice = await OrderInvoice.create({
                order_id: order.id,
                shop_id: order.shop_id,
                invoice_number: invoiceNumber,
                pdf_url: pdfUrl,
                status: 'generated',
                customer_info: {
                    name: order.customer_name,
                    phone: order.customer_phone,
                    email: customer?.email
                },
                order_data: {
                    order_number: order.order_number,
                    items: invoiceData.items,
                    subtotal: order.subtotal,
                    tax: order.tax,
                    delivery_fee: order.delivery_fee,
                    total: order.total
                },
                payment_info: {
                    method: order.payment_method,
                    status: order.payment_status,
                    paid_at: order.paid_at
                },
                tax_info: {
                    tax_rate: 0, // Can be configured per shop
                    tax_amount: order.tax || 0
                },
                delivery_info: {
                    address: order.delivery_address,
                    zone: order.delivery_zone,
                    provider: order.delivery_provider,
                    tracking_code: order.delivery_tracking_code
                },
                qr_code_url: await this.generateQRCode(invoiceData)
            });

            // Send invoice to customer
            await this.sendInvoiceToCustomer(invoice, invoiceData);

            this.logger.info('Invoice generated successfully', {
                invoiceId: invoice.id,
                orderId: order.id,
                invoiceNumber
            });

            return invoice;

        } catch (error) {
            this.logger.error('Failed to generate invoice', {
                orderId: order.id,
                error: error.message
            });
            throw new AppError('Failed to generate invoice', 500);
        }
    }

    /**
     * Generate invoice number
     */
    generateInvoiceNumber(order) {
        const now = new Date();
        const yearMonth = now.toISOString().substring(0, 7).replace('-', '');
        const timestamp = now.getTime().toString().slice(-6);
        const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        return `INV-${yearMonth}-${timestamp}${random}`;
    }

    /**
     * Get order items (if not already available)
     */
    async getOrderItems(order) {
        const { OrderItem, Product } = require('../entities');
        
        const orderItems = await OrderItem.findAll({
            where: { order_id: order.id },
            include: [{
                model: Product,
                as: 'product',
                attributes: ['id', 'name', 'price', 'image_url']
            }]
        });

        return orderItems.map(item => ({
            name: item.product?.name || 'Product',
            price: item.price,
            quantity: item.quantity,
            total: item.total,
            image_url: item.product?.image_url
        }));
    }

    /**
     * Generate PDF invoice using Puppeteer
     */
    async generatePDFInvoice(invoiceData) {
        let browser;
        try {
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            const page = await browser.newPage();
            
            // Generate HTML content
            const htmlContent = this.generateInvoiceHTML(invoiceData);
            
            // Set content and generate PDF
            await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
            
            const pdfBuffer = await page.pdf({
                format: 'A4',
                printBackground: true,
                margin: {
                    top: '20mm',
                    right: '20mm',
                    bottom: '20mm',
                    left: '20mm'
                }
            });

            // Save PDF file
            const fileName = `${invoiceData.invoiceNumber}.pdf`;
            const filePath = path.join(this.invoiceDir, fileName);
            await fs.writeFile(filePath, pdfBuffer);

            // Return public URL
            return joinOrigin(getOrigins().publicAssets, `/uploads/invoices/${fileName}`);

        } catch (error) {
            this.logger.error('PDF generation failed', { error: error.message });
            throw error;
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }

    /**
     * Generate HTML content for invoice
     */
    generateInvoiceHTML(invoiceData) {
        const { invoice, shop, customer, items, subtotal, tax, deliveryFee, total, paymentMethod, paymentStatus, orderDate, dueDate } = invoiceData;

        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Invoice ${invoice.invoiceNumber}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #333; }
        .invoice { max-width: 800px; margin: 0 auto; border: 1px solid #ddd; }
        .header { padding: 20px; border-bottom: 2px solid #007bff; background: #f8f9fa; }
        .shop-info { float: left; width: 60%; }
        .invoice-info { float: right; width: 40%; text-align: right; }
        .clear { clear: both; }
        .customer { padding: 20px; border-bottom: 1px solid #ddd; }
        .items { padding: 20px; }
        .items table { width: 100%; border-collapse: collapse; }
        .items th, .items td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        .items th { background: #f8f9fa; font-weight: bold; }
        .totals { padding: 20px; text-align: right; }
        .totals table { width: 300px; border-collapse: collapse; }
        .totals td { padding: 5px; }
        .footer { padding: 20px; border-top: 1px solid #ddd; text-align: center; font-size: 12px; color: #666; }
        .paid { color: #28a745; font-weight: bold; }
        .pending { color: #ffc107; font-weight: bold; }
        .qr-code { text-align: center; margin: 20px 0; }
        .qr-code img { max-width: 150px; }
    </style>
</head>
<body>
    <div class="invoice">
        <div class="header">
            <div class="shop-info">
                <h2>${shop.name}</h2>
                <p>${shop.address || 'Address not available'}</p>
                <p>Phone: ${shop.phone || 'N/A'}</p>
                <p>Email: ${shop.email || 'N/A'}</p>
            </div>
            <div class="invoice-info">
                <h3>INVOICE</h3>
                <p><strong>Invoice #:</strong> ${invoice.invoiceNumber}</p>
                <p><strong>Order #:</strong> ${order.order_number}</p>
                <p><strong>Date:</strong> ${orderDate.toLocaleDateString()}</p>
                <p><strong>Due Date:</strong> ${dueDate.toLocaleDateString()}</p>
                <p><strong>Status:</strong> <span class="${paymentStatus}">${paymentStatus.toUpperCase()}</span></p>
            </div>
            <div class="clear"></div>
        </div>

        <div class="customer">
            <h3>Bill To:</h3>
            <p><strong>Name:</strong> ${customer.name}</p>
            <p><strong>Phone:</strong> ${customer.phone}</p>
            <p><strong>Address:</strong> ${order.delivery_address}</p>
            ${customer.email ? `<p><strong>Email:</strong> ${customer.email}</p>` : ''}
        </div>

        <div class="items">
            <h3>Order Details</h3>
            <table>
                <thead>
                    <tr>
                        <th>Item</th>
                        <th>Price</th>
                        <th>Quantity</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(item => `
                        <tr>
                            <td>${item.name}</td>
                            <td>৳${item.price.toFixed(2)}</td>
                            <td>${item.quantity}</td>
                            <td>৳${item.total.toFixed(2)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div class="totals">
            <table>
                <tr>
                    <td><strong>Subtotal:</strong></td>
                    <td>৳${subtotal.toFixed(2)}</td>
                </tr>
                ${tax > 0 ? `
                <tr>
                    <td><strong>Tax:</strong></td>
                    <td>৳${tax.toFixed(2)}</td>
                </tr>
                ` : ''}
                <tr>
                    <td><strong>Delivery Fee:</strong></td>
                    <td>৳${deliveryFee.toFixed(2)}</td>
                </tr>
                <tr>
                    <td><strong>Total:</strong></td>
                    <td><strong>৳${total.toFixed(2)}</strong></td>
                </tr>
                <tr>
                    <td><strong>Payment Method:</strong></td>
                    <td>${paymentMethod ? paymentMethod.toUpperCase() : 'N/A'}</td>
                </tr>
            </table>
        </div>

        ${invoice.qr_code_url ? `
        <div class="qr-code">
            <p>Scan for order details</p>
            <img src="${invoice.qr_code_url}" alt="QR Code" />
        </div>
        ` : ''}

        <div class="footer">
            <p>Thank you for your business!</p>
            <p>This is a computer-generated invoice. No signature required.</p>
            <p>For questions, please contact: ${shop.phone || shop.email}</p>
        </div>
    </div>
</body>
</html>`;
    }

    /**
     * Generate QR code for invoice
     */
    async generateQRCode(invoiceData) {
        try {
            // Simple QR code generation using a free service
            // In production, you might want to use a proper QR code library
            const qrData = JSON.stringify({
                invoice: invoiceData.invoiceNumber,
                order: invoiceData.order.order_number,
                amount: invoiceData.total,
                shop: invoiceData.shop.name
            });

            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrUrl)}`;
            return qrUrl;

        } catch (error) {
            this.logger.warn('QR code generation failed', { error: error.message });
            return null;
        }
    }

    /**
     * Send invoice to customer via multiple channels
     */
    async sendInvoiceToCustomer(invoice, invoiceData) {
        try {
            const channels = [];
            
            // Send via Facebook/Instagram channel — resolve the customer's PSID from
            // the order. (The old code looked up an undefined `Channel` model and
            // passed a phone number as the Meta recipient.)
            try {
                const webhookService = require('../webhook/webhook.service');

                if (invoiceData.order?.customer_id) {
                    const message = `📄 ইনভয়েস তৈরি হয়েছে!\n\nইনভয়েস নম্বর: ${invoice.invoice_number}\nঅর্ডার: #${invoiceData.order.order_number}\nপরিমাণ: ৳${invoiceData.total}\n\nইনভয়েস ডাউনলোড করতে: ${invoice.pdf_url}\n\n---\n\n📄 Invoice generated!\n\nInvoice Number: ${invoice.invoice_number}\nOrder: #${invoiceData.order.order_number}\nAmount: ৳${invoiceData.total}\n\nDownload invoice: ${invoice.pdf_url}`;

                    const result = await webhookService.sendToCustomer({
                        shopId: invoice.shop_id,
                        customerId: invoiceData.order.customer_id,
                        message,
                    });
                    if (result.sent) channels.push('facebook/instagram');
                }
            } catch (error) {
                this.logger.warn('Failed to send invoice via chat', { error: error.message });
            }

            // Send via email
            if (invoiceData.customer.email) {
                try {
                    const { sendEmail } = require('../../utils/email.service');
                    
                    const subject = `Invoice ${invoice.invoice_number} - ${invoiceData.shop.name}`;
                    const html = `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2>📄 Invoice Generated</h2>
                            <p>Dear ${invoiceData.customer.name},</p>
                            <p>Your invoice has been generated for order #${invoiceData.order.order_number}.</p>
                            <div style="background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
                                <p><strong>Invoice Number:</strong> ${invoice.invoice_number}</p>
                                <p><strong>Order Number:</strong> #${invoiceData.order.order_number}</p>
                                <p><strong>Amount:</strong> ৳${invoiceData.total}</p>
                                <p><strong>Payment Status:</strong> ${invoiceData.paymentStatus}</p>
                            </div>
                            <p><a href="${invoice.pdf_url}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Download Invoice</a></p>
                            <p>Thank you for your business!</p>
                        </div>
                    `;
                    
                    await sendEmail({
                        to: invoiceData.customer.email,
                        subject,
                        text: `Invoice ${invoice.invoice_number} generated. Download: ${invoice.pdf_url}`,
                        html
                    });
                    
                    channels.push('email');
                } catch (error) {
                    this.logger.warn('Failed to send invoice via email', { error: error.message });
                }
            }

            // Update invoice with sent channels
            await invoice.update({
                sent_via: channels,
                status: 'sent'
            });

            this.logger.info('Invoice sent to customer', {
                invoiceId: invoice.id,
                channels
            });

        } catch (error) {
            this.logger.error('Failed to send invoice to customer', {
                invoiceId: invoice.id,
                error: error.message
            });
        }
    }

    /**
     * Get invoice by ID
     */
    async getInvoiceById(invoiceId, shopId) {
        const invoice = await OrderInvoice.findOne({
            where: { id: invoiceId, shop_id: shopId },
            include: [{
                model: Order,
                as: 'order',
                include: [{
                    model: Customer,
                    as: 'customer'
                }]
            }]
        });

        if (!invoice) {
            throw new AppError('Invoice not found', 404);
        }

        return invoice;
    }

    /**
     * Get invoices for shop
     */
    async getInvoicesByShop(shopId, options = {}) {
        const whereClause = { shop_id: shopId };
        
        if (options.status && options.status !== 'all') {
            whereClause.status = options.status;
        }

        const invoices = await OrderInvoice.findAll({
            where: whereClause,
            include: [{
                model: Order,
                as: 'order',
                attributes: ['order_number', 'customer_name', 'total', 'created_at']
            }],
            order: [['created_at', 'DESC']],
            limit: options.limit || 20
        });

        return invoices;
    }

    /**
     * Regenerate invoice
     */
    async regenerateInvoice(invoiceId, shopId) {
        const invoice = await this.getInvoiceById(invoiceId, shopId);
        
        if (!invoice.order) {
            throw new AppError('Order not found for invoice', 404);
        }

        // Generate new invoice
        const newInvoice = await this.generateInvoice(invoice.order);
        
        // Mark old invoice as replaced
        await invoice.update({
            status: 'replaced'
        });

        return newInvoice;
    }
}

module.exports = new InvoiceService();
