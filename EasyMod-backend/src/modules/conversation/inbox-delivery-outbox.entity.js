'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

/**
 * Durable handoff for merchant-approved outbound Inbox messages. The message
 * row remains the lifecycle source of truth; this table guarantees that a
 * process crash between approval commit and provider delivery leaves work that
 * can be recovered without approving the draft a second time.
 */
const InboxDeliveryOutbox = sequelize.define('InboxDeliveryOutbox', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    conversation_id: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    message_id: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    delivery_source: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'DRAFT_APPROVAL',
    },
    status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'PENDING',
    },
    attempt_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    next_attempt_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: DataTypes.NOW,
    },
    processing_token: {
        type: DataTypes.STRING(64),
        allowNull: true,
    },
    provider_message_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    last_error_code: {
        type: DataTypes.STRING(64),
        allowNull: true,
    },
}, {
    tableName: 'inbox_delivery_outbox',
    underscored: true,
    timestamps: true,
    indexes: [
        { unique: true, fields: ['message_id'], name: 'idx_inbox_delivery_outbox_message' },
        { fields: ['status', 'next_attempt_at'], name: 'idx_inbox_delivery_outbox_due' },
        { fields: ['shop_id', 'status'], name: 'idx_inbox_delivery_outbox_shop_status' },
    ],
});

module.exports = InboxDeliveryOutbox;
