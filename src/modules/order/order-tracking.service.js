/**
 * Order Tracking Notification Service (B2)
 * Sends shipping/tracking info to customers when order status changes to 'shipped'.
 */

const { createLogger } = require('../../utils/structured-logger');

/**
 * Format a Bengali tracking notification message.
 * @param {object} order - Sequelize Order instance or plain object
 * @param {object} options - { trackingNumber, estimatedDate, courier }
 * @returns {string}
 */
const formatTrackingMessage = (order, options = {}) => {
    const { trackingNumber, estimatedDate, courier } = options;
    const orderId = order.order_number || order.id;
    const tracking = trackingNumber || order.delivery_tracking_code || 'N/A';
    const estimated = estimatedDate || null;

    let message = `আপনার অর্ডার #${orderId} শিপ করা হয়েছে। ট্র্যাকিং নম্বর: ${tracking}.`;
    if (courier) {
        message += ` কুরিয়ার: ${courier}.`;
    }
    if (estimated) {
        message += ` আনুমানিক ডেলিভারি: ${estimated}.`;
    }
    return message;
};

/**
 * Try to send a message via the shop's active Facebook/Messenger channel.
 * Falls back to logging if no channel is configured or sending fails.
 *
 * @param {object} order - Order instance
 * @param {string} shopId
 * @param {string} message - Formatted message text
 * @param {object} logger
 */
const trySendViaChannel = async (order, shopId, message, logger) => {
    try {
        const { Channel } = require('../entities');
        const { Op } = require('sequelize');

        // Find an active channel for this shop (prefer messenger/facebook)
        const channel = await Channel.findOne({
            where: {
                shop_id: shopId,
                is_active: true,
                type: { [Op.in]: ['messenger', 'facebook', 'whatsapp'] }
            },
            order: [['created_at', 'DESC']]
        });

        if (!channel) {
            logger.info('No active channel found for tracking notification — logging only', {
                shopId,
                orderId: order.id
            });
            console.log(`[TrackingNotification] Shop ${shopId} | Order ${order.order_number || order.id}: ${message}`);
            return { sent: false, reason: 'no_channel' };
        }

        // If customer has an external_id (Facebook PSID), send via channel messenger API
        const customerId = order.customer_id;
        if (!customerId) {
            logger.info('No customer linked to order — logging only', { orderId: order.id });
            console.log(`[TrackingNotification] Shop ${shopId} | Order ${order.order_number || order.id}: ${message}`);
            return { sent: false, reason: 'no_customer' };
        }

        const { Customer } = require('../entities');
        const customer = await Customer.findOne({ where: { id: customerId, shop_id: shopId } });

        if (!customer || !customer.external_id) {
            logger.info('Customer has no external_id — logging notification only', {
                orderId: order.id,
                customerId
            });
            console.log(`[TrackingNotification] Shop ${shopId} | Order ${order.order_number || order.id}: ${message}`);
            return { sent: false, reason: 'no_external_id' };
        }

        // Attempt to send via the webhook/channel service
        // TODO: '../webhook/webhook.service' does not exist — sendMessage will silently fail until this module is created
        const webhookService = require('../webhook/webhook.service');
        await webhookService.sendMessage(channel, customer.external_id, message);

        logger.info('Tracking notification sent via channel', {
            shopId,
            orderId: order.id,
            channelType: channel.type
        });
        return { sent: true, channelType: channel.type };
    } catch (err) {
        // Non-fatal: log and fall back
        logger.warn('Failed to send tracking notification via channel, falling back to log', {
            error: err.message,
            orderId: order.id
        });
        console.log(`[TrackingNotification] Shop ${shopId} | Order ${order.order_number || order.id}: ${message}`);
        return { sent: false, reason: 'send_error', error: err.message };
    }
};

/**
 * Send tracking notification when order is shipped.
 *
 * Accepts two calling conventions:
 *   sendTrackingNotification(order, shopId, options)        — called from order.service.js status hook
 *   sendTrackingNotification(orderId, shopId, options)      — called from order.controller.js POST /:id/send-tracking
 *
 * @param {object|string} orderOrId - Order instance or order ID string
 * @param {string} shopId
 * @param {object} options - { trackingNumber, courier, estimatedDelivery }
 */
const sendTrackingNotification = async (orderOrId, shopId, options = {}) => {
    const logger = createLogger(null, shopId);

    let order = orderOrId;

    // If a string/number ID was passed, load the order
    if (typeof orderOrId === 'string' || typeof orderOrId === 'number') {
        const { Order } = require('../entities');
        order = await Order.findOne({ where: { id: orderOrId, shop_id: shopId } });
        if (!order) {
            const { AppError } = require('../../utils/AppError');
            throw new AppError('Order not found', 404);
        }
    }

    const { trackingNumber, courier, estimatedDelivery } = options;
    const message = formatTrackingMessage(order, {
        trackingNumber,
        courier,
        estimatedDate: estimatedDelivery
    });

    const result = await trySendViaChannel(order, shopId, message, logger);

    return {
        orderId: order.id,
        orderNumber: order.order_number,
        message,
        ...result
    };
};

module.exports = {
    sendTrackingNotification,
    formatTrackingMessage
};
