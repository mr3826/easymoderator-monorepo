/**
 * Delivery Tracking Service
 * Handles automated delivery status updates and customer notifications
 * Cost-optimized with webhook-first approach and smart polling
 */

const { DeliveryTracking, Order, Shop, Channel } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');
const deliveryService = require('./delivery.service');

class DeliveryTrackingService {
    constructor() {
        this.logger = createLogger();
        this.statusMessages = {
            'picked_up': {
                bn: 'আপনার অর্ডার পিক আপ হয়েছে 📦',
                en: 'Your order has been picked up 📦'
            },
            'in_transit': {
                bn: 'আপনার পণ্য রাস্তায় 🚚',
                en: 'Your package is on the way 🚚'
            },
            'out_for_delivery': {
                bn: 'আজ ডেলিভারি হবে 🏠',
                en: 'Out for delivery today 🏠'
            },
            'delivered': {
                bn: 'পণ্য সফলভাবে ডেলিভারি হয়েছে ✅',
                en: 'Package successfully delivered ✅'
            },
            'failed_delivery': {
                bn: 'ডেলিভারি ব্যর্থ, আবার চেষ্টা করা হবে',
                en: 'Delivery failed, will retry'
            },
            'cancelled': {
                bn: 'ডেলিভারি বাতিল করা হয়েছে',
                en: 'Delivery cancelled'
            },
            'returned': {
                bn: 'পণ্য ফেরত পাঠানো হয়েছে',
                en: 'Package returned'
            }
        };
    }

    /**
     * Create delivery tracking record
     */
    async createTrackingRecord(order, deliveryResult) {
        try {
            const tracking = await DeliveryTracking.create({
                order_id: order.id,
                shop_id: order.shop_id,
                provider: deliveryResult.provider,
                tracking_number: deliveryResult.tracking_code,
                current_status: 'booked',
                status_history: [{
                    status: 'booked',
                    timestamp: new Date().toISOString(),
                    location: 'Processing center'
                }],
                estimated_delivery: deliveryResult.estimated_delivery,
                webhook_received_at: new Date()
            });

            // Update order with delivery info
            await order.update({
                delivery_provider: deliveryResult.provider,
                delivery_consignment_id: deliveryResult.consignment_id,
                delivery_tracking_code: deliveryResult.tracking_code,
                delivery_status: 'booked',
                delivery_dispatched_at: new Date()
            });

            this.logger.info('Delivery tracking created', {
                trackingId: tracking.id,
                orderId: order.id,
                provider: deliveryResult.provider,
                trackingNumber: deliveryResult.tracking_code
            });

            return tracking;

        } catch (error) {
            this.logger.error('Failed to create delivery tracking', {
                orderId: order.id,
                error: error.message
            });
            throw new AppError('Failed to create delivery tracking', 500);
        }
    }

    /**
     * Handle delivery status webhook
     */
    async handleDeliveryWebhook(provider, trackingNumber, statusData) {
        try {
            this.logger.info('Delivery webhook received', {
                provider,
                trackingNumber,
                status: statusData.status
            });

            // Find tracking record
            const tracking = await DeliveryTracking.findOne({
                where: { tracking_number: trackingNumber, provider },
                include: [{
                    model: Order,
                    as: 'order',
                    include: [{
                        model: Shop,
                        as: 'shop'
                    }]
                }]
            });

            if (!tracking) {
                this.logger.warn('Tracking record not found', { provider, trackingNumber });
                return { success: false, error: 'Tracking record not found' };
            }

            // Normalize status
            const normalizedStatus = this.normalizeStatus(provider, statusData.status);
            
            // Check if status actually changed
            if (normalizedStatus === tracking.current_status) {
                return { success: true, message: 'No status change' };
            }

            // Update tracking record
            const statusHistory = tracking.status_history || [];
            statusHistory.push({
                status: normalizedStatus,
                timestamp: new Date().toISOString(),
                location: statusData.location || 'Unknown',
                agent: statusData.delivery_agent
            });

            await tracking.update({
                previous_status: tracking.current_status,
                current_status: normalizedStatus,
                status_history,
                location_info: statusData.location,
                delivery_agent_info: statusData.delivery_agent,
                webhook_received_at: new Date(),
                last_api_check: new Date()
            });

            // Update order status
            await tracking.order.update({
                delivery_status: normalizedStatus
            });

            // Handle special cases
            if (normalizedStatus === 'delivered') {
                await tracking.order.update({
                    fulfillment_status: 'delivered',
                    order_status: 'delivered'
                });
                await this.handleSuccessfulDelivery(tracking);
            } else if (normalizedStatus.includes('cancelled') || normalizedStatus === 'returned') {
                await tracking.order.update({
                    fulfillment_status: 'cancelled',
                    order_status: 'cancelled'
                });
                await this.handleFailedDelivery(tracking);
            }

            // Send customer notification
            await this.sendCustomerNotification(tracking, normalizedStatus);

            this.logger.info('Delivery status updated', {
                trackingId: tracking.id,
                provider,
                trackingNumber,
                oldStatus: tracking.previous_status,
                newStatus: normalizedStatus
            });

            return { success: true, tracking };

        } catch (error) {
            this.logger.error('Failed to handle delivery webhook', {
                provider,
                trackingNumber,
                error: error.message
            });
            throw new AppError('Failed to handle delivery webhook', 500);
        }
    }

