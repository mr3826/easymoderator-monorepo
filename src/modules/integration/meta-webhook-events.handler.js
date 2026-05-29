'use strict';

/**
 * Meta Webhook — Page and Instagram Event Handlers
 *
 * Handles inbound Messenger (page) and Instagram Direct webhooks:
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
const { getProvider } = require('../channel-providers/provider.registry');

const logger = createLogger('MetaWebhookEvents');

// Placeholder names assigned when a customer is first seen via webhook (before
// we've fetched their real Meta profile). enrichCustomerName replaces these.
const PLACEHOLDER_NAME_RE = /^(facebook|instagram) user$|^customer$/i;

/**
 * Best-effort: fetch the customer's real name from Meta and persist it, replacing
 * the "facebook user" / "instagram user" placeholder. Non-blocking and never throws
 * — a failed profile lookup must not affect inbound message handling. Emits a
 * `customer_updated` SSE event so open inboxes refresh the displayed name live.
 */
async function enrichCustomerName({ channel, platform, senderId, customerId }) {
    try {
        if (!channel || !customerId || !senderId) return;
        const customer = await Customer.findByPk(customerId);
        if (!customer) return;
        // Only fetch when the name is still a placeholder (avoids a Graph call per message).
        if (customer.name && !PLACEHOLDER_NAME_RE.test(customer.name)) return;

        const provider = getProvider(platform);
        if (!provider?.getUserProfile) return;
        const profile = await provider.getUserProfile(channel, senderId);
        if (!profile?.name) return;

        await customer.update({ name: profile.name });
        sseManager.emit(channel.shop_id, 'customer_updated', {
            customer_id: customerId,
            name: profile.name,
        });
    } catch (err) {
        logger.warn('enrichCustomerName failed (continuing)', { error: err.message });
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
 * Dispatch a BullMQ job for AI processing after a message has been stored to DB.
 * Non-blocking — errors are logged but never propagate back to the webhook handler.
 */
async function dispatchMessageJob(storeResult, event) {
    const queue = getMessageQueue();
    if (!queue) {
        logger.error('BullMQ unavailable — message stored in DB but AI pipeline skipped', {
            shopId: event.shop_id,
            platform: event.platform,
            externalId: event.raw_event?.message?.mid || event.raw_event?.id || null
        });
        return;
    }

    const { shop_id, sender, platform, message, attachments = [], raw_event, meta_channel_id = null } = event;
    const { conversation_id, message_id, customer_id } = storeResult;
    const externalId = raw_event?.message?.mid || raw_event?.id || null;
    const jobId = externalId ? `${shop_id}:${externalId}` : undefined;

    try {
        await queue.add(
            `msg:${shop_id}`,
            {
                shopId: shop_id,
                conversationId: conversation_id,
                messageId: message_id,
                externalId,
                message: message || '',
                platform,
                recipientId: sender,
                senderInfo: { customer_id },
                attachments,
                metaChannelId: meta_channel_id,
            },
            {
                jobId,
                group: { id: shop_id },
            }
        );
    } catch (err) {
        logger.error('Failed to dispatch BullMQ job', { error: err.message, shop_id, externalId });
    }
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
                name: `${channel.platform} user`,
                channel_type: channelType,
                channel_user_id: String(senderId),
                metadata: { source: 'messaging_optins' },
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

        return await sequelize.transaction(async (t) => {
            const [customer, customerCreated] = await Customer.findOrCreate({
                where: { shop_id, channel_type: channelType, channel_user_id: sender },
                defaults: {
                    shop_id,
                    name: `${platform} user`,
                    channel_type: channelType,
                    channel_user_id: sender,
                    metadata: { source: 'webhook', platform }
                },
                transaction: t
            });

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
                customer_created: customerCreated,
                conversation_id: conversation.id,
                message_id: msgRecord.id,
                message: msgRecord,
                shop_id
            };
        });
    } catch (error) {
        logger.error('Failed to store incoming message', {
            error: error.message, platform: event?.platform, shop_id: event?.shop_id, sender: event?.sender, stack: error.stack
        });
        throw error;
    }
}

