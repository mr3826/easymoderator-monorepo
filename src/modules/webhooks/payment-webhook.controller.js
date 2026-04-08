/**
 * Payment Webhook Controller
 * Handles webhook callbacks from payment gateways (bKash, Nagad, AamarPay, SSLCommerz)
 * Updates payment status and triggers order confirmation
 */

const { PaymentTransaction, Order, OrderSession } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');
const bkashService = require('../payment/bkash-merchant.service');
const nagadService = require('../payment/nagad-merchant.service');
const paymentService = require('../payment/payment.service');

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

            // Update payment transaction
            await paymentTransaction.update({
                status: transactionStatus === 'Completed' ? 'paid' : 'failed',
                gateway_response: req.body,
                verified_at: transactionStatus === 'Completed' ? new Date() : null
            });

            // If payment successful, update order and trigger fulfillment
            if (transactionStatus === 'Completed') {
                await this.processSuccessfulPayment(paymentTransaction, {
                    gateway: 'bkash',
                    transactionId: trxID,
                    amount
                });
            }

            res.status(200).json({ success: true });

        } catch (error) {
            this.logger.error('bKash webhook error', { error: error.message });
            res.status(500).json({ error: 'Webhook processing failed' });
        }
    }

    /**
     * Handle Nagad payment status webhook
     */
    async handleNagadWebhook(req, res) {
        try {
            const { paymentReferenceId, paymentStatus, transactionId, orderId, amount } = req.body;

            this.logger.info('Nagad webhook received', {
                paymentReferenceId,
                paymentStatus,
                transactionId,
                orderId,
                amount
            });

            // Find payment transaction
            const paymentTransaction = await PaymentTransaction.findOne({
                where: { transaction_id: paymentReferenceId }
            });

            if (!paymentTransaction) {
                this.logger.warn('Payment transaction not found', { paymentReferenceId });
                return res.status(404).json({ error: 'Payment transaction not found' });
            }

            // Update payment transaction
            await paymentTransaction.update({
                status: paymentStatus === 'Success' ? 'paid' : 'failed',
                gateway_response: req.body,
                verified_at: paymentStatus === 'Success' ? new Date() : null
            });

            // If payment successful, update order and trigger fulfillment
            if (paymentStatus === 'Success') {
                await this.processSuccessfulPayment(paymentTransaction, {
                    gateway: 'nagad',
                    transactionId,
                    amount
                });
            }

            res.status(200).json({ success: true });

        } catch (error) {
            this.logger.error('Nagad webhook error', { error: error.message });
            res.status(500).json({ error: 'Webhook processing failed' });
        }
    }

    /**
     * Handle AamarPay payment status webhook
     */
    async handleAamarPayWebhook(req, res) {
        try {
            const callbackData = req.body;

            this.logger.info('AamarPay webhook received', {
                mer_txnid: callbackData.mer_txnid,
                pay_status: callbackData.pay_status
            });

            // Use existing AamarPay verification logic
            const result = await paymentService.verifyAamarPayCallback(callbackData);

            if (result.success && result.order) {
                await this.processSuccessfulPayment(null, {
                    gateway: 'aamarpay',
                    transactionId: callbackData.mer_txnid,
                    order: result.order
                });
            }

            res.status(200).json({ success: true });

        } catch (error) {
            this.logger.error('AamarPay webhook error', { error: error.message });
            res.status(500).json({ error: 'Webhook processing failed' });
        }
    }

    /**
     * Handle SSLCommerz payment status webhook
     */
    async handleSSLCommerzWebhook(req, res) {
        try {
            const callbackData = req.body;

            this.logger.info('SSLCommerz webhook received', {
                tran_id: callbackData.tran_id,
                status: callbackData.status
            });

            // Use existing SSLCommerz verification logic
            const result = await paymentService.verifySSLCommerzCallback(callbackData);

            if (result.success && result.order) {
                await this.processSuccessfulPayment(null, {
                    gateway: 'sslcommerz',
                    transactionId: callbackData.tran_id,
                    order: result.order
                });
            }

            res.status(200).json({ success: true });

        } catch (error) {
            this.logger.error('SSLCommerz webhook error', { error: error.message });
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

            // Trigger invoice generation
            const invoiceService = require('../invoice/invoice.service');
            await invoiceService.generateInvoice(order);

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
            const { Channel } = require('../entities');

            // Find active channel for the shop
            const channel = await Channel.findOne({
                where: {
                    shop_id: order.shop_id,
                    is_active: true
                },
                order: [['created_at', 'DESC']]
            });

            if (!channel) {
                this.logger.warn('No active channel found for payment confirmation');
                return;
            }

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

            // Find customer channel ID
            const customerChannelId = order.customer_id || order.customer_phone;
            
            if (customerChannelId) {
                await webhookService.sendMessage(channel, customerChannelId, confirmationMessage);
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
