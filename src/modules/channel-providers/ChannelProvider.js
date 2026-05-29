/**
 * ChannelProvider
 *
 * Abstract base class for messaging channel providers (Facebook Messenger, Instagram, etc.).
 * All concrete providers MUST extend this class and implement every method.
 *
 * Registering a new channel:
 *   1. Create a new file in ./providers/ extending ChannelProvider
 *   2. Implement all methods
 *   3. Register the instance in provider.registry.js
 *
 * Method contracts are described via JSDoc below.
 * Concrete methods MUST honour the documented return shapes so callers
 * can remain provider-agnostic.
 */

'use strict';

/**
 * @typedef {object} NormalizedAttachment
 * @property {'image'|'video'|'audio'|'file'|'sticker'|'location'|'template'} type
 * @property {string} [url]
 * @property {string} [mimeType]
 * @property {string} [filename]
 * @property {object} [payload]
 */

/**
 * @typedef {object} NormalizedInboundEvent
 * @property {string} externalId        - Provider-side message ID (mid)
 * @property {string} senderExternalId  - PSID / IGSID of the sender
 * @property {string} pageOrAccountId   - Meta asset ID that received the event
 * @property {string|null} text         - Message text (null for attachment-only)
 * @property {NormalizedAttachment[]} attachments
 * @property {boolean} isEcho           - True for echo events (bot's own messages)
 * @property {string|null} commentId    - Set for comment events
 * @property {string|null} postId       - Set for comment events
 * @property {number} occurredAt        - Unix timestamp ms
 * @property {object} raw               - Full original payload for traceability
 */

/**
 * @typedef {object} PolicyDecision
 * @property {boolean} allow
 * @property {string} reason
 * @property {object} [augment]
 * @property {string} [augment.message_tag]
 */

class ChannelProvider {

    // ── Identity ────────────────────────────────────────────────────────────────

    /**
     * The platform identifier for this provider.
     * Must match the value stored in meta_channels.platform.
     *
     * @returns {'facebook'|'instagram'}
     */
    get platform() {
        throw new Error('not_implemented');
    }

    // ── OAuth lifecycle ─────────────────────────────────────────────────────────

    /**
     * Build the provider's OAuth authorization URL.
     *
     * @param {object} params
     * @param {string} params.state       - CSRF state token (pre-stored in Redis by caller)
     * @param {string[]} [params.scopes]  - Override default scopes (optional)
     * @returns {Promise<string>} Full authorization URL to redirect the user to
     */
    async buildAuthUrl({ state, scopes }) {
        throw new Error('not_implemented');
    }

    /**
     * Exchange an authorization code for tokens.
     * Extends the short-lived token to a long-lived 60-day token.
     *
     * @param {object} params
     * @param {string} params.code         - Auth code from provider callback
     * @param {string} params.redirectUri
     * @returns {Promise<{ userToken: string, expiresAt: Date|null }>}
     */
    async exchangeCode({ code, redirectUri }) {
        throw new Error('not_implemented');
    }

    /**
     * List the managed assets (Pages / IG accounts) available to a user token.
     *
     * @param {object} params
     * @param {string} params.userToken - Long-lived user access token
     * @returns {Promise<Array<{ id: string, name: string, pictureUrl: string|null, [extra]: any }>>}
     */
    async listManagedAssets({ userToken }) {
        throw new Error('not_implemented');
    }

    /**
     * Get the page-scoped access token for a specific asset.
     *
     * @param {object} params
     * @param {string} params.assetId    - Page ID or IG Business Account ID
     * @param {string} params.userToken  - Long-lived user access token
     * @returns {Promise<{ token: string, expiresAt: Date|null }>}
     */
    async getAssetAccessToken({ assetId, userToken }) {
        throw new Error('not_implemented');
    }

    /**
     * Refresh the page access token stored on a channel.
     * Updates the channel in-place via MetaChannelService.updateTokens().
     *
     * @param {object} params
     * @param {object} params.channel - MetaChannel instance with decrypted token
     * @returns {Promise<{ token: string, expiresAt: Date|null }>}
     */
    async refreshAssetToken({ channel }) {
        throw new Error('not_implemented');
    }

