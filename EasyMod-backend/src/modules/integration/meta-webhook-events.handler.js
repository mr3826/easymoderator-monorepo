'use strict';

/**
 * Meta Webhook — Page Event Handler
 *
 * Handles inbound Messenger (page) webhooks:
 *   - Find-or-create customer
 *   - Find-or-create conversation (rolling 24h window)
 *   - Store message with idempotency guard
 *   - Emit SSE event to connected dashboard clients
 *   - Process consent (STOP keyword → opt-out, else OPT_IN_IMPLICIT)
 *   - Dispatch BullMQ job for AI processing (unless STOP or duplicate)
 *   - Notify Comment-to-DM service that DM was opened
 */

const { Customer } = require('../entities');
const { Conversation, Message } = require('../conversation/conversation.entity');
const { sequelize } = require('../../utils/database/database-setup');
const sseManager = require('../../utils/sse-manager');
const consentService = require('../consent/consent.service');
const { createLogger } = require('../../utils/structured-logger');
const { dispatchCommentEvents, notifyDmOpened } = require('./meta-webhook-comments.handler');
const { extractCommentEvents } = require('../commentToDm/comment-to-dm.webhook-handler');
const { opsAlert } = require('../../utils/ops-alert');

const logger = createLogger('MetaWebhookEvents');

const displayChannelForPlatform = (platform) => {
    if (platform === 'facebook' || platform === 'messenger') return 'Facebook';
    if (platform === 'instagram') return 'Instagram';
    return platform || 'Unknown';
};

const fallbackCustomerName = (platform) => `${displayChannelForPlatform(platform)} User`;

const fallbackCustomerMetadata = ({ platform, sender, source = 'webhook' }) => ({
    source,
    platform: platform === 'messenger' ? 'facebook' : platform,
    external_id: sender ? String(sender) : null,
    channel: displayChannelForPlatform(platform),
});

async function applyFallbackCustomerProfile({ customer, platform, sender, isPlaceholderName }) {
    if (!customer || typeof customer.update !== 'function' || !isPlaceholderName(customer.name)) return;

    const fallbackName = fallbackCustomerName(platform);
    const fallbackMeta = {
        ...(customer.metadata || {}),
        ...fallbackCustomerMetadata({ platform, sender }),
    };
    const currentMeta = customer.metadata || {};
    const alreadySafe = customer.name === fallbackName
        && currentMeta.external_id === String(sender || '')
        && currentMeta.channel === displayChannelForPlatform(platform)
        && currentMeta.platform === fallbackMeta.platform;

    if (alreadySafe) return;

    try {
        await customer.update({ name: fallbackName, metadata: fallbackMeta });
    } catch (err) {
        logger.warn('Unable to persist fallback customer profile after Meta enrichment miss', {
            customerId: customer.id,
            platform,
            error: err.message,
        });
    }
}

function triggerCustomerProfileEnrichment({ customer, metaChannelId, shopId, platform, psid }) {
    if (!customer || !psid) return;

    try {
        const { enrichCustomerNameFromMeta, isPlaceholderName } = require('../customer/customer-profile.service');
        const metadata = customer.metadata || {};
        const missingProfileFields = !metadata.first_name || !metadata.last_name || !metadata.profile_pic;
        if (!isPlaceholderName(customer.name) && !missingProfileFields) return;

        const logContext = {
            customerId: customer.id,
            shopId,
            platform,
            metaChannelId: metaChannelId || null,
            hasExternalId: true,
        };

        enrichCustomerNameFromMeta({
            customerId: customer.id,
            metaChannelId,
            shopId,
            platform,
            psid,
        })
            .then(async (updated) => {
                if (updated) {
                    logger.info('Shared inbox customer profile enriched from Meta', logContext);
                    return;
                }
                await applyFallbackCustomerProfile({ customer, platform, sender: psid, isPlaceholderName });
                logger.warn('Shared inbox customer profile enrichment did not update customer; using fallback', logContext);
            })
            .catch(async (err) => {
                await applyFallbackCustomerProfile({ customer, platform, sender: psid, isPlaceholderName });
                logger.warn('Shared inbox customer profile enrichment failed; using fallback', {
                    ...logContext,
                    error: err.message,
                });
            });
    } catch (err) {
        logger.warn('Shared inbox customer profile enrichment unavailable; using fallback', {
            customerId: customer.id,
            shopId,
            platform,
            metaChannelId: metaChannelId || null,
            hasExternalId: true,
            error: err.message,
        });
    }
}

// ─── BullMQ dispatch ──────────────────────────────────────────────────────────