// ─── Page / Instagram event handlers ─────────────────────────────────────────

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
                        message: {
                            ...msgJson,
                            message_type: msgJson.metadata?.message_type || 'text',
                            sender: 'customer',
                            // Guarantee a timestamp so the inbox never renders "Invalid Date"
                            // if the freshly-created row's created_at isn't populated yet.
                            created_at: msgJson.created_at || new Date().toISOString(),
                        }
                    });
                }
                const { shouldDispatch } = await processInboundConsent({ storeResult, normalizedEvent, channel });
                if (shouldDispatch) dispatchMessageJob(storeResult, normalizedEvent);
                if (storeResult.customer_created) {
                    enrichCustomerName({ channel, platform: 'facebook', senderId: messaging.sender.id, customerId: storeResult.customer_id }).catch(() => {});
                }
                notifyDmOpened(channel, messaging.sender.id, messageText);
            } catch (err) {
                logger.error(`Failed to store message from ${messaging.sender.id} (page ${pageId})`, {
                    error: err.message, stack: err.stack
                });
            }
        }
    }
}

/**
 * Handle Instagram Direct webhooks.
 */
async function handleInstagramWebhook(payload, resolveConnectedChannel) {
    for (const entry of payload.entry) {
        const igAccountId = entry.id;

        const channel = await resolveConnectedChannel(igAccountId, 'instagram');

        if (!channel) {
            logger.error(`No CONNECTED instagram channel for account ${igAccountId} — incoming messages are being dropped`);
            try {
                const MetaChannel = require('../channel-providers/meta-channel.entity');
                const prev = await MetaChannel.findOne({
                    where: { meta_asset_id: igAccountId },
                    attributes: ['shop_id', 'display_name', 'status']
                });
                if (prev) {
                    sseManager.emit(prev.shop_id, 'channel_error', {
                        type: 'page_disconnected',
                        page_id: igAccountId,
                        display_name: prev.display_name || igAccountId,
                        status: prev.status,
                        message: `Instagram DM messages are not being delivered — the channel is ${prev.status}. Reconnect it in Settings → Channels.`
                    });
                }
            } catch (_) { /* best-effort SSE */ }
            continue;
        }

        const igCommentEvents = extractCommentEvents({ object: 'instagram', entry: [entry] }, 'instagram');
        if (igCommentEvents.length > 0) dispatchCommentEvents(igCommentEvents, channel, 'instagram');

        for (const message of (entry.messaging || [])) {
            if (message.optin) {
                await handleMessagingOptin({ channel, senderId: message.sender?.id, optin: message.optin });
                continue;
            }
            if (message.message?.is_echo) continue;
            const messageText = message.message?.text || null;
            const attachments = message.message?.attachments || [];
            if (!messageText && attachments.length === 0) continue;

            const normalizedEvent = {
                platform: 'instagram',
                shop_id: channel.shop_id,
                meta_channel_id: channel.id,
                sender: message.sender.id,
                message: messageText || '',
                attachments,
                timestamp: new Date(message.timestamp),
                raw_event: message
            };

            try {
                const storeResult = await storeIncomingMessage(normalizedEvent);
                if (!storeResult.duplicate) {
                    const msgJson = storeResult.message.toJSON ? storeResult.message.toJSON() : storeResult.message;
                    sseManager.emit(channel.shop_id, 'new_message', {
                        conversation_id: storeResult.conversation_id,
                        message: {
                            ...msgJson,
                            message_type: msgJson.metadata?.message_type || 'text',
                            sender: 'customer',
                            // Guarantee a timestamp so the inbox never renders "Invalid Date"
                            // if the freshly-created row's created_at isn't populated yet.
                            created_at: msgJson.created_at || new Date().toISOString(),
                        }
                    });
                }
                const { shouldDispatch } = await processInboundConsent({ storeResult, normalizedEvent, channel });
                if (shouldDispatch) dispatchMessageJob(storeResult, normalizedEvent);
                if (storeResult.customer_created) {
                    enrichCustomerName({ channel, platform: 'instagram', senderId: message.sender.id, customerId: storeResult.customer_id }).catch(() => {});
                }
                notifyDmOpened(channel, message.sender.id, messageText);
            } catch (err) {
                logger.error(`Failed to store Instagram message from ${message.sender.id} (account ${igAccountId})`, {
                    error: err.message, stack: err.stack
                });
            }
        }
    }
}

module.exports = { handlePageWebhook, handleInstagramWebhook, storeIncomingMessage };
