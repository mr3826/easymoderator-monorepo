/**
 * Payment Webhook Controller
 * Handles webhook callbacks from bKash.
 * Updates payment status and triggers order confirmation.
 */

const { PaymentTransaction, Order, OrderSession } = require('../entities');
const { Op } = require('sequelize');
const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');
const bkashService = require('../payment/bkash-merchant.service');
const paymentService = require('../payment/payment.service');
const OrderSessionService = require('../order/order-session-standalone.service');

function normalizeAmountToMinorUnits(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
    const [whole, fraction = ''] = text.split('.');
    return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
}

class PaymentWebhookController {
    constructor() {
        this.logger = createLogger();
    }

    /**
     * Handle bKash payment status webhook
     */
    async handleBkashWebhook(req, res) {
        try {
            const { paymentID, transactionStatus, trxID, merchantInvoiceNumber, amount } = req.body;

            this.logger.info('bKash webhook received', {
                paymentID,
                transactionStatus,
                trxID,
                merchantInvoiceNumber,
                amount
            });

            // Find payment transaction
            const paymentTransaction = await PaymentTransaction.findOne({
                where: { transaction_id: paymentID }
            });

            if (!paymentTransaction) {
                this.logger.warn('Payment transaction not found', { paymentID });
                return res.status(404).json({ error: 'Payment transaction not found' });
            }

            // If payment successful, update order and trigger fulfillment
            if (transactionStatus === 'Completed') {
                if (['paid', 'verified'].includes(paymentTransaction.status)) {
                    return res.status(200).json({ success: true, duplicate: true });
                }

                if (paymentTransaction.status === 'processing') {
                    return res.status(202).json({ success: true, pending: true });
                }

                const claimableStatuses = ['pending', 'initiated', 'failed'];
                if (!claimableStatuses.includes(paymentTransaction.status)) {
                    return res.status(409).json({ error: 'Invalid payment state transition' });
                }

                const expectedAmount = normalizeAmountToMinorUnits(paymentTransaction.amount);
                const providerAmount = normalizeAmountToMinorUnits(amount);
                if (expectedAmount === null || providerAmount === null || expectedAmount !== providerAmount) {
                    this.logger.warn('bKash webhook amount mismatch', {
                        paymentID,
                        expectedAmount: paymentTransaction.amount,
                        providerAmount: amount,
                    });
                    return res.status(400).json({ error: 'Payment amount mismatch' });
                }

                // Claim the callback atomically. Concurrent/replayed callbacks cannot
                // execute order fulfillment, delivery booking, or notifications twice.
                const [claimed] = await PaymentTransaction.update({
                    status: 'processing',
                    gateway_response: req.body
                }, {
                    where: {
                        id: paymentTransaction.id,
                        status: { [Op.in]: claimableStatuses }
                    }
                });

                if (claimed !== 1) {
                    return res.status(202).json({ success: true, pending: true });
                }

                await this.processSuccessfulPayment(paymentTransaction, {
                    gateway: 'bkash',
                    transactionId: trxID,
                    amount
                });

                await paymentTransaction.update({
                    status: 'paid',
                    gateway_response: req.body,
                    verified_at: new Date()
                });
            } else {
                // A late failure callback must never downgrade a completed payment.
                if (['paid', 'verified', 'processing'].includes(paymentTransaction.status)) {
                    return res.status(200).json({ success: true, duplicate: true });
                }

                await PaymentTransaction.update({
                    status: 'failed',
                    gateway_response: req.body,
                    verified_at: null
                }, {
                    where: {
                        id: paymentTransaction.id,
                        status: { [Op.notIn]: ['paid', 'verified', 'processing'] }
                    }
                });
            }

            res.status(200).json({ success: true });

        } catch (error) {
            this.logger.error('bKash webhook error', { error: error.message });
            res.status(500).json({ error: 'Webhook processing failed' });
        }
    }