let _messageQueue = null;
function getMessageQueue() {
    if (!_messageQueue) {
        try {
            _messageQueue = require('../../jobs/message-queue').messageQueue;
        } catch (err) {
            logger.warn('BullMQ message queue unavailable', { error: err.message });
        }
    }
    return _messageQueue;
}

/**
 * Schedule AI processing after a message has been stored to DB.
 *
 * Rather than enqueue one reply job per message, we (re)schedule a single
 * debounced "burst-flush" per conversation: rapid-fire messages collapse into
 * ONE AI turn and ONE reply (see burst-coalescer.js). Non-blocking — errors are
 * logged but never propagate back to the webhook handler.
 */
async function dispatchMessageJob(storeResult, event) {
    const queue = getMessageQueue();
    if (!queue) {
        // No Error object here (queue is simply null), so pass null as the 2nd
        // arg and put context in meta — otherwise the logger reads .message off
        // this object (undefined) and the shop/platform context is dropped.
        logger.error('BullMQ unavailable — message stored in DB but AI pipeline skipped', null, {
            shopId: event.shop_id,
            platform: event.platform,
            externalId: event.raw_event?.message?.mid || event.raw_event?.id || null
        });
        // Stage alert: webhook receipt OK, but the queue is down → no replies at all.
        opsAlert('Webhook→AI dispatch skipped — message queue unavailable', {
            detail: `shop=${event.shop_id} platform=${event.platform}. Messages are being stored `
                + `but the AI pipeline is not running (Redis/BullMQ down?). No auto-replies are going out.`,
            level: 'error',
            context: { shopId: event.shop_id, platform: event.platform },
        }).catch(() => {});
        return;
    }

    const { shop_id, sender, platform, meta_channel_id = null } = event;
    const { conversation_id, customer_id } = storeResult;

    try {
        const { scheduleBurstFlush } = require('../../jobs/burst-coalescer');
        await scheduleBurstFlush({
            shopId: shop_id,
            conversationId: conversation_id,
            platform,
            recipientId: sender,
            metaChannelId: meta_channel_id,
            senderInfo: { customer_id },
        });
    } catch (err) {
        logger.error('Failed to schedule burst flush — message stored but auto-reply skipped', err, {
            shop_id,
            conversationId: conversation_id,
            platform,
        });
        // Stage alert: scheduling threw → this customer gets no reply. Throttled
        // per-title so a systemic bug pages once, not per message.
        opsAlert('Webhook→AI schedule FAILED — message stored but no auto-reply', {
            detail: `shop=${shop_id} platform=${platform} conv=${conversation_id}\nerror: ${err.message}`,
            level: 'error',
            context: { shop_id, conversationId: conversation_id, platform, error: err.message },
        }).catch(() => {});
    }
}

/**
 * Cancel any pending burst-flush for a conversation (e.g. on a STOP keyword,
 * where no reply should be sent). Best-effort; never throws into the handler.
 */
async function cancelPendingDispatch(conversationId) {
    try {
        const { cancelBurstFlush } = require('../../jobs/burst-coalescer');
        await cancelBurstFlush(conversationId);
    } catch (_) { /* best-effort */ }
}

// ─── Consent processing ────────────────────────────────────────────────────────

/**
 * After storing an inbound message: update per-channel consent and detect STOP keywords.
 * Returns whether the AI dispatch should proceed.
 * Errors are swallowed — consent bookkeeping must never break inbound delivery.
 */
async function processInboundConsent({ storeResult, normalizedEvent, channel }) {
    try {
        const platform = normalizedEvent.platform === 'messenger' ? 'facebook' : normalizedEvent.platform;
        const messageText = normalizedEvent.message || '';

        if (consentService.isStopKeyword(messageText)) {
            await consentService.recordOptOut({
                shopId: storeResult.shop_id,
                channelId: channel?.id || null,
                customerId: storeResult.customer_id,
                platform,
                source: 'keyword_stop',
                metadata: { message_id: storeResult.message_id, keyword: messageText.trim() },
            });
            logger.info('Inbound STOP keyword — suppressing AI dispatch', {
                shopId: storeResult.shop_id, customerId: storeResult.customer_id, platform,
            });
            return { shouldDispatch: false };
        }

        await consentService.recordInbound({
            shopId: storeResult.shop_id,
            channelId: channel?.id || null,
            customerId: storeResult.customer_id,
            platform,
            metadata: { message_id: storeResult.message_id },
        });
        return { shouldDispatch: true };
    } catch (err) {
        logger.error('processInboundConsent failed (continuing)', { error: err.message });
        return { shouldDispatch: true };
    }
}

