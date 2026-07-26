const { body, validationResult } = require('express-validator');
const { Conversation, Message } = require('../conversation/conversation.entity');
const { getShopById } = require('../shop/shop.service');
const queueManager = require('../../jobs/queue-manager');

class NotificationController {
    /**
     * Mark conversation as needing human intervention
     */
    static async markHandoff(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
            }

            const {
                customer_id,
                platform,
                trigger_reason,
                confidence_score,
                last_message
            } = req.body;
            const shop_id = req.user?.shopId;
            if (!shop_id || (req.body.shop_id && req.body.shop_id !== shop_id)) {
                return res.status(403).json({
                    success: false,
                    error: 'Cross-shop handoff is forbidden',
                });
            }

            // Find the most recent conversation for this customer
            const conversation = await Conversation.findOne({
                where: {
                    shop_id,
                    customer_id,
                    channel: platform === 'facebook' ? 'messenger' : platform
                },
                order: [['created_at', 'DESC']]
            });

            if (!conversation) {
                return res.status(404).json({
                    success: false,
                    error: 'Conversation not found'
                });
            }

            // Update conversation status
            await conversation.update({
                status: 'NEEDS_HUMAN',
                metadata: {
                    ...conversation.metadata,
                    handoff_info: {
                        trigger_reason,
                        confidence_score,
                        last_message,
                        handoff_timestamp: new Date().toISOString()
                    }
                }
            });

            // Log the handoff in messages
            await Message.create({
                conversation_id: conversation.id,
                content: `[SYSTEM] Conversation marked for human review - Reason: ${trigger_reason} (Confidence: ${confidence_score}%)`,
                sender: 'ai',
                external_id: null
            });

            res.json({
                success: true,
                message: 'Conversation marked for human review'
            });
        } catch (error) {
            console.error('Mark handoff error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to mark conversation for handoff'
            });
        }
    }

    /**
     * Send push notification to shop owner
     */
    static async sendPush(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
            }

            const {
                type,
                title,
                body,
                data = {}
            } = req.body;
            const shop_id = req.user?.shopId;
            if (!shop_id || (req.body.shop_id && req.body.shop_id !== shop_id)) {
                return res.status(403).json({
                    success: false,
                    error: 'Cross-shop notification is forbidden',
                });
            }

            // Get shop information
            const shop = await getShopById(shop_id); // Note: This might need user_id, adjust as needed
            
            if (!shop) {
                return res.status(404).json({
                    success: false,
                    error: 'Shop not found'
                });
            }

            // Enqueue push notification — sendPushToShop handles web + FCM delivery
            let jobId = null;
            if (queueManager.queues.notifications) {
                const job = await queueManager.queues.notifications.add('push-notification', {
                    shopId: shop_id,
                    payload: { title, body, data }
                });
                jobId = job.id;
            }

            res.json({
                success: true,
                message: 'Notification queued',
                notification_id: jobId || `notif_${Date.now()}_${shop_id}`
            });
        } catch (error) {
            console.error('Send push notification error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to send push notification'
            });
        }
    }
}

module.exports = NotificationController;
