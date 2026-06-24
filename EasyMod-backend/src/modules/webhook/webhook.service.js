'use strict';

/**
 * Webhook Send Compatibility Shim
 *
 * Multiple modules (payment-webhook.controller, invoice.service,
 * delivery-tracking.service, order-session.service,
 * owner-notification.service) require this path to send outbound
 * Messenger messages via a channel record.
 *
 * Phase 5 cutover: the legacy meta-send.service import is removed.
 * Outbound transport lives exclusively in the provider registry.
 *
 * Call-site signature (unchanged):
 *   webhookService.sendMessage(channel, recipientId, messageText)
 *
 * Where `channel` carries:
 *   channel.shop_id          — tenant scoping
 *   channel.type             — 'facebook' | 'messenger'
 *   channel.meta_channel_id  — (Phase 2, optional) specific MetaChannel UUID;
 *                              when present the shim uses it directly instead
 *                              of resolving by (shop_id, platform). Callers
 *                              that know which page a conversation belongs to
 *                              SHOULD pass this so outbound sends use the
 *                              correct page's access token.
 *
 * The shim resolves the MetaChannel for (shopId, platform), builds a
 * minimal NormalizedMessage, runs policy pre-flight, and delegates to
 * providerRegistry.get(platform).sendMessage(). Policy engine evaluation
 * inside the provider is defense-in-depth from Phase 3.
 */

const MetaChannel = require('../channel-providers/meta-channel.entity');
const Customer = require('../customer/customer.entity');
const { getProvider } = require('../channel-providers/provider.registry');
const policyEngine = require('../policy/policy.engine');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('WebhookService');

/**
 * Normalize the legacy channel.type string to the platform key expected
 * by the provider registry. Facebook-only launch → always 'facebook'.
 *
 * @param {string} channelType
 * @returns {'facebook'}
 */
function normalizePlatform(channelType) {
    return 'facebook';
}

/**
 * Send a text message to a customer via the shop's active Meta channel.
 *
 * @param {object} channel       - Channel-like object (shop_id, type)
 * @param {string|number} recipientId   - Customer PSID
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

    // Phase 2: prefer the explicit meta_channel_id when the caller knows which
    // page the conversation belongs to. Fallback path looks up by
    // (shop_id, platform) for callers that haven't been plumbed yet — note this
    // returns an arbitrary channel when the shop has multiple pages of the same
    // platform, so callers SHOULD pass meta_channel_id once Phase 3 ships.
    let metaChannel = null;
    if (channel.meta_channel_id) {
        metaChannel = await MetaChannel.findByPk(channel.meta_channel_id);
    }
    if (!metaChannel) {
        metaChannel = await MetaChannel.findOne({
            where: { shop_id: channel.shop_id, platform },
            order: [['created_at', 'ASC']]
        });
    }

    if (!metaChannel) {
        logger.warn('No MetaChannel found for shop+platform — message dropped', {
            shopId: channel.shop_id,
            platform,
            metaChannelId: channel.meta_channel_id || null
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

    // Resolve the customer so the policy engine can enforce opt-out / consent.
    // Without this, `messengerOptedOut` and `consentRequired` short-circuit to
    // NO_CUSTOMER_CONTEXT (allow) and transactional sends (payment confirm,
    // delivery, invoice, owner notification) reach opted-out users.
    // channel_type stores 'messenger' for Facebook.
    const customerChannelType = 'messenger';
    let customer = null;
    try {
        customer = await Customer.findOne({
            where: {
                shop_id: channel.shop_id,
                channel_type: customerChannelType,
                channel_user_id: recipientIdStr,
            },
        });
    } catch (lookupErr) {
        logger.warn('Customer lookup failed in webhook shim — proceeding without customer context', {
            shopId: channel.shop_id,
            platform,
            error: lookupErr.message,
        });
    }

    // Policy pre-flight (defense-in-depth — provider also evaluates internally)
    const policyCtx = {
        shopId: channel.shop_id,
        channelId: metaChannel.id,
        recipientId: recipientIdStr,
        channel: metaChannel,
        customer,
        platform,
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

/**
 * Send a transactional message to a customer identified by their internal
 * Customer record id. Resolves the customer's real channel_user_id (PSID)
 * and platform, then delegates to sendMessage().
 *
 * This is the correct way for order/delivery/payment notifications to reach a
 * customer: they hold an order with a `customer_id`, NOT a PSID. Passing a phone
 * number or the internal customer UUID as the Meta recipient (as the legacy call
 * sites did) is rejected by the Graph API and silently dropped.
 *
 * @param {object} params
 * @param {string} params.shopId
 * @param {string} params.customerId  - Customer table primary key
 * @param {string} params.message     - plain-text message
 * @returns {Promise<{sent: boolean, reason?: string, recipientId?: string, channelType?: string}>}
 */
async function sendToCustomer({ shopId, customerId, message } = {}) {
    if (!shopId || !customerId || !message) {
        return { sent: false, reason: 'missing_args' };
    }

    let customer = null;
    try {
        customer = await Customer.findOne({ where: { id: customerId, shop_id: shopId } });
    } catch (err) {
        logger.warn('sendToCustomer: customer lookup failed', { shopId, customerId, error: err.message });
        return { sent: false, reason: 'lookup_error' };
    }

    if (!customer || !customer.channel_user_id) {
        // No Meta-side identity for this customer (e.g. a manually-created order
        // with only a phone) — nothing to deliver to over Messenger.
        return { sent: false, reason: 'no_customer_psid' };
    }

    // channel_type stores 'messenger' for Facebook.
    const channelType = 'messenger';

    try {
        await sendMessage({ shop_id: shopId, type: channelType }, customer.channel_user_id, message);
        return { sent: true, recipientId: customer.channel_user_id, channelType };
    } catch (err) {
        logger.warn('sendToCustomer: send failed', { shopId, customerId, error: err.message });
        return { sent: false, reason: 'send_error', error: err.message };
    }
}

module.exports = { sendMessage, sendToCustomer };
