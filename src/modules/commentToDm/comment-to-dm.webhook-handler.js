'use strict';

/**
 * comment-to-dm.webhook-handler.js
 *
 * Pure functions for parsing Meta webhook payloads into normalized comment
 * event objects. No DB access, no side effects — only parsing and filtering.
 *
 * Facebook: reads `entry[*].changes` where field === 'feed' and value.item === 'comment'
 * Instagram: reads `entry[*].changes` where field === 'comments'
 *
 * Echo filter: comments posted by the page/account itself are silently dropped.
 * These are the shop's own replies, not customer comments.
 *
 * Output shape (NormalizedCommentEvent):
 * {
 *   commentId:       string,
 *   parentCommentId: string|null,
 *   postId:          string,
 *   commenterId:     string,       // ASID (FB) or IGSID (IG)
 *   commenterName:   string|null,
 *   text:            string|null,
 *   pageOrAccountId: string,
 *   occurredAt:      number,       // unix ms
 * }
 */

/**
 * Extract normalized comment events from a Meta webhook payload.
 *
 * @param {object|null} payload - Raw Meta webhook body (already JSON-parsed)
 * @param {'facebook'|'instagram'} platform
 * @returns {NormalizedCommentEvent[]}
 */
function extractCommentEvents(payload, platform) {
    if (!payload || !Array.isArray(payload.entry)) return [];

    const events = [];

    for (const entry of payload.entry) {
        const pageOrAccountId = entry.id;
        const changes = Array.isArray(entry.changes) ? entry.changes : [];

        if (platform === 'facebook') {
            for (const change of changes) {
                if (change.field !== 'feed') continue;
                const v = change.value;
                if (!v || v.item !== 'comment') continue;

                const commenterId = v.from?.id || null;
                if (!commenterId) continue;

                // Filter echo: page replied to its own post comment
                if (commenterId === pageOrAccountId) continue;

                events.push({
                    commentId:       v.comment_id || null,
                    parentCommentId: v.parent_id || null,
                    postId:          v.post_id || null,
                    commenterId,
                    commenterName:   v.from?.name || null,
                    text:            v.message || null,
                    pageOrAccountId,
                    occurredAt:      v.created_time ? v.created_time * 1000 : Date.now(),
                });
            }
        } else if (platform === 'instagram') {
            for (const change of changes) {
                if (change.field !== 'comments') continue;
                const v = change.value;
                if (!v) continue;

                const commenterId = v.from?.id || null;
                if (!commenterId) continue;

                // Filter echo: account's own comment
                if (commenterId === pageOrAccountId) continue;

                events.push({
                    commentId:       v.id || null,
                    parentCommentId: v.parent_id || null,
                    postId:          v.media?.id || null,
                    commenterId,
                    commenterName:   v.from?.username || v.from?.name || null,
                    text:            v.text || null,
                    pageOrAccountId,
                    occurredAt:      Date.now(),
                });
            }
        }
    }

    return events;
}

module.exports = { extractCommentEvents };
