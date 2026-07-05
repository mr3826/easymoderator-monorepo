/**
 * Owner Notification Service
 * Handles multi-channel notifications to shop owners for payment confirmations
 * Supports Facebook Messenger, Email, and Dashboard notifications.
 * WhatsApp removed from product scope 2026-05-20.
 */

const { OwnerNotification, Shop, User, UserShop } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { sendEmail } = require('../../utils/email.service');
const { createLogger } = require('../../utils/structured-logger');

class OwnerNotificationService {
    constructor() {
        this.logger = createLogger();
    }

    /**
     * Send payment confirmation request to shop owner
     * Uses all available channels for maximum reach
     */
    async sendPaymentConfirmationRequest(shopId, orderData, paymentInfo) {
        try {
            // Get shop owner information
            const shopOwner = await this.getShopOwner(shopId);
            if (!shopOwner) {
                throw new AppError('Shop owner not found', 404);
            }

            // Create notification record
            const notification = await this.createNotification({
                shopId,
                type: 'payment_confirmation',
                customerMessage: paymentInfo.customerMessage,
                customerData: {
                    orderId: orderData.id,
                    orderNumber: orderData.order_number,
                    customerName: orderData.customer_name,
                    customerPhone: orderData.customer_phone,
                    amount: orderData.total,
                    paymentMethod: paymentInfo.paymentMethod,
                    transactionId: paymentInfo.transactionId,
                    screenshotUrl: paymentInfo.screenshotUrl
                },
                status: 'pending'
            });

            // Prepare notification content
            const notificationContent = this.formatPaymentConfirmationMessage(
                orderData, 
                paymentInfo, 
                notification.id
            );

            // Send via all available channels
            const results = await Promise.allSettled([
                this.sendViaFacebook(shopId, shopOwner, notificationContent),
                this.sendViaEmail(shopOwner, notificationContent),
                this.createDashboardNotification(shopId, notificationContent)
            ]);

            // Log results
            const successfulChannels = results
                .map((result, index) => {
                    const channels = ['facebook', 'email', 'dashboard'];
                    return result.status === 'fulfilled' ? channels[index] : null;
                })
                .filter(Boolean);

            this.logger.info('Payment confirmation request sent', {
                shopId,
                orderId: orderData.id,
                notificationId: notification.id,
                successfulChannels
            });

            return {
                success: true,
                notificationId: notification.id,
                channelsUsed: successfulChannels,
                message: 'Payment confirmation request sent to shop owner'
            };

        } catch (error) {
            this.logger.error('Failed to send payment confirmation request', {
                shopId,
                orderId: orderData.id,
                error: error.message
            });
            throw new AppError('Failed to send payment confirmation request', 500);
        }
    }

    /**
     * Handle owner's response to payment confirmation
     */
    async handleOwnerResponse(notificationId, response, ownerInfo) {
        try {
            const notification = await OwnerNotification.findByPk(notificationId);
            if (!notification) {
                throw new AppError('Notification not found', 404);
            }

            // Update notification with owner response
            await notification.update({
                owner_response: response,
                status: 'completed',
                responded_at: new Date(),
                owner_info: ownerInfo
            });

            // Process the response
            if (response === 'approve') {
                await this.approvePayment(notification);
            } else if (response === 'reject') {
                await this.rejectPayment(notification);
            }

            // Send confirmation back to customer
            await this.sendCustomerResponse(notification, response);

            this.logger.info('Owner payment confirmation processed', {
                notificationId,
                response,
                orderId: notification.customer_data.orderId
            });

            return {
                success: true,
                message: `Payment ${response}d successfully`,
                orderId: notification.customer_data.orderId
            };

        } catch (error) {
            this.logger.error('Failed to handle owner response', {
                notificationId,
                response,
                error: error.message
            });
            throw new AppError('Failed to handle owner response', 500);
        }
    }

    /**
     * Get shop owner information
     */
    async getShopOwner(shopId) {
        const userShop = await UserShop.findOne({
            where: {
                shop_id: shopId,
                role: 'owner',
                is_active: true
            },
            include: [{
                model: User,
                as: 'user',
                attributes: ['id', 'name', 'email', 'phone']
            }]
        });

        return userShop?.user || null;
    }

