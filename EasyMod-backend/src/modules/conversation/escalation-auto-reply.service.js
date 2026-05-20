/**
 * Escalation Auto-Reply Service
 *
 * When a conversation is escalated to a human agent, automatically sends a
 * templated reassurance message to the customer. The template is pulled from
 * the shop's AI settings (settings.ai.escalation_reply_template) so each shop
 * can customise it. Falls back to a bilingual Bengali/English default.
 *
 * Default template (Bengali + English):
 *   "আপনার অনুরোধটি আমাদের টিমের কাছে পাঠানো হয়েছে। আমরা ২ ঘণ্টার মধ্যে
 *    আপনার সাথে যোগাযোগ করব।
 *    Your request has been forwarded to our team. We'll get back to you within 2 hours."
 */

const { v4: uuidv4 } = require('uuid');
const { Conversation, Message } = require('./conversation.entity');
const shopService = require('../shop/shop.service');

const DEFAULT_ESCALATION_TEMPLATE =
    'আপনার অনুরোধটি আমাদের টিমের কাছে পাঠানো হয়েছে। আমরা ২ ঘণ্টার মধ্যে আপনার সাথে যোগাযোগ করব।\n\n' +
    "Your request has been forwarded to our team. We'll get back to you within 2 hours. 🙏";

/**
 * Send an escalation auto-reply message to the customer.
 *
 * @param {string} conversationId  - UUID of the conversation being escalated
 * @param {string} shopId          - UUID of the shop (for settings lookup)
 * @param {string} [channelType]   - Channel identifier (messenger, instagram, etc.) — reserved for future platform-specific routing
 * @returns {Promise<object|null>} - The created message record, or null if skipped/failed
 */
const sendEscalationAutoReply = async (conversationId, shopId, channelType) => {
    try {
        // Resolve the template: shop-specific override → default bilingual template
        let template = DEFAULT_ESCALATION_TEMPLATE;

        try {
            const aiSettings = await shopService.getShopAiSettings(shopId);
            if (aiSettings && aiSettings.escalation_reply_template) {
                template = aiSettings.escalation_reply_template;
            }
        } catch (settingsErr) {
            // Non-fatal — use default template if shop settings unavailable
            console.warn(
                `[EscalationAutoReply] Could not load shop AI settings for ${shopId}: ${settingsErr.message}`
            );
        }

        // Verify the conversation belongs to this shop
        const conversation = await Conversation.findOne({
            where: { id: conversationId, shop_id: shopId }
        });

        if (!conversation) {
            console.warn(
                `[EscalationAutoReply] Conversation ${conversationId} not found for shop ${shopId}. Skipping.`
            );
            return null;
        }

        // Create the auto-reply message
        const message = await Message.create({
            id: uuidv4(),
            conversation_id: conversationId,
            content: template,
            sender: 'ai',
            external_id: null,
            metadata: {
                type: 'escalation_auto_reply',
                channel_type: channelType || conversation.channel || null,
                timestamp: new Date().toISOString(),
                auto_sent: true
            }
        });

        console.info(
            `[EscalationAutoReply] Auto-reply sent for conversation ${conversationId} (shop ${shopId})`
        );

        return {
            id: message.id,
            conversation_id: message.conversation_id,
            content: message.content,
            sender: message.sender,
            created_at: message.created_at,
            metadata: message.metadata
        };

    } catch (error) {
        // Never throw — escalation auto-reply is best-effort and must not block the escalation flow
        console.error(
            `[EscalationAutoReply] Failed to send auto-reply for conversation ${conversationId}: ${error.message}`
        );
        return null;
    }
};

module.exports = { sendEscalationAutoReply, DEFAULT_ESCALATION_TEMPLATE };
