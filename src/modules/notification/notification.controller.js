const { body, validationResult } = require('express-validator');
const { Conversation, Message } = require('../conversation/conversation.entity');
const { getShopById } = require('../shop/shop.service');

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
                shop_id,
                customer_id,
                platform,
                trigger_reason,
                confidence_score,
                last_message
            } = req.body;

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
                shop_id,
                type,
                title,
                body,
                data = {}
            } = req.body;

            // Get shop information
            const shop = await getShopById(shop_id); // Note: This might need user_id, adjust as needed
            
            if (!shop) {
                return res.status(404).json({
                    success: false,
                    error: 'Shop not found'
                });
            }

            // TODO: Implement actual push notification logic
            // This would integrate with FCM, web push, or other notification services
            // For now, we'll just log the notification
            
            const notification = {
                shop_id,
                type,
                title,
                body,
                data,
                timestamp: new Date().toISOString()
            };

            console.log('📱 Push notification:', notification);

            // In production, you would:
            // 1. Get shop owner's device tokens from database
            // 2. Send via FCM for mobile devices
            // 3. Send via web push for browsers
            // 4. Store notification in database for history

            res.json({
                success: true,
                message: 'Notification sent successfully',
                notification_id: `notif_${Date.now()}_${shop_id}`
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
