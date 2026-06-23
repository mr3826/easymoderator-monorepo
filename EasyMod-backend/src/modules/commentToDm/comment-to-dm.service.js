'use strict';

/**
 * CommentToDmService
 *
 * Orchestrates the Comment-to-DM lifecycle:
 *   handleCommentEvent   — webhook arrives, keyword match, create DB row
 *   processQueuedComment — BullMQ worker: public reply + private reply DM invite
 *   handleDmOpened       — inbound DM webhook: link customer + conversation
 *   tryUnlockAutomation  — check all 5 conditions, run policy dry-run
 *   expireStale          — cron: mark rows expired after 7 days
 *
 * Critical invariants enforced here:
 *   1. Redis NX key prevents duplicate DMs on webhook retry
 *   2. Duplicate comment_id (unique violation) silently no-ops
 *   3. Channel resolved from meta_channels via meta_asset_id — drop if not found
 *   4. No legacy table writes; new-schema-only
 *   5. Every state transition writes last_transition_at + emits SSE
 */

const { Op } = require('sequelize');
const { createLogger } = require('../../utils/structured-logger');
const { canTransition } = require('./comment-to-dm.state-machine');
const CommentToDmEvent = require('./comment-to-dm.entity');
const MetaChannelSettings = require('../channel-providers/meta-channel-settings.entity');
const MetaChannel = require('../channel-providers/meta-channel.entity');
const { parseLiveOrderIntent } = require('./live-order-parser');
const { getLiveSellingSettings } = require('./live-selling-settings');
const sse = require('../../utils/sse-manager');
const { opsAlert } = require('../../utils/ops-alert');

const logger = createLogger('CommentToDm');

// TTL for the Redis idempotency key (7 days in seconds)
const DM_IDEMPOTENCY_TTL = 7 * 24 * 3600;

// Rows older than this threshold qualify for expiry sweep
const EXPIRY_THRESHOLD_DAYS = 7;

/**
 * Lazy-load Redis so the service boots even if Redis is temporarily down.
 * @returns {import('ioredis').Redis|null}
 */
function getRedis() {
    try {
        const { cacheRedis } = require('../../config/redis');
        if (cacheRedis && cacheRedis.status === 'ready') return cacheRedis;
    } catch (_) { /* Redis unavailable */ }
    return null;
}

/**
 * Lazy-load the comment-to-dm BullMQ queue from queue-manager.
 */
function getCommentToDmQueue() {
    try {
        const qm = require('../../jobs/queue-manager');
        return qm.queues?.commentToDm || null;
    } catch (_) {
        return null;
    }
}

/**
 * Get the provider for a channel platform.
 */
function getProvider(platform) {
    const registry = require('../channel-providers/provider.registry');
    return registry.getProvider(platform);
}

/**
 * Build the private-reply (DM invite) text. When a live-selling order intent was
 * captured from the comment, the invite confirms what we saw and asks the buyer
 * to finalize — still a single reactive private reply (Meta-policy SAFE).
 */
function buildDmInviteText(liveOrder) {
    if (liveOrder && liveOrder.isPurchaseIntent) {
        const parts = [];
        if (liveOrder.quantity) parts.push(`Qty: ${liveOrder.quantity}`);
        if (liveOrder.size) parts.push(`Size: ${liveOrder.size}`);
        const detail = parts.length ? ` (${parts.join(', ')})` : '';
        return `Hi! Thanks for your order from our live${detail}. Please confirm your details here and we'll place it for you. 🛍️`;
    }
    return 'Hi! Thank you for your interest. Feel free to ask us anything here in DM.';
}

class CommentToDmService {

    // ── Internal helpers ──────────────────────────────────────────────────────

    /**
     * Emit one SSE event and update last_transition_at on the DB row.
     * Called after every state transition. Best-effort for SSE — never throws.
     */
    async _recordTransition(event, fromState, toState, extraFields = {}) {
        const now = new Date();
        try {
            await event.update({
                state: toState,
                last_transition_at: now,
                ...extraFields,
            });
            // Mutate the in-memory object so subsequent _assertTransition calls
            // see the updated state (important for multi-step processQueuedComment).
            event.state = toState;
            event.last_transition_at = now;
        } catch (err) {
            logger.error('CommentToDm: failed to persist state transition', {
                eventId: event.id, from: fromState, to: toState, error: err.message,
            });
            throw err;
        }

        try {
            sse.emit(event.shop_id, 'comment_to_dm.transition', {
                eventId: event.id,
                from: fromState,
                to: toState,
                occurredAt: now.toISOString(),
            });
        } catch (sseErr) {
            // SSE emit is best-effort
            logger.warn('CommentToDm: SSE emit failed', { error: sseErr.message });
        }
    }

