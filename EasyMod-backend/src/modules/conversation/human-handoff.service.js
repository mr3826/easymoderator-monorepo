'use strict';

/**
 * Human Handoff Service
 *
 * escalateToHuman() pauses the AI for a conversation (hitl=true), notifies any
 * connected agent tabs, and sends the customer one short reassurance ("holding")
 * message so they are not left in silence while a human takes over.
 *
 * Shared by the two worker paths that hand a conversation to a human:
 *   1. sentiment auto-escalation (angry / frustrated customer)
 *   2. low-confidence handoff (AI unsure → hold the reply, fetch a human)
 *
 * Best-effort and non-throwing: the conversation is already flagged for a human,
 * so a failure to deliver the holding message must never break the escalation.
 */

const sseManager = require('../../utils/sse-manager');
const { getProvider } = require('../channel-providers/provider.registry');
const { sendEscalationAutoReply } = require('./escalation-auto-reply.service');

/**
 * @param {object}   params
 * @param {object}   params.conversation    - Sequelize Conversation instance (needs .update)
 * @param {string}   params.shopId
 * @param {string}   [params.conversationId] - defaults to conversation.id
 * @param {string}   params.platform         - 'messenger' | 'facebook' | 'instagram'
 * @param {string}   params.recipientId      - customer PSID/IGSID
 * @param {object}   [params.channel]        - resolved MetaChannel for delivery (null skips delivery)
 * @param {string}   [params.reason]         - audit/log reason (e.g. 'low_confidence', 'sentiment_angry')
 * @returns {Promise<object|null>} the stored holding message, or null
 */
async function escalateToHuman({
    conversation,
    shopId,
    conversationId,
    platform,
    recipientId,
    channel,
    reason,
} = {}) {
    const convId = conversationId || conversation?.id;

    // 1. Pause AI + notify agent tabs (idempotent — don't re-flip if already HITL)
    try {
        if (conversation && conversation.hitl !== true) {
            await conversation.update({ hitl: true });
        }
        sseManager.emit(shopId, 'hitl_changed', { conversation_id: convId, hitl: true });
    } catch (err) {
        console.error(`[handoff] Failed to set hitl for conv ${convId} (${reason}): ${err.message}`);
    }

    // 2. Reassure the customer with one templated holding message
    const holdingMsg = await sendEscalationAutoReply(convId, shopId).catch(() => null);
    if (!holdingMsg) return null;

    sseManager.emit(shopId, 'new_message', { conversation_id: convId, message: holdingMsg });

    // 3. Deliver it on the same channel the inbound arrived on
    if (channel) {
        const pf = platform === 'messenger' ? 'facebook' : platform;
        try {
            const provider = getProvider(pf);
            await provider.sendMessage({
                channel,
                recipientId: String(recipientId),
                normalizedMessage: {
                    text: holdingMsg.content,
                    attachments: [],
                    platform: pf,
                    direction: 'outbound',
                    senderRole: 'ai',
                },
                decision: { allow: true, reason: 'OK', augment: {} },
            });
        } catch (err) {
            console.warn(`[handoff] Holding message delivery failed for conv ${convId}: ${err.message}`);
        }
    }

    return holdingMsg;
}

module.exports = { escalateToHuman };