// ─── messaging_optins ─────────────────────────────────────────────────────────

async function handleMessagingOptin({ channel, senderId, optin }) {
    try {
        const channelType = channel.platform === 'facebook' ? 'messenger' : channel.platform;
        const [customer] = await Customer.findOrCreate({
            where: { shop_id: channel.shop_id, channel_type: channelType, channel_user_id: String(senderId) },
            defaults: {
                shop_id: channel.shop_id,
                name: fallbackCustomerName(channel.platform),
                channel_type: channelType,
                channel_user_id: String(senderId),
                metadata: fallbackCustomerMetadata({
                    platform: channel.platform,
                    sender: senderId,
                    source: 'messaging_optins',
                }),
            },
        });

        await consentService.recordOptIn({
            shopId: channel.shop_id,
            channelId: channel.id || null,
            customerId: customer.id,
            platform: channel.platform,
            source: 'webhook_messaging_optins',
            metadata: { ref: optin?.ref || null, user_ref: optin?.user_ref || null },
        });
        logger.info('messaging_optins recorded', { shopId: channel.shop_id, customerId: customer.id });
    } catch (err) {
        logger.error('handleMessagingOptin failed', { error: err.message });
    }
}

// ─── Message storage ──────────────────────────────────────────────────────────

/**
 * Store incoming customer message in database.
 * Find-or-create customer → find-or-create conversation → create message.
 * Returns { customer_id, conversation_id, message_id, message, shop_id, duplicate? }
 */
async function storeIncomingMessage(event) {
    try {
        const { platform, shop_id, sender, message, meta_channel_id = null } = event;
        const { Op } = require('sequelize');
        const channelType = platform === 'facebook' ? 'messenger' : platform;
        let customerForEnrichment = null;

        const externalId = event.raw_event?.message?.mid || event.raw_event?.id || null;
        if (externalId) {
            const existing = await Message.findOne({ where: { external_id: externalId } });
            if (existing) {
                logger.debug(`Duplicate webhook event skipped (external_id=${externalId})`);
                return {
                    customer_id: existing.customer_id,
                    customer_name: null,
                    conversation_id: existing.conversation_id,
                    message_id: existing.id,
                    message: existing,
                    shop_id: event.shop_id,
                    duplicate: true
                };
            }
        }

        const storedMessage = await sequelize.transaction(async (t) => {
            const [customer] = await Customer.findOrCreate({
                where: { shop_id, channel_type: channelType, channel_user_id: sender },
                defaults: {
                    shop_id,
                    name: fallbackCustomerName(platform),
                    channel_type: channelType,
                    channel_user_id: sender,
                    metadata: fallbackCustomerMetadata({ platform, sender })
                },
                transaction: t
            });
            customerForEnrichment = customer;

            // Phase 2: scope the 24h rolling-window lookup by meta_channel_id when
            // we know which page the message arrived on. Older rows without
            // meta_channel_id still match (they predate this column).
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const convoWhere = {
                shop_id,
                customer_id: customer.id,
                channel: channelType,
                updated_at: { [Op.gte]: oneDayAgo }
            };
            if (meta_channel_id) {
                convoWhere.meta_channel_id = { [Op.or]: [meta_channel_id, null] };
            }
            let conversation = await Conversation.findOne({
                where: convoWhere,
                order: [['updated_at', 'DESC']],
                lock: t.LOCK.UPDATE,
                transaction: t
            });

            // Lazy backfill: if we matched an old row that pre-dates the FK, set it now.
            if (conversation && meta_channel_id && !conversation.meta_channel_id) {
                await conversation.update({ meta_channel_id }, { transaction: t });
            }

            if (!conversation) {
                conversation = await Conversation.create({
                    shop_id,
                    customer_id: customer.id,
                    channel: channelType,
                    meta_channel_id,
                    role: 'user',
                    message: message,
                    metadata: { source: 'webhook', platform }
                }, { transaction: t });
            }

            const attachments = event.attachments || [];
            let msgMeta = {};
            if (attachments.length > 0) {
                const first = attachments[0];
                if (first.type === 'image') {
                    msgMeta = { message_type: 'image', image_url: first.payload?.url || null };
                } else {
                    msgMeta = { message_type: 'file', file_url: first.payload?.url || null, file_name: first.payload?.name || null };
                }
            }
            const msgContent = message || (attachments.length > 0 ? '[Attachment]' : '');
            const msgRecord = await Message.create({
                conversation_id: conversation.id,
                content: msgContent,
                sender: 'customer',
                external_id: externalId,
                metadata: msgMeta
            }, { transaction: t });

            await conversation.update({ updated_at: new Date() }, { transaction: t });

            logger.info(`Stored ${platform} message`, { customerId: customer.id, convId: conversation.id, msgId: msgRecord.id });

            return {
                customer_id: customer.id,
                customer_name: customer.name,
                conversation_id: conversation.id,
                message_id: msgRecord.id,
                message: msgRecord,
                shop_id
            };
        });

        triggerCustomerProfileEnrichment({
            customer: customerForEnrichment,
            metaChannelId: meta_channel_id,
            shopId: shop_id,
            platform: channelType,
            psid: sender,
        });

        return storedMessage;
    } catch (error) {
        logger.error('Failed to store incoming message', {
            error: error.message, platform: event?.platform, shop_id: event?.shop_id, sender: event?.sender, stack: error.stack
        });
        throw error;
    }
}