    /**
     * Poll delivery status for orders without recent webhooks
     */
    async pollDeliveryStatus() {
        try {
            // Find orders that need status polling
            const trackings = await DeliveryTracking.findAll({
                where: {
                    [require('sequelize').Op.or]: [
                        { webhook_received_at: null },
                        { 
                            webhook_received_at: {
                                [require('sequelize').Op.lt]: new Date(Date.now() - 30 * 60 * 1000) // 30 minutes ago
                            }
                        }
                    ],
                    current_status: {
                        [require('sequelize').Op.notIn]: ['delivered', 'cancelled', 'returned']
                    }
                },
                include: [{
                    model: Order,
                    as: 'order'
                }],
                limit: 50 // Process in batches
            });

            this.logger.info('Polling delivery status', { count: trackings.length });

            for (const tracking of trackings) {
                try {
                    await this.pollSingleTracking(tracking);
                } catch (error) {
                    this.logger.error('Failed to poll tracking', {
                        trackingId: tracking.id,
                        error: error.message
                    });
                }
            }

        } catch (error) {
            this.logger.error('Failed to poll delivery status', { error: error.message });
        }
    }

    /**
     * Poll single tracking status
     */
    async pollSingleTracking(tracking) {
        try {
            const statusData = await deliveryService.getDeliveryStatus(
                tracking.order.shop_id,
                tracking.provider,
                tracking.tracking_number
            );

            if (statusData.status !== tracking.current_status) {
                await this.handleDeliveryWebhook(tracking.provider, tracking.tracking_number, {
                    status: statusData.status,
                    location: statusData.location
                });
            }

            // Update last API check time
            await tracking.update({
                last_api_check: new Date()
            });

        } catch (error) {
            this.logger.warn('Failed to poll tracking status', {
                trackingId: tracking.id,
                error: error.message
            });
        }
    }

    /**
     * Normalize delivery status
     */
    normalizeStatus(provider, rawStatus) {
        const statusMap = {
            'pathao': {
                'PACKAGE_RECEIVED': 'picked_up',
                'IN_TRANSIT': 'in_transit',
                'OUT_FOR_DELIVERY': 'out_for_delivery',
                'DELIVERED': 'delivered',
                'FAILED_DELIVERY': 'failed_delivery',
                'CANCELLED': 'cancelled',
                'RETURNED': 'returned'
            },
            'redx': {
                'PICKED': 'picked_up',
                'TRANSIT': 'in_transit',
                'OUT_FOR_DELIVERY': 'out_for_delivery',
                'DELIVERED': 'delivered',
                'FAILED': 'failed_delivery',
                'CANCELLED': 'cancelled',
                'RETURNED': 'returned'
            },
            'ecourier': {
                'PICKED_UP': 'picked_up',
                'IN_TRANSIT': 'in_transit',
                'OUT_FOR_DELIVERY': 'out_for_delivery',
                'DELIVERED': 'delivered',
                'DELIVERY_FAILED': 'failed_delivery',
                'CANCELLED': 'cancelled',
                'RETURNED': 'returned'
            }
        };

        const providerMap = statusMap[provider.toLowerCase()];
        return providerMap ? (providerMap[rawStatus] || rawStatus.toLowerCase()) : rawStatus.toLowerCase();
    }

