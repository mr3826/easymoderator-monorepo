'use strict';

/**
 * Webhook Send Compatibility Shim
 *
 * Multiple modules (payment-webhook.controller, invoice.service,
 * delivery-tracking.service, order-session.service,
 * owner-notification.service) require this path to send outbound
 * Messenger/Instagram messages via a channel record.
 *
 * Phase 5 cutover: the legacy meta-send.service import is removed.
 * Outbound transport lives exclusively in the provider registry.
 *
 * Call-site signature (unchanged):
 *   webhookService.sendMessage(channel, recipientId, messageText)
 *
 * Where `channel` carries:
 *   channel.shop_id  — tenant scoping
 *   channel.type     — 'facebook' | 'instagram' | 'messenger'
 *
 * The shim resolves the MetaChannel for (shopId, platform), builds a
 * minimal NormalizedMessage, runs policy pre-flight, and delegates to
 * providerRegistry.get(platform).sendMessage(). Policy engine evaluation
 * inside the provider is defense-in-depth from Phase 3.
 */

const MetaChannel = require('../channel-providers/meta-channel.entity');
const { getProvider } = require('../channel-providers/provider.registry');
const policyEngine = require('../policy/policy.engine');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('WebhookService');

/**
 * Normalize the legacy channel.type string to the platform key expected
 * by the provider registry: 'facebook' | 'instagram'.
 *
 * @param {string} channelType
 * @returns {'facebook'|'instagram'}
 */
function normalizePlatform(channelType) {
    if (!channelType) return 'facebook';
    const t = channelType.toLowerCase();
    if (t === 'facebook' || t === 'messenger') return 'facebook';
    if (t === 'instagram') return 'instagram';
    return 'facebook'; // safe default
}

/**
 * Send a text message to a customer via the shop's active Meta channel.
 *
 * @param {object} channel       - Channel-like object (shop_id, type)
 * @param {string|number} recipientId   - Customer PSID / IG-scoped ID
 * @param {string} messageText   - Plain-text message content
 * @returns {Promise<void>}
 */
async function sendMessage(channel, recipientId, messageText) {
    if (!channel || !recipientId || !messageText) {
        logger.warn('sendMessage called with missing required args', {
            hasChannel: Boolean(channel),
            hasRecipient: Boolean(recipientId),
            hasMessage: Boolean(messageText)
        });
        return;
    }

    const platform = normalizePlatform(channel.type);
    const recipientIdStr = String(recipientId);

    // Resolve the MetaChannel for this shop + platform
    const metaChannel = await MetaChannel.findOne({
        where: { shop_id: channel.shop_id, platform }
    });

    if (!metaChannel) {
        logger.warn('No MetaChannel found for shop+platform — message dropped', {
            shopId: channel.shop_id,
            platform
        });
        return;
    }

    // Build a minimal NormalizedMessage for the policy engine
    const normalizedMessage = {
        text: messageText,
        attachments: [],
        platform,
        direction: 'outbound',
        senderRole: 'system',
    };

    // Policy pre-flight (defense-in-depth — provider also evaluates internally)
    const policyCtx = {
        shopId: channel.shop_id,
        channelId: metaChannel.id,
        recipientId: recipientIdStr,
        channel: metaChannel,
    };

    let decision;
    try {
        decision = await policyEngine.evaluateOutbound(normalizedMessage, policyCtx);
    } catch (policyErr) {
        logger.error('Policy engine error in webhook shim — blocking send', {
            shopId: channel.shop_id,
            platform,
            recipientId: recipientIdStr,
            error: policyErr.message
        });
        return;
    }

    if (!decision.allow) {
        logger.info('Policy denied outbound send in webhook shim', {
            shopId: channel.shop_id,
            platform,
            recipientId: recipientIdStr,
            reason: decision.reason
        });
        return;
    }

    try {
        const provider = getProvider(platform);
        await provider.sendMessage({
            channel: metaChannel,
            recipientId: recipientIdStr,
            normalizedMessage: decision.transform || normalizedMessage,
            decision,
        });

        logger.info('Message sent via webhook service shim', {
            shopId: channel.shop_id,
            platform,
            recipientId: recipientIdStr
        });
    } catch (err) {
        logger.error('sendMessage failed', {
            shopId: channel.shop_id,
            platform,
            recipientId: recipientIdStr,
            error: err.message
        });
        throw err;
    }
}

module.exports = { sendMessage };
