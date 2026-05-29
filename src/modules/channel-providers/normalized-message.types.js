/**
 * normalized-message.types.js
 *
 * JSDoc typedefs for the NormalizedMessage protocol used across all channel
 * providers in EasyModerator's backend.
 *
 * These types mirror the TypeScript definitions in
 *   EasyMod-frontend/src/api/types/messaging.ts
 *
 * Backend is pure JavaScript — TypeScript is NOT used here.
 * All types are @typedef blocks for IDE support and documentation only.
 */

'use strict';

// This file exports nothing at runtime. It exists solely for JSDoc typedefs
// that are referenced by other modules via @type {import('./normalized-message.types').NormalizedMessage}

/**
 * The platform a message originated from or is being sent to.
 * WhatsApp is excluded (removed from product scope, Phase 1).
 * @typedef {'facebook' | 'instagram'} MessagePlatform
 */

/**
 * @typedef {'inbound' | 'outbound'} MessageDirection
 */

/**
 * @typedef {'customer' | 'ai' | 'agent' | 'system'} MessageSenderRole
 */

/**
 * A file or media attachment on a normalized message.
 * @typedef {Object} NormalizedAttachment
 * @property {'image'|'video'|'audio'|'file'|'sticker'|'location'|'template'} type
 * @property {string} [url]
 * @property {string} [mimeType]
 * @property {string} [filename]
 * @property {Object} [payload] - Provider-specific payload (e.g. template buttons)
 */

/**
 * Delivery status for an outbound message.
 * @typedef {Object} NormalizedDelivery
 * @property {'queued'|'sent'|'delivered'|'read'|'failed'} status
 * @property {string} [providerMessageId] - Message ID returned by Meta Graph API
 * @property {string} [error]
 * @property {string} [sentAt]      - ISO 8601
 * @property {string} [deliveredAt] - ISO 8601
 * @property {string} [readAt]      - ISO 8601
 */

/**
 * AI metadata attached to a message (populated by the AI pipeline).
 * @typedef {Object} NormalizedAiMeta
 * @property {string}  [intent]
 * @property {number}  [confidence]    - 0.0 to 1.0
 * @property {string}  [suggestedReply]
 * @property {boolean} [cacheHit]      - true if reply came from RAG cache
 */

/**
 * Policy decision metadata attached to a message.
 * Populated after evaluateOutbound() is called (Phase 3+).
 * @typedef {Object} NormalizedPolicyMeta
 * @property {string}  [decisionId]   - UUID of the policy_decisions row
 * @property {boolean} allowed
 * @property {string}  [reason]       - e.g. 'OK', 'OPTED_OUT', 'OUTSIDE_24H'
 * @property {string}  [messageTag]   - e.g. 'POST_PURCHASE_UPDATE' if injected
 * @property {boolean} withinWindow   - true if within 24-hour messaging window
 */

/**
 * Thread context for comment-to-DM flows (Phase 4+).
 * @typedef {Object} NormalizedThreadContext
 * @property {boolean} [isCommentToDm]
 * @property {string}  [commentId]
 * @property {string}  [postId]
 * @property {boolean} [privateReplyEligible]
 */

/**
 * The canonical message envelope shared between all channel providers,
 * the AI pipeline, the policy engine, the database layer, and the frontend.
 *
 * This is the single contract for all message-related data in EasyModerator.
 * All provider-specific formats (Messenger webhook payload, IG webhook payload)
 * are normalized into this shape before any processing.
 *
 * @typedef {Object} NormalizedMessage
 *
 * --- Identity ---
 * @property {string}      id                  - Internal UUID (messages.id)
 * @property {string|null} externalId          - Meta message_id (may be null for outbound before send)
 * @property {string}      conversationId      - Internal conversation UUID
 * @property {string}      shopId              - Tenant shop UUID (multi-tenant isolation)
 * @property {string}      channelId           - meta_channels.id
 * @property {MessagePlatform} platform
 *
 * --- Routing ---
 * @property {MessageDirection}   direction
 * @property {MessageSenderRole}  senderRole
 * @property {string}             customerId          - Internal customer UUID
 * @property {string}             customerExternalId  - PSID (Facebook) or IGSID (Instagram)
 * @property {string}             pageOrAccountId     - meta_channels.meta_asset_id
 *
 * --- Content ---
 * @property {string|null}           text
 * @property {NormalizedAttachment[]} attachments
 * @property {'bn'|'en'|'banglish'|null} [language]
 *
 * --- Threading / context ---
 * @property {string|null}            [inReplyToExternalId]
 * @property {NormalizedThreadContext} [threadContext]
 *
 * --- AI / policy metadata ---
 * @property {NormalizedAiMeta}     [ai]
 * @property {NormalizedPolicyMeta} [policy]
 *
 * --- Delivery (outbound only) ---
 * @property {NormalizedDelivery} [delivery]
 *
 * --- Echo filtering ---
 * @property {boolean} [isEcho] - true if this is a page-sent echo from Meta webhook
 *
 * --- Timestamps (ISO 8601 strings) ---
 * @property {string} occurredAt  - When the event occurred (provider timestamp)
 * @property {string} receivedAt  - When EasyModerator received the webhook
 * @property {string} createdAt   - When the DB row was created
 */

// No runtime exports — this file is JSDoc-only.
// Other modules reference it via: @type {import('./normalized-message.types').NormalizedMessage}
module.exports = {};
