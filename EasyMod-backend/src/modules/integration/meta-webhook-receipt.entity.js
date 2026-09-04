'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

/**
 * Durable receipt for one inbound Meta webhook event.
 *
 * Written BEFORE the webhook is acknowledged, so an event can never be lost
 * because the Page was unmapped, the channel was disconnected, or the message
 * INSERT failed. Meta only retries a non-2xx response; once we return 200 the
 * event exists nowhere else, and this row is the only durable evidence.
 *
 * Privacy: the sender PSID is stored as a salted-free SHA-256 reference, never
 * in the clear. The replay body is AES-256-GCM encrypted (see
 * utils/webhook-payload-cipher). Both are purged by the retention sweep.
 */
const MetaWebhookReceipt = sequelize.define('MetaWebhookReceipt', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    provider: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'meta',
    },
    object_type: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'page',
    },
    page_id: {
        type: DataTypes.STRING(128),
        allowNull: false,
    },
    event_id: {
        type: DataTypes.STRING(191),
        allowNull: true,
        comment: 'Meta message mid when present; null for events that carry none',
    },
    dedupe_key: {
        type: DataTypes.STRING(191),
        allowNull: false,
        unique: true,
        comment: 'event_id when present, else sha256(page_id|payload_hash)',
    },
    event_type: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'unknown',
    },
    sender_ref: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: 'SHA-256 of the sender PSID — never the raw PSID',
    },
    payload_hash: {
        type: DataTypes.STRING(64),
        allowNull: false,
    },
    payload_encrypted: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'AES-256-GCM replay body; cleared once the receipt is terminal',
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Set only once the Page resolves to a CONNECTED channel',
    },
    meta_channel_id: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    status: {
        type: DataTypes.ENUM(
            'RECEIVED',
            'PROCESSING',
            'QUEUED',
            'PROCESSED',
            'SKIPPED',
            'IDENTITY_NOT_RESOLVED',
            'MESSAGE_STORE_FAILED',
            'RETRY_PENDING',
            'DEAD_LETTERED',
        ),
        allowNull: false,
        defaultValue: 'RECEIVED',
    },
    retry_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    last_error_code: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: 'Sanitized operational code — never a message body or secret',
    },
    next_retry_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    processing_token: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: 'Optimistic-concurrency fence for the reconciler',
    },
    received_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
    },
    processed_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
}, {
    tableName: 'meta_webhook_receipts',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        { fields: ['status', 'next_retry_at'], name: 'idx_meta_webhook_receipts_status_retry' },
        { fields: ['page_id', 'received_at'], name: 'idx_meta_webhook_receipts_page_received' },
        { fields: ['shop_id'], name: 'idx_meta_webhook_receipts_shop' },
    ],
});

module.exports = MetaWebhookReceipt;
