'use strict';

/**
 * Webhook Send Compatibility Shim
 *
 * Multiple modules (payment-webhook.controller, invoice.service,
 * delivery-tracking.service, order-session.service,
 * owner-notification.service) require this path to send outbound
 * Messenger/Instagram messages via a channel record.
 *
 * The real send logic lives in integration/meta-send.service.js.
 * This shim adapts the call-site signature:
 *
 *   webhookService.sendMessage(channel, recipientId, messageText)
 *
 * to the meta-send API:
 *
 *   sendWithRateLimit({ shopId, platform, recipientId, message })
 *
 * Channel entity fields used:
 *   channel.shop_id   — tenant scoping for rate-limiter
 *   channel.type      — 'facebook' | 'instagram' | 'messenger' | 'whatsapp'
 *   channel.access_token — encrypted at rest; decrypted by channelService on read
 *     (meta-send.service accepts the decrypted token passed in via channel)
 *
 * Note: access tokens are encrypted in the Channel table.  meta-send.service
 * receives the decrypted token from the channel record when the channel is
 * fetched with the decrypted value populated (channel.decryptedToken or
 * channel.access_token already decrypted).  If the token is still encrypted
 * at this point, the Graph API call will fail — the caller must ensure the
 * channel was fetched with token decryption applied.
 */

const { sendWithRateLimit } = require('../integration/meta-send.service');
const Customer = require('../customer/customer.entity');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('WebhookService');

/**
 * Send a text message to a customer via the shop's active Meta channel.
 *
 * @param {object} channel       - Channel entity (shop_id, type, access_token)
 * @param {string} recipientId   - Customer PSID / IG-scoped ID / WhatsApp number
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

    // Check customer opt-out before sending any message (Meta policy: must honour opt-out)
    const customer = await Customer.findOne({
        where: { shop_id: channel.shop_id, channel_user_id: String(recipientId) },
        attributes: ['marketing_opt_out']
    });
    if (customer?.marketing_opt_out) {
        logger.info('Skipping send — customer has opted out', { shopId: channel.shop_id, recipientId });
        return;
    }

    // Normalise channel type to what meta-send.service expects
    const platform = channel.type === 'facebook' ? 'messenger' : (channel.type || 'messenger');

    try {
        await sendWithRateLimit({
            shopId: channel.shop_id,
            platform,
            recipientId: String(recipientId),
            message: messageText
        });

        logger.info('Message sent via webhook service shim', {
            shopId: channel.shop_id,
            platform,
            recipientId
        });
    } catch (err) {
        logger.error('sendMessage failed', {
            shopId: channel.shop_id,
            platform,
            recipientId,
            error: err.message
        });
        throw err;
    }
}

module.exports = { sendMessage };