    /**
     * Send customer notification about delivery status
     */
    async sendCustomerNotification(tracking, status) {
        try {
            const message = this.statusMessages[status];
            if (!message) {
                this.logger.warn('No message template for status', { status });
                return;
            }

            const { Channel } = require('../entities');
            const webhookService = require('../webhook/webhook.service');

            // Find active channel for the shop
            const channel = await Channel.findOne({
                where: {
                    shop_id: tracking.shop_id,
                    is_active: true
                },
                order: [['created_at', 'DESC']]
            });

            if (!channel) {
                this.logger.warn('No active channel found for delivery notification');
                return;
            }

            // Build notification message
            const notificationMessage = `${message.bn}\n\n📦 অর্ডার: #${tracking.order.order_number}\n🚚 কুরিয়ার: ${tracking.provider}\n📱 ট্র্যাকিং: ${tracking.tracking_number}\n\n---\n\n${message.en}\n\n📦 Order: #${tracking.order.order_number}\n🚚 Courier: ${tracking.provider}\n📱 Tracking: ${tracking.tracking_number}`;

            // Send to customer
            await webhookService.sendMessage(channel, tracking.order.customer_phone, notificationMessage);

            // Update tracking to mark as notified
            await tracking.update({
                customer_notified: true
            });

            this.logger.info('Customer notified about delivery status', {
                trackingId: tracking.id,
                status,
                customerPhone: tracking.order.customer_phone
            });

        } catch (error) {
            this.logger.error('Failed to send customer notification', {
                trackingId: tracking.id,
                status,
                error: error.message
            });
        }
    }

    /**
     * Handle successful delivery
     */
    async handleSuccessfulDelivery(tracking) {
        try {
            // Send delivery completion notification
            const { Channel } = require('../entities');
            const webhookService = require('../webhook/webhook.service');

            const channel = await Channel.findOne({
                where: {
                    shop_id: tracking.shop_id,
                    is_active: true
                },
                order: [['created_at', 'DESC']]
            });

            if (channel) {
                const completionMessage = `✅ ডেলিভারি সম্পন্ন হয়েছে!\n\nআপনার অর্ডার #${tracking.order.order_number} সফলভাবে ডেলিভারি হয়েছে।\n\nপণ্য পেয়ে থাকলে আমাদের জানান।\n\nধন্যবাদ!\n\n---\n\n✅ Delivery Completed!\n\nYour order #${tracking.order.order_number} has been successfully delivered.\n\nPlease let us know once you've received the package.\n\nThank you!`;
                
                await webhookService.sendMessage(channel, tracking.order.customer_phone, completionMessage);
            }

            // Update actual delivery time
            await tracking.update({
                actual_delivery: new Date()
            });

            this.logger.info('Delivery completion processed', {
                trackingId: tracking.id,
                orderId: tracking.order.id
            });

        } catch (error) {
            this.logger.error('Failed to handle successful delivery', {
                trackingId: tracking.id,
                error: error.message
            });
        }
    }

    /**
     * Handle failed delivery
     */
    async handleFailedDelivery(tracking) {
        try {
            // Send failure notification to shop owner
            const ownerNotificationService = require('../notification/owner-notification.service');
            
            await ownerNotificationService.sendPaymentConfirmationRequest(
                tracking.shop_id,
                {
                    id: tracking.order.id,
                    order_number: tracking.order.order_number,
                    customer_name: tracking.order.customer_name,
                    customer_phone: tracking.order.customer_phone,
                    total: tracking.order.total
                },
                {
                    type: 'delivery_failure',
                    message: `Delivery failed for order #${tracking.order.order_number}`,
                    trackingInfo: {
                        provider: tracking.provider,
                        trackingNumber: tracking.tracking_number,
                        status: tracking.current_status
                    }
                }
            );

            this.logger.info('Delivery failure processed', {
                trackingId: tracking.id,
                orderId: tracking.order.id
            });

        } catch (error) {
            this.logger.error('Failed to handle delivery failure', {
                trackingId: tracking.id,
                error: error.message
            });
        }
    }

    /**
     * Get tracking by order ID
     */
    async getTrackingByOrderId(orderId, shopId) {
        const tracking = await DeliveryTracking.findOne({
            where: { order_id: orderId, shop_id: shopId },
            include: [{
                model: Order,
                as: 'order',
                attributes: ['order_number', 'customer_name', 'customer_phone', 'total']
            }]
        });

        if (!tracking) {
            throw new AppError('Tracking not found', 404);
        }

        return tracking;
    }

    /**
     * Get tracking history
     */
    async getTrackingHistory(trackingId, shopId) {
        const tracking = await DeliveryTracking.findOne({
            where: { id: trackingId, shop_id: shopId }
        });

        if (!tracking) {
            throw new AppError('Tracking not found', 404);
        }

        return {
            currentStatus: tracking.current_status,
            trackingNumber: tracking.tracking_number,
            provider: tracking.provider,
            estimatedDelivery: tracking.estimated_delivery,
            actualDelivery: tracking.actual_delivery,
            statusHistory: tracking.status_history || [],
            locationInfo: tracking.location_info,
            deliveryAgentInfo: tracking.delivery_agent_info
        };
    }
}

module.exports = new DeliveryTrackingService();