    /**
     * Create notification record
     */
    async createNotification(data) {
        return await OwnerNotification.create({
            shop_id: data.shopId,
            type: data.type,
            customer_message: data.customerMessage,
            customer_data: data.customerData,
            status: data.status,
            created_at: new Date()
        });
    }

    /**
     * Format payment confirmation message
     */
    formatPaymentConfirmationMessage(orderData, paymentInfo, notificationId) {
        const approveUrl = `${process.env.BASE_URL}/api/webhooks/owner/payment-confirmation/${notificationId}/approve`;
        const rejectUrl = `${process.env.BASE_URL}/api/webhooks/owner/payment-confirmation/${notificationId}/reject`;

        return `💰 পেমেন্ট নিশ্চিতকরণ প্রয়োজন!

📋 অর্ডার তথ্য:
• অর্ডার নম্বর: #${orderData.order_number}
• কাস্টমার: ${orderData.customer_name}
• ফোন: ${orderData.customer_phone}
• পরিমাণ: ৳${orderData.total}
• পেমেন্ট পদ্ধতি: ${paymentInfo.paymentMethod.toUpperCase()}

💳 পেমেন্ট তথ্য:
• ট্রানজেকশন ID: ${paymentInfo.transactionId}
• কাস্টমার বার্তা: "${paymentInfo.customerMessage}"
${paymentInfo.screenshotUrl ? `• স্ক্রিনশট: ${paymentInfo.screenshotUrl}` : ''}

🔘 সিদ্ধান্ত নিন:
✅ অনুমোদন করতে: ${approveUrl}
❌ বাতিল করতে: ${rejectUrl}

---

💰 Payment Confirmation Required!

📋 Order Details:
• Order Number: #${orderData.order_number}
• Customer: ${orderData.customer_name}
• Phone: ${orderData.customer_phone}
• Amount: ৳${orderData.total}
• Payment Method: ${paymentInfo.paymentMethod.toUpperCase()}

💳 Payment Info:
• Transaction ID: ${paymentInfo.transactionId}
• Customer Message: "${paymentInfo.customerMessage}"
${paymentInfo.screenshotUrl ? `• Screenshot: ${paymentInfo.screenshotUrl}` : ''}

🔘 Make Decision:
✅ Approve: ${approveUrl}
❌ Reject: ${rejectUrl}`;
    }

    /**
     * Send notification via Facebook Messenger
     */
    async sendViaFacebook(shopId, owner, message) {
        // Delivering an owner (merchant) notification over Messenger would require
        // the owner's Meta PSID — which we do not have; `owner` is a merchant User,
        // not a Meta customer, and `owner.phone` is a phone number the Graph API
        // does not accept as a recipient. Owners are reliably reached via email and
        // web push (see sendViaEmail / push), so this channel is intentionally a
        // no-op rather than an undeliverable send. (Previously this looked up an
        // undefined `Channel` model and threw on every call.)
        return { success: false, reason: 'fb_owner_unsupported' };
    }

