'use strict';

/**
 * Meta Webhook — Comment-to-DM Dispatch Helpers
 *
 * Routes comment events from Facebook/Instagram webhook entries to the
 * Comment-to-DM state machine service, and notifies it when a DM is opened.
 *
 * Both functions are fire-and-forget — errors are caught and logged but never
 * propagate back to the webhook handler (which must always return 200 to Meta).
 */

const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('MetaWebhookComments');

/**
 * Lazy-load CommentToDmService to avoid circular dependencies at module load.
 */
function getCommentToDmService() {
    const CommentToDmService = require('../commentToDm/comment-to-dm.service');
    return new CommentToDmService();
}

/**
 * Route comment events from a Meta webhook entry to the Comment-to-DM service.
 * Fire-and-forget.
 *
 * @param {object[]} commentEvents  - Normalized events from extractCommentEvents()
 * @param {object}   channel        - Resolved channel row (shop_id, id, platform)
 * @param {string}   platform       - 'facebook' | 'instagram'
 */
function dispatchCommentEvents(commentEvents, channel, platform) {
    if (!commentEvents || commentEvents.length === 0) return;
    const service = getCommentToDmService();
    for (const evt of commentEvents) {
        service.handleCommentEvent({ channel, platform, commentPayload: evt })
            .catch(err => logger.error('CommentToDm handleCommentEvent failed', {
                error: err.message, commentId: evt.commentId,
            }));
    }
}

/**
 * Notify the Comment-to-DM service that a customer opened a DM.
 * Fire-and-forget; no-ops if no matching DM_INVITE_SENT row exists.
 *
 * @param {object} channel              - Resolved channel
 * @param {string} senderExternalId     - Meta sender PSID
 * @param {string|null} messageText     - First DM text (may be null)
 */
function notifyDmOpened(channel, senderExternalId, messageText) {
    try {
        const service = getCommentToDmService();
        service.handleDmOpened({
            channel,
            customerExternalId: senderExternalId,
            message: messageText || '',
        }).catch(err => logger.debug('CommentToDm handleDmOpened error (non-fatal)', { error: err.message }));
    } catch (_) { /* best-effort */ }
}

module.exports = { dispatchCommentEvents, notifyDmOpened };