    /**
     * Process successful payment and trigger order fulfillment
     */
    async processSuccessfulPayment(paymentTransaction, paymentInfo) {
        try {
            let order;

            if (paymentTransaction) {
                // Find order by payment transaction
                order = await Order.findOne({
                    where: { id: paymentTransaction.order_id }
                });
            } else if (paymentInfo.order) {
                // Order already provided (AamarPay/SSLCommerz)
                order = paymentInfo.order;
            }

            if (!order) {
                this.logger.error('Order not found for successful payment');
                return;
            }

            // Update order payment status
            await order.update({
                payment_status: 'paid',
                paid_at: new Date(),
                payment_method_id: paymentInfo.transactionId,
                order_status: 'confirmed'
            });

            // Check if there's an active order session to complete
            const activeSession = await OrderSession.findOne({
                where: {
                    shop_id: order.shop_id,
                    customer_id: order.customer_id,
                    status: 'ACTIVE'
                },
                order: [['last_activity_at', 'DESC']]
            });

            if (activeSession) {
                // Complete the order session
                await OrderSessionService.autoConfirmOrder(activeSession);
            }

            // Trigger invoice generation. chat-invoice, NOT the legacy
            // invoice.service: that one requires puppeteer at module load, which
            // is absent from the production image — the require alone would throw
            // and abort delivery booking + customer confirmation below.
            const { issueInvoiceForOrder } = require('../invoice/chat-invoice.service');
            await issueInvoiceForOrder(order).catch(err =>
                this.logger.warn('Invoice generation failed (continuing fulfillment)', { error: err.message }));

            // Trigger delivery booking
            const deliveryService = require('../delivery/delivery.service');
            const activeProvider = await deliveryService.getActiveProvider(order.shop_id);
            
            if (activeProvider && order.total > 0) {
                const deliveryPayload = {
                    order_number: order.order_number,
                    customer_name: order.customer_name,
                    customer_phone: order.customer_phone,
                    delivery_address: order.delivery_address,
                    total: parseFloat(order.total),
                    note: order.note,
                    item_quantity: 1,
                    item_weight: 0.5,
                    item_description: `Order ${order.order_number}`,
                    delivery_type: 48
                };

                await deliveryService.createDeliveryOrder(order.shop_id, deliveryPayload);
            }

            // Send confirmation to customer
            await this.sendPaymentConfirmationToCustomer(order, paymentInfo);

            this.logger.info('Payment processed and order fulfilled', {
                orderId: order.id,
                orderNumber: order.order_number,
                gateway: paymentInfo.gateway
            });

        } catch (error) {
            this.logger.error('Failed to process successful payment', { error: error.message });
        }
    }

    /**
     * Send payment confirmation to customer
     */
    async sendPaymentConfirmationToCustomer(order, paymentInfo) {
        try {
            const webhookService = require('../webhook/webhook.service');

            const confirmationMessage = `✅ পেমেন্ট সফলভাবে সম্পন্ন হয়েছে!

📋 অর্ডার নম্বর: #${order.order_number}
💰 পরিমাণ: ৳${order.total}
💳 পেমেন্ট পদ্ধতি: ${paymentInfo.gateway.toUpperCase()}
🔗 ট্রানজেকশন ID: ${paymentInfo.transactionId}

আপনার অর্ডার নিশ্চিত হয়েছে এবং ডেলিভারি প্রক্রিয়া শুরু হবে।

---

✅ Payment completed successfully!

📋 Order Number: #${order.order_number}
💰 Amount: ৳${order.total}
💳 Payment Method: ${paymentInfo.gateway.toUpperCase()}
🔗 Transaction ID: ${paymentInfo.transactionId}

Your order is confirmed and delivery process will start.`;

            // Resolve the customer's PSID from the order and send via the live
            // provider. (The old code passed `order.customer_id` — the internal
            // Customer UUID — or a phone number as the Meta recipient, neither of
            // which the Graph API accepts, so confirmations silently never sent.)
            if (!order.customer_id) {
                this.logger.warn('No customer linked to order for payment confirmation', { orderId: order.id });
                return;
            }
            const result = await webhookService.sendToCustomer({
                shopId: order.shop_id,
                customerId: order.customer_id,
                message: confirmationMessage,
            });
            if (!result.sent) {
                this.logger.info('Payment confirmation not delivered', { orderId: order.id, reason: result.reason });
            }

        } catch (error) {
            this.logger.error('Failed to send payment confirmation', { error: error.message });
        }
    }

    /**
     * Handle owner payment confirmation webhook
     */
    async handleOwnerPaymentConfirmation(req, res) {
        try {
            const { notificationId, action } = req.params;
            const ownerInfo = req.body;

            this.logger.info('Owner payment confirmation', {
                notificationId,
                action,
                ownerInfo
            });

            const ownerNotificationService = require('../notification/owner-notification.service');
            const result = await ownerNotificationService.handleOwnerResponse(
                notificationId,
                action,
                ownerInfo
            );

            res.status(200).json(result);

        } catch (error) {
            this.logger.error('Owner payment confirmation error', { error: error.message });
            res.status(500).json({ error: 'Processing failed' });
        }
    }
}

module.exports = new PaymentWebhookController();