    /**
     * Revoke the app's access to an asset (page deauthorization).
     * Meta auto-revokes on user deauth; this is a best-effort call.
     *
     * @param {object} params
     * @param {object} params.channel - MetaChannel instance
     * @returns {Promise<void>}
     */
    async revokeAsset({ channel }) {
        throw new Error('not_implemented');
    }

    // ── Webhook lifecycle ───────────────────────────────────────────────────────

    /**
     * Return the list of webhook fields this provider subscribes to.
     * Used during webhookSubscribe and as the source of truth for subscription
     * validation tests.
     *
     * @returns {string[]}
     */
    webhookFields() {
        throw new Error('not_implemented');
    }

    /**
     * Subscribe the channel's asset to Meta webhooks.
     *
     * @param {object} params
     * @param {object} params.channel - MetaChannel instance (token decrypted by getter)
     * @returns {Promise<void>}
     */
    async subscribeWebhook({ channel }) {
        throw new Error('not_implemented');
    }

    /**
     * Unsubscribe the channel's asset from Meta webhooks.
     *
     * @param {object} params
     * @param {object} params.channel - MetaChannel instance
     * @returns {Promise<void>}
     */
    async unsubscribeWebhook({ channel }) {
        throw new Error('not_implemented');
    }

    /**
     * Verify the HMAC-SHA256 signature on an inbound webhook request.
     *
     * @param {object} params
     * @param {Buffer|string} params.rawBody   - Raw request body bytes
     * @param {string} params.signature        - X-Hub-Signature-256 header value (sha256=...)
     * @returns {Promise<boolean>}
     */
    async verifyWebhookSignature({ rawBody, signature }) {
        throw new Error('not_implemented');
    }

    // ── Inbound normalization ───────────────────────────────────────────────────

    /**
     * Parse a raw Meta webhook envelope and return normalized events.
     * Drops echo events (isEcho === true) internally — caller receives only real events.
     * Returns an empty array for unrecognised or unsupported payloads.
     *
     * @param {object} payload - Raw parsed JSON from Meta webhook POST body
     * @returns {NormalizedInboundEvent[]}
     */
    parseWebhookEnvelope(payload) {
        throw new Error('not_implemented');
    }

    // ── Outbound transport ──────────────────────────────────────────────────────

    /**
     * Send a message to a recipient via the Send API.
     * A PolicyDecision MUST be provided and MUST have allow === true.
     * Honors decision.augment.message_tag for outside-24h sends.
     *
     * @param {object} params
     * @param {object} params.channel              - MetaChannel instance
     * @param {string} params.recipientId          - PSID / IGSID
     * @param {object} params.normalizedMessage    - NormalizedMessage (text + attachments)
     * @param {PolicyDecision} params.decision     - From policy engine
     * @returns {Promise<{ providerMessageId: string }>}
     */
    async sendMessage({ channel, recipientId, normalizedMessage, decision }) {
        throw new Error('not_implemented');
    }

    /**
     * Send a private reply to a public comment via Meta's Private Replies API.
     * This opens a DM thread attached to the comment.
     *
     * @param {object} params
     * @param {object} params.channel
     * @param {string} params.commentId
     * @param {object} params.normalizedMessage
     * @returns {Promise<{ providerMessageId: string }>}
     */
    async sendPrivateReplyToComment({ channel, commentId, normalizedMessage }) {
        throw new Error('not_implemented');
    }

    /**
     * Post a public reply to a comment on a Page post.
     *
     * @param {object} params
     * @param {object} params.channel
     * @param {string} params.commentId
     * @param {string} params.text
     * @returns {Promise<{ commentId: string }>}
     */
    async sendPublicCommentReply({ channel, commentId, text }) {
        throw new Error('not_implemented');
    }

    // ── Health ──────────────────────────────────────────────────────────────────

    /**
     * Check whether the channel is still accessible from the provider's side.
     * Makes a lightweight Graph API call and measures round-trip latency.
     *
     * @param {object} params
     * @param {object} params.channel - MetaChannel instance
     * @returns {Promise<{ ok: boolean, latencyMs: number }>}
     */
    async ping({ channel }) {
        throw new Error('not_implemented');
    }
}

module.exports = ChannelProvider;