    /**
     * Send notification via Email
     */
    async sendViaEmail(owner, message) {
        try {
            if (!owner.email) {
                return { success: false, reason: 'no_email' };
            }

            const subject = '🔔 Payment Confirmation Required - EasyModerator';
            const html = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 10px;">
                        <h2 style="color: #333; margin-bottom: 20px;">💰 Payment Confirmation Required</h2>
                        <div style="background-color: white; padding: 20px; border-radius: 8px; white-space: pre-wrap;">${message}</div>
                        <p style="margin-top: 20px; font-size: 12px; color: #666;">
                            Please click the links above to approve or reject the payment.
                        </p>
                    </div>
                </div>
            `;

            await sendEmail({
                to: owner.email,
                subject,
                text: message,
                html
            });

            return { success: true, channel: 'email' };

        } catch (error) {
            this.logger.warn('Email notification failed', {
                email: owner.email,
                error: error.message
            });
            return { success: false, reason: 'send_error', error: error.message };
        }
    }

    /**
     * Create dashboard notification
     */
    async createDashboardNotification(shopId, message) {
        try {
            // This would integrate with your frontend notification system
            // For now, we'll just log it
            this.logger.info('Dashboard notification created', {
                shopId,
                message: message.substring(0, 100) + '...'
            });

            return { success: true, channel: 'dashboard' };

        } catch (error) {
            this.logger.warn('Dashboard notification failed', {
                shopId,
                error: error.message
            });
            return { success: false, reason: 'creation_error', error: error.message };
        }
    }

    /**
     * Approve payment and update order
     */
    async approvePayment(notification) {
        const { Order } = require('../entities');
        const { PaymentTransaction } = require('../entities');

        // Update order status
        await Order.update({
            payment_status: 'paid',
            paid_at: new Date(),
            order_status: 'confirmed'
        }, {
            where: { id: notification.customer_data.orderId }
        });

        // Update payment transaction
        await PaymentTransaction.update({
            status: 'verified',
            verified_at: new Date()
        }, {
            where: { transaction_id: notification.customer_data.transactionId }
        });

        // Trigger order confirmation flow
        const orderService = require('../order/order.service');
        await orderService.confirmOrderInternal(notification.customer_data.orderId, notification.shop_id);
    }

    /**
     * Reject payment
     */
    async rejectPayment(notification) {
        const { Order } = require('../entities');
        const { PaymentTransaction } = require('../entities');

        // Update order status
        await Order.update({
            payment_status: 'failed',
            order_status: 'cancelled'
        }, {
            where: { id: notification.customer_data.orderId }
        });

        // Update payment transaction
        await PaymentTransaction.update({
            status: 'rejected'
        }, {
            where: { transaction_id: notification.customer_data.transactionId }
        });
    }

    /**
     * Send response back to customer
     */
    async sendCustomerResponse(notification, response) {
        try {
            const customerMessage = response === 'approve' 
                ? `✅ আপনার পেমেন্ট নিশ্চিত হয়েছে! অর্ডার #${notification.customer_data.orderNumber} নিশ্চিত করা হয়েছে। ডেলিভারি প্রক্রিয়া শুরু হবে।\n\n✅ Your payment has been confirmed! Order #${notification.customer_data.orderNumber} is confirmed. Delivery process will start.`
                : `❌ আপনার পেমেন্ট নিশ্চিত করা হয়নি। অনুগ্রহ করে আবার চেষ্টা করুন বা দোকানের সাথে যোগাযোগ করুন।\n\n❌ Your payment could not be confirmed. Please try again or contact the shop.`;

            // Resolve the order's customer and send to their PSID. (The old code
            // looked up an undefined `Channel` model and passed a phone number as
            // the Meta recipient, so this confirmation silently never reached the
            // customer.)
            const orderId = notification.customer_data?.orderId;
            if (!orderId) {
                this.logger.info('No orderId on notification — cannot send customer response', {
                    notificationId: notification.id
                });
                return;
            }
            const { Order } = require('../entities');
            const order = await Order.findOne({ where: { id: orderId, shop_id: notification.shop_id } });
            if (!order || !order.customer_id) {
                this.logger.info('No customer linked to order — skipping customer response', {
                    notificationId: notification.id
                });
                return;
            }
            const webhookService = require('../webhook/webhook.service');
            await webhookService.sendToCustomer({
                shopId: notification.shop_id,
                customerId: order.customer_id,
                message: customerMessage,
            });

        } catch (error) {
            this.logger.warn('Failed to send customer response', {
                notificationId: notification.id,
                response,
                error: error.message
            });
        }
    }

    /**
     * Get pending notifications for shop
     */
    async getPendingNotifications(shopId, limit = 10) {
        return await OwnerNotification.findAll({
            where: {
                shop_id: shopId,
                status: 'pending'
            },
            order: [['created_at', 'DESC']],
            limit
        });
    }

    /**
     * Get notification by ID
     */
    async getNotificationById(notificationId, shopId) {
        const notification = await OwnerNotification.findOne({
            where: {
                id: notificationId,
                shop_id: shopId
            }
        });

        if (!notification) {
            throw new AppError('Notification not found', 404);
        }

        return notification;
    }
}

module.exports = new OwnerNotificationService();
