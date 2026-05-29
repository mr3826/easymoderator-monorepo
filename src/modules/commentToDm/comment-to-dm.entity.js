'use strict';

/**
 * CommentToDmEvent entity
 *
 * Tracks one Facebook/Instagram comment from receipt through the full
 * Comment-to-DM lifecycle:
 *   COMMENT_RECEIVED → MATCHED → ... → AUTOMATION_UNLOCKED (or EXPIRED/FAILED)
 *
 * Idempotency: comment_id is UNIQUE at DB level. Service upserts silently
 * no-op on duplicate webhook deliveries.
 *
 * Associations defined in entities.js (Phase 4 additions).
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const STATES = [
    'COMMENT_RECEIVED',
    'MATCHED',
    'BLOCKED',
    'PUBLIC_REPLY_QUEUED',
    'PUBLIC_REPLIED',
    'DM_INVITE_SENT',
    'CUSTOMER_OPENED_DM',
    'AUTOMATION_UNLOCKED',
    'EXPIRED',
    'FAILED',
];

const CommentToDmEvent = sequelize.define('CommentToDmEvent', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },

    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'shops', key: 'id' },
        onDelete: 'CASCADE',
    },

    channel_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'meta_channels', key: 'id' },
        onDelete: 'CASCADE',
    },

    platform: {
        type: DataTypes.ENUM('facebook', 'instagram'),
        allowNull: false,
    },

    // Comment identity
    post_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
    },
    comment_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
    },
    parent_comment_id: {
        type: DataTypes.STRING(64),
        allowNull: true,
    },

    // Commenter identity
    commenter_external_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: 'Facebook ASID or Instagram IGSID',
    },
    commenter_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    comment_text: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    matched_keyword: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },

    // State machine
    state: {
        type: DataTypes.ENUM(...STATES),
        allowNull: false,
        defaultValue: 'COMMENT_RECEIVED',
    },

    // Linkage — set after DM opens
    customer_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'customers', key: 'id' },
        onDelete: 'SET NULL',
    },
    conversation_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'conversations', key: 'id' },
        onDelete: 'SET NULL',
    },

    // Audit
    last_transition_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
    },
    last_error: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
    },
}, {
    tableName: 'comment_to_dm_events',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        { fields: ['shop_id', 'state'] },
        { fields: ['state', 'last_transition_at'] },
        { fields: ['channel_id', 'post_id'] },
    ],
});

CommentToDmEvent.STATES = STATES;

module.exports = CommentToDmEvent;