// ─── Page event handler ──────────────────────────────────────────────────────

/**
 * Handle Facebook Messenger (page object) webhooks.
 */
async function handlePageWebhook(payload, resolveConnectedChannel) {
    for (const entry of payload.entry) {
        const pageId = entry.id;
        logger.info(`Processing Facebook page ${pageId}`, { eventCount: entry.messaging?.length || 0 });

        const channel = await resolveConnectedChannel(pageId, 'facebook');

        if (!channel) {
            logger.error(`No CONNECTED facebook channel for page_id=${pageId} — incoming messages are being dropped`);
            try {
                const MetaChannel = require('../channel-providers/meta-channel.entity');
                const prev = await MetaChannel.findOne({
                    where: { meta_asset_id: pageId },
                    attributes: ['shop_id', 'display_name', 'status']
                });
                if (prev) {
                    sseManager.emit(prev.shop_id, 'channel_error', {
                        type: 'page_disconnected',
                        page_id: pageId,
                        display_name: prev.display_name || pageId,
                        status: prev.status,
                        message: `Facebook page messages are not being delivered — the channel is ${prev.status}. Reconnect it in Settings → Channels.`
                    });
                }
            } catch (_) { /* best-effort SSE */ }
            continue;
        }

        const fbCommentEvents = extractCommentEvents({ object: 'page', entry: [entry] }, 'facebook');
        if (fbCommentEvents.length > 0) dispatchCommentEvents(fbCommentEvents, channel, 'facebook');

        for (const messaging of (entry.messaging || [])) {
            if (messaging.optin) {
                await handleMessagingOptin({ channel, senderId: messaging.sender?.id, optin: messaging.optin });
                continue;
            }
            if (messaging.message?.is_echo) {
                logger.debug(`Skipped echo event from ${messaging.sender.id}`);
                continue;
            }
            const messageText = messaging.message?.text || null;
            const attachments = messaging.message?.attachments || [];
            if (!messageText && attachments.length === 0) {
                logger.debug(`Skipped non-message event from ${messaging.sender.id}`, { keys: Object.keys(messaging) });
                continue;
            }

            const normalizedEvent = {
                platform: 'facebook',
                shop_id: channel.shop_id,
                meta_channel_id: channel.id,
                sender: messaging.sender.id,
                message: messageText || '',
                attachments,
                timestamp: new Date(messaging.timestamp),
                raw_event: messaging
            };

            try {
                logger.info(`Processing message from ${messaging.sender.id} to shop ${channel.shop_id}`);
                const storeResult = await storeIncomingMessage(normalizedEvent);
                if (!storeResult.duplicate) {
                    const msgJson = storeResult.message.toJSON ? storeResult.message.toJSON() : storeResult.message;
                    sseManager.emit(channel.shop_id, 'new_message', {
                        conversation_id: storeResult.conversation_id,
                        message: { ...msgJson, message_type: msgJson.metadata?.message_type || 'text', sender: 'customer' }
                    });
                }
                const { shouldDispatch } = await processInboundConsent({ storeResult, normalizedEvent, channel });
                if (shouldDispatch) dispatchMessageJob(storeResult, normalizedEvent);
                else cancelPendingDispatch(storeResult.conversation_id);
                notifyDmOpened(channel, messaging.sender.id, messageText);
            } catch (err) {
                logger.error(`Failed to store message from ${messaging.sender.id} (page ${pageId})`, {
                    error: err.message, stack: err.stack
                });
            }
        }
    }
}

module.exports = { handlePageWebhook, storeIncomingMessage };
