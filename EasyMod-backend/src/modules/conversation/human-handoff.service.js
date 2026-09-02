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
const policyEngine = require('../policy/policy.engine');
const { Customer, MetaChannelSettings } = require('../entities');
const { selectChannelRuntimeSettings } = require('../channel-providers/meta-channel-settings.runtime');
const { DEFAULT_AI_SETTINGS } = require('../shop/shop-defaults');
const { getEffectiveAiReplyMode } = require('../shop/ai-reply-mode');
const DEFAULT_HANDOFF_COOLDOWN_MINUTES = DEFAULT_AI_SETTINGS.handoff_settings.cooldown_minutes;
const MAX_HANDOFF_COOLDOWN_MINUTES = 1440;
const SUPPORTED_HANDOFF_PLATFORMS = new Set(['facebook', 'messenger', 'instagram']);

function hasRequiredContextValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== '';
}

function isContextRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeHandoffPlatform(platform) {
    return platform === 'messenger' ? 'facebook' : platform;
}

async function getHandoffCooldownMinutes(shopId) {
    try {
        const shopService = require('../shop/shop.service');
        const settings = await shopService.getShopAiSettings(shopId);
        const configured = settings?.handoff_settings?.cooldown_minutes;
        if (typeof configured === 'number'
            && Number.isFinite(configured)
            && configured >= 0
            && configured <= MAX_HANDOFF_COOLDOWN_MINUTES) {
            return configured;
        }
    } catch (_) { /* use the canonical default when settings are unavailable */ }
    return DEFAULT_HANDOFF_COOLDOWN_MINUTES;
}

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
    let hitlReady = conversation?.hitl === true;

    // 1. Pause AI + notify agent tabs (idempotent — don't re-flip if already HITL)
    try {
        if (!conversation) {
            throw new Error('Conversation context is unavailable');
        }
        if (conversation.hitl !== true) {
            await conversation.update({ hitl: true });
            hitlReady = true;
            try {
                const merchantNotificationService = require('../notification/merchant-notification.service');
                const { NOTIFICATION_EVENTS } = require('../notification/notification-events');
                const cooldownMinutes = await getHandoffCooldownMinutes(shopId);
                const notificationOptions = cooldownMinutes > 0
                    ? {
                        dedupeKey: `shop:${shopId}:ai_handoff`,
                        dedupeTtlSeconds: cooldownMinutes * 60,
                    }
                    : {};
                Promise.resolve(merchantNotificationService.notifyShop(
                    shopId,
                    NOTIFICATION_EVENTS.AI_HITL,
                    {
                        conversationId: convId,
                        reason,
                        platform
                    },
                    notificationOptions
                )).catch(() => {});
            } catch (_) { /* alert failure must never block HITL */ }
        } else {
            hitlReady = true;
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
    if (channel && hitlReady) {
        const pf = normalizeHandoffPlatform(platform);
        if (!hasRequiredContextValue(convId)
            || !hasRequiredContextValue(shopId)
            || !SUPPORTED_HANDOFF_PLATFORMS.has(platform)
            || !hasRequiredContextValue(recipientId)
            || !hasRequiredContextValue(channel.id)) {
            console.warn(`[handoff] Holding message not sent for conv ${convId}: delivery context unavailable`);
            return holdingMsg;
        }

        try {
            const customerChannelType = pf === 'facebook' ? 'messenger' : pf;
            const [customer, settings, businessMode] = await Promise.all([
                Customer.findOne({
                    where: {
                        shop_id: shopId,
                        channel_type: customerChannelType,
                        channel_user_id: String(recipientId),
                    },
                }),
                MetaChannelSettings.findOne({ where: { channel_id: channel.id } }),
                getEffectiveAiReplyMode(shopId),
            ]);

            const customerKnown = isContextRecord(customer) && hasRequiredContextValue(customer.id);
            const settingsKnown = isContextRecord(settings)
                && hasRequiredContextValue(settings.channel_id)
                && String(settings.channel_id) === String(channel.id);
            if (!customerKnown || !settingsKnown) {
                const missing = !customerKnown ? 'customer context' : 'channel settings';
                console.warn(`[handoff] Holding message not sent for conv ${convId}: ${missing} unavailable`);
                return holdingMsg;
            }

            const policySettings = {
                ...selectChannelRuntimeSettings(settings),
                automation_mode: businessMode,
            };

            const normalizedMessage = {
                text: holdingMsg.content,
                attachments: [],
                platform: pf,
                direction: 'outbound',
                senderRole: 'ai',
            };
            const decision = await policyEngine.evaluateOutbound(normalizedMessage, {
                shopId,
                channelId: channel.id,
                conversationId: convId,
                recipientId: String(recipientId),
                channel,
                customer,
                settings: policySettings,
                platform: pf,
            });
            if (!decision.allow) {
                console.warn(`[handoff] Holding message blocked by policy for conv ${convId}: ${decision.reason}`);
                return holdingMsg;
            }

            const provider = getProvider(pf);
            await provider.sendMessage({
                channel,
                recipientId: String(recipientId),
                normalizedMessage: decision.transform || normalizedMessage,
                decision,
            });
        } catch (err) {
            console.warn(`[handoff] Holding message delivery failed for conv ${convId}: ${err.message}`);
        }
    }

    return holdingMsg;
}

module.exports = {
    escalateToHuman,
    _private: { getHandoffCooldownMinutes }
};