    /**
     * Validate and execute a transition, throwing if the edge is not allowed.
     */
    _assertTransition(event, toState) {
        const fromState = event.state;
        if (!canTransition(fromState, toState)) {
            throw new Error(
                `CommentToDm: invalid transition ${fromState} → ${toState} for event ${event.id}`
            );
        }
        return fromState;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * handleCommentEvent({ channel, platform, commentPayload })
     *
     * Called from the webhook router after a comment is extracted.
     * Matches keywords and post filter, creates DB row, enqueues BullMQ job.
     *
     * @param {{ channel: MetaChannelRow, platform: string, commentPayload: NormalizedCommentEvent }} params
     */
    async handleCommentEvent({ channel, platform, commentPayload }) {
        const {
            commentId,
            parentCommentId,
            postId,
            commenterId,
            commenterName,
            text,
        } = commentPayload;

        // Resolve settings
        let settings;
        try {
            settings = await MetaChannelSettings.findOne({
                where: { channel_id: channel.id },
            });
        } catch (err) {
            logger.error('CommentToDm: failed to load settings', { channelId: channel.id, error: err.message });
            return;
        }

        if (!settings || !settings.comment_to_dm_enabled) {
            logger.debug('CommentToDm: disabled or no settings for channel', { channelId: channel.id });
            return;
        }

        // Determine initial state: MATCHED or BLOCKED.
        // Empty keyword lists must not become "DM every commenter"; that is a
        // spam-prone review risk. Normal comment-to-DM requires an explicit
        // keyword, while live-selling can still match a parsed purchase intent.
        let matchedState = 'BLOCKED';
        let matchedKeyword = null;
        let liveOrder = null; // parsed live-selling purchase intent, if any

        // Post filter: if non-empty, comment must be on one of those posts
        const postFilter = Array.isArray(settings.comment_to_dm_post_filter)
            ? settings.comment_to_dm_post_filter
            : [];
        const postAllowed = !(postFilter.length > 0 && !postFilter.includes(postId));

        // Keyword filter: if non-empty, comment text must contain a keyword
        if (postAllowed) {
            const keywords = Array.isArray(settings.comment_to_dm_keywords)
                ? settings.comment_to_dm_keywords
                : [];
            if (keywords.length > 0) {
                const lowerText = (text || '').toLowerCase();
                const hit = keywords.find(kw => lowerText.includes(kw.toLowerCase()));
                if (hit) {
                    matchedKeyword = hit;
                    matchedState = 'MATCHED';
                } else {
                    matchedState = 'BLOCKED';
                }
            }
            // Empty keywords list = no normal comment-to-DM match.

            // ── Live-selling capture ──────────────────────────────────────────
            // When the shop is live-selling, a purchase-intent comment ("nibo",
            // "size M", "2 ta") is captured as an order even without an exact
            // configured keyword. This only widens the MATCH set on the shop's
            // OWN channel; the DM send path (rate limit, opt-out, idempotency,
            // 24h window) is unchanged → Meta-policy SAFE.
            try {
                const liveSettings = await getLiveSellingSettings(channel.shop_id);
                if (liveSettings.enabled) {
                    const intent = parseLiveOrderIntent(text, liveSettings.intent_keywords);
                    if (intent.isPurchaseIntent) {
                        liveOrder = intent;
                        if (matchedState === 'BLOCKED') {
                            matchedState = 'MATCHED';
                            matchedKeyword = matchedKeyword || 'live_intent';
                        }
                    }
                }
            } catch (liveErr) {
                logger.warn('CommentToDm: live-selling intent check failed (non-fatal)', {
                    channelId: channel.id, error: liveErr.message,
                });
            }
        }

        // Create DB row — idempotent via unique constraint on comment_id
        let event;
        try {
            event = await CommentToDmEvent.create({
                shop_id:               channel.shop_id,
                channel_id:            channel.id,
                platform,
                post_id:               postId,
                comment_id:            commentId,
                parent_comment_id:     parentCommentId || null,
                commenter_external_id: commenterId,
                commenter_name:        commenterName || null,
                comment_text:          text || null,
                matched_keyword:       matchedKeyword,
                state:                 matchedState,
                last_transition_at:    new Date(),
                metadata:              liveOrder ? { live_order: liveOrder } : {},
            });
        } catch (err) {
            if (err.name === 'SequelizeUniqueConstraintError') {
                logger.info('CommentToDm: duplicate comment_id, skipping', { commentId });
                return;
            }
            logger.error('CommentToDm: failed to create event row', { commentId, error: err.message });
            return;
        }

        // Emit SSE for COMMENT_RECEIVED → MATCHED/BLOCKED transition
        try {
            sse.emit(channel.shop_id, 'comment_to_dm.transition', {
                eventId: event.id,
                from:       'COMMENT_RECEIVED',
                to:         matchedState,
                occurredAt: event.last_transition_at?.toISOString?.() || new Date().toISOString(),
            });
        } catch (_) { /* best-effort */ }

        // Enqueue job only for MATCHED rows
        if (matchedState === 'MATCHED') {
            const queue = getCommentToDmQueue();
            if (queue) {
                try {
                    await queue.add('processQueuedComment',
                        { eventId: event.id },
                        {
                            jobId: `ctd_${event.id}`, // BullMQ-level dedup ('_' not ':' — BullMQ forbids ':' in custom job IDs)
                            attempts: 3,
                            backoff: { type: 'exponential', delay: 5000 },
                        }
                    );
                } catch (qErr) {
                    // Error must be the logger's 2nd positional arg so .message/.code
                    // are captured; context (eventId, jobId) goes in meta. Passing a
                    // plain object here would log `error:{}` and swallow the cause.
                    logger.error('CommentToDm: failed to enqueue job', qErr, {
                        eventId: event.id,
                        jobId: `ctd_${event.id}`,
                    });
                    // Stage alert: comment matched but the DM job never enqueued →
                    // the commenter gets no auto-DM. Throttled per-title.
                    opsAlert('Comment→DM enqueue FAILED — commenter gets no auto-DM', {
                        detail: `eventId=${event.id} jobId=ctd_${event.id}\nerror: ${qErr.message}`,
                        level: 'error',
                        context: { eventId: event.id, error: qErr.message },
                    }).catch(() => {});
                }
            } else {
                logger.warn('CommentToDm: BullMQ queue unavailable, job not enqueued', { eventId: event.id });
            }
        }
    }

    /**
     * processQueuedComment({ eventId })
     *
     * BullMQ worker entry point.
     * MATCHED → PUBLIC_REPLY_QUEUED → PUBLIC_REPLIED → DM_INVITE_SENT
     * Redis NX key prevents duplicate DMs on retry.
     *
     * @param {{ eventId: string }} params
     */
    async processQueuedComment({ eventId }) {
        const event = await CommentToDmEvent.findOne({ where: { id: eventId } });
        if (!event) {
            logger.warn('CommentToDm: event not found for processing', { eventId });
            return;
        }
        if (event.state !== 'MATCHED') {
            logger.debug('CommentToDm: event not in MATCHED state, skipping', {
                eventId, state: event.state,
            });
            return;
        }

        // Resolve channel
        const channel = await MetaChannel.findOne({ where: { id: event.channel_id } });
        if (!channel) {
            logger.error('CommentToDm: channel not found', { channelId: event.channel_id, eventId });
            await this._recordTransition(event, 'MATCHED', 'FAILED', {
                last_error: 'Channel not found',
            });
            return;
        }

        // ── Redis idempotency (invariant 1) ───────────────────────────────────
        const idempotencyKey = `comment_dm_sent:${event.shop_id}:${event.comment_id}:${event.commenter_external_id}`;
        const redis = getRedis();
        if (redis) {
            const acquired = await redis.set(idempotencyKey, '1', 'EX', DM_IDEMPOTENCY_TTL, 'NX');
            if (!acquired) {
                // Key already exists — DM already sent, skip silently
                logger.info('CommentToDm: Redis NX key exists — duplicate DM blocked', {
                    eventId, key: idempotencyKey,
                });
                return;
            }
        } else {
            logger.warn('CommentToDm: Redis unavailable — cannot enforce idempotency', { eventId });
        }

        const provider = getProvider(event.platform);

        // ── PUBLIC_REPLY_QUEUED ────────────────────────────────────────────────
        const fromMatched = this._assertTransition(event, 'PUBLIC_REPLY_QUEUED');
        await this._recordTransition(event, fromMatched, 'PUBLIC_REPLY_QUEUED');

        // ── PUBLIC_REPLIED ────────────────────────────────────────────────────
        try {
            const publicText = 'Please check your message inbox — we sent you a private reply.';
            await provider.sendPublicCommentReply({
                channel,
                commentId: event.comment_id,
                text: publicText,
            });
        } catch (err) {
            logger.warn('CommentToDm: public reply failed (non-fatal, continuing to DM)', {
                eventId, error: err.message,
            });
        }
        const fromQueued = this._assertTransition(event, 'PUBLIC_REPLIED');
        await this._recordTransition(event, fromQueued, 'PUBLIC_REPLIED');

        // ── DM_INVITE_SENT ────────────────────────────────────────────────────
        try {
            await provider.sendPrivateReplyToComment({
                channel,
                commentId: event.comment_id,
                normalizedMessage: {
                    text: buildDmInviteText(event.metadata?.live_order),
                },
            });
        } catch (err) {
            logger.error('CommentToDm: private reply (DM invite) failed', { eventId, error: err.message });
            const fromReplied = this._assertTransition(event, 'FAILED');
            await this._recordTransition(event, fromReplied, 'FAILED', { last_error: err.message });
            return;
        }

        const fromReplied = this._assertTransition(event, 'DM_INVITE_SENT');
        await this._recordTransition(event, fromReplied, 'DM_INVITE_SENT');

        logger.info('CommentToDm: DM invite sent', { eventId, commentId: event.comment_id });
    }

    /**
     * handleDmOpened({ channel, customerExternalId, message })
     *
     * Called as a fire-and-forget side effect from the inbound DM webhook handler
     * when a customer sends a DM after a comment-to-DM invite.
     *
     * Looks up the most recent DM_INVITE_SENT row for this commenter,
     * transitions to CUSTOMER_OPENED_DM, links customer_id + conversation_id.
     *
     * @param {{ channel: object, customerExternalId: string, message: string }} params
     */
    async handleDmOpened({ channel, customerExternalId, message }) {
        // Find the pending invite for this commenter on this shop/platform
        const event = await CommentToDmEvent.findOne({
            where: {
                shop_id:               channel.shop_id,
                commenter_external_id: customerExternalId,
                state:                 'DM_INVITE_SENT',
            },
            order: [['last_transition_at', 'DESC']],
        });

        if (!event) {
            // No pending invite — this is a regular DM, not comment-to-DM
            return;
        }

        // Find customer and conversation for linkage
        let customerId = null;
        let conversationId = null;
        try {
            const { Customer, Conversation } = require('../entities');
            const channelType = channel.platform === 'facebook' ? 'messenger' : 'instagram';
            const customer = await Customer.findOne({
                where: {
                    shop_id:         channel.shop_id,
                    channel_user_id: String(customerExternalId),
                    channel_type:    channelType,
                },
            });
            if (customer) {
                customerId = customer.id;
                const conv = await Conversation.findOne({
                    where: { shop_id: channel.shop_id, customer_id: customer.id },
                    order: [['created_at', 'DESC']],
                });
                if (conv) conversationId = conv.id;
            }
        } catch (err) {
            logger.warn('CommentToDm: handleDmOpened — customer/conv lookup failed', { error: err.message });
        }

        const fromState = this._assertTransition(event, 'CUSTOMER_OPENED_DM');
        await this._recordTransition(event, fromState, 'CUSTOMER_OPENED_DM', {
            customer_id:     customerId,
            conversation_id: conversationId,
        });

        logger.info('CommentToDm: customer opened DM', {
            eventId: event.id, customerId, conversationId,
        });

        // Attempt immediate automation unlock
        try {
            await this.tryUnlockAutomation({ eventId: event.id });
        } catch (err) {
            logger.debug('CommentToDm: automation unlock deferred', { eventId: event.id, reason: err.message });
        }
    }

    /**
     * tryUnlockAutomation({ eventId })
     *
     * Checks ALL 5 unlock conditions. Runs policy engine dry-run.
     * Transitions to AUTOMATION_UNLOCKED on pass.
     *
     * Conditions:
     *   1. customer.messaging_consent[platform].opted_out_at is null
     *   2. Customer has sent >= 1 inbound DM (24h window opened)
     *   3. conversation.hitl === false
     *   4. MetaChannelSettings.automation_mode in {AI_ACTIVE, AI_SUGGEST_ONLY}
     *   5. Policy engine dry-run returns allow: true
     *
     * @param {{ eventId: string }} params
     */
    async tryUnlockAutomation({ eventId }) {
        const event = await CommentToDmEvent.findOne({ where: { id: eventId } });
        if (!event) throw new Error(`CommentToDm: event ${eventId} not found`);
        if (event.state !== 'CUSTOMER_OPENED_DM') {
            throw new Error(`CommentToDm: event ${eventId} not in CUSTOMER_OPENED_DM state`);
        }
        if (!event.customer_id) throw new Error('CommentToDm: customer_id not linked yet');

        const { Customer, Conversation } = require('../entities');

        const [customer, settings, conversation] = await Promise.all([
            Customer.findOne({ where: { id: event.customer_id } }),
            MetaChannelSettings.findOne({ where: { channel_id: event.channel_id } }),
            event.conversation_id
                ? Conversation.findOne({ where: { id: event.conversation_id } })
                : Promise.resolve(null),
        ]);

        if (!customer || !settings) {
            throw new Error('CommentToDm: missing customer or settings for unlock check');
        }

        const platform = event.platform;

        // Condition 1: not opted out
        const consent = customer.messaging_consent || {};
        const platformConsent = consent[platform] || {};
        if (platformConsent.opted_out_at) {
            throw new Error(`CommentToDm: customer opted out on ${platform}`);
        }

        // Condition 2: 24h window opened (last inbound within 24h)
        const lastInboundAt = platformConsent.last_inbound_at
            ? new Date(platformConsent.last_inbound_at)
            : null;
        const windowOk = lastInboundAt && (Date.now() - lastInboundAt.getTime()) < 24 * 3600 * 1000;
        if (!windowOk) {
            throw new Error('CommentToDm: 24h window not opened');
        }

        // Condition 3: not in HITL
        if (conversation && conversation.hitl === true) {
            throw new Error('CommentToDm: conversation is in HITL mode');
        }

        // Condition 4: automation mode allows AI
        const allowedModes = ['AI_ACTIVE', 'AI_SUGGEST_ONLY'];
        if (!allowedModes.includes(settings.automation_mode)) {
            throw new Error(`CommentToDm: automation_mode ${settings.automation_mode} does not allow AI`);
        }

        // Condition 4b: subscription billing status allows AI. An expired trial
        // or a suspended/cancelled plan pauses automation (manual replies still
        // work). Fails open when no subscription row exists.
        {
            const { Subscription } = require('../entities');
            const { isAiActive } = require('../subscription/subscription.access');
            const billingSub = await Subscription.findOne({
                where: { shop_id: event.shop_id },
                attributes: ['status'],
            });
            if (!isAiActive(billingSub)) {
                throw new Error(`CommentToDm: subscription status ${billingSub?.status} pauses AI`);
            }
        }

        // Condition 5: policy engine dry-run
        const policyEngine = require('../policy/policy.engine');
        const channel = await MetaChannel.findOne({ where: { id: event.channel_id } });
        const policyCtx = {
            shopId:         event.shop_id,
            platform,
            customer,
            channel,
            settings,
            conversationId: event.conversation_id || null,
            options:        { skipPersist: true },
        };
        const decision = await policyEngine.evaluateOutbound(
            { text: '', platform, direction: 'outbound' },
            policyCtx
        );
        if (!decision.allow) {
            throw new Error(`CommentToDm: policy dry-run denied: ${decision.reason}`);
        }

        // All 5 conditions met — transition to AUTOMATION_UNLOCKED
        const fromState = this._assertTransition(event, 'AUTOMATION_UNLOCKED');
        await this._recordTransition(event, fromState, 'AUTOMATION_UNLOCKED');

        logger.info('CommentToDm: automation unlocked', { eventId, customerId: event.customer_id });
    }

    /**
     * expireStale()
     *
     * Called by the expiry cron job.
     * Marks rows EXPIRED if state ∈ {DM_INVITE_SENT, CUSTOMER_OPENED_DM}
     * and last_transition_at < now() - 7 days.
     *
     * @returns {{ expired: number }}
     */
    async expireStale() {
        const threshold = new Date(Date.now() - EXPIRY_THRESHOLD_DAYS * 24 * 3600 * 1000);

        const staleRows = await CommentToDmEvent.findAll({
            where: {
                state:              { [Op.in]: ['DM_INVITE_SENT', 'CUSTOMER_OPENED_DM'] },
                last_transition_at: { [Op.lt]: threshold },
            },
        });

        let expired = 0;
        for (const row of staleRows) {
            try {
                await row.update({
                    state:              'EXPIRED',
                    last_transition_at: new Date(),
                });
                try {
                    sse.emit(row.shop_id, 'comment_to_dm.transition', {
                        eventId:    row.id,
                        from:       row.state,
                        to:         'EXPIRED',
                        occurredAt: new Date().toISOString(),
                    });
                } catch (_) { /* best-effort */ }
                expired++;
            } catch (err) {
                logger.error('CommentToDm: failed to expire row', { rowId: row.id, error: err.message });
            }
        }

        logger.info('CommentToDm: expiry sweep complete', { expired, checked: staleRows.length });
        return { expired, checked: staleRows.length };
    }
}

module.exports = CommentToDmService;
