/**
 * MetaChannelSettings entity
 *
 * 1:1 with MetaChannel. Replaces the JSON blob in channel_configs.settings.
 * Stores per-channel AI, automation, and Comment-to-DM configuration.
 */

'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const MetaChannelSettings = sequelize.define('MetaChannelSettings', {
    channel_id: {
        type: DataTypes.UUID,
        primaryKey: true,
        references: { model: 'meta_channels', key: 'id' },
        onDelete: 'CASCADE',
    },

    // ----- AI / automation mode -----
    ai_auto_reply: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
    },
    automation_mode: {
        type: DataTypes.ENUM('AI_ACTIVE', 'AI_SUGGEST_ONLY', 'HUMAN_ACTIVE', 'MANUAL', 'DRAFT'),
        allowNull: false,
        defaultValue: 'AI_ACTIVE',
    },
    confidence_threshold_send: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: false,
        defaultValue: 0.75,
        comment: 'AI confidence >= this value triggers automatic send',
    },
    confidence_threshold_suggest: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: false,
        defaultValue: 0.50,
        comment: 'AI confidence >= this value shows suggestion to human agent',
    },

    // ----- Business hours -----
    business_hours: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: null,
        comment: 'Null = always active. Shape: { mon: [{open:"09:00",close:"18:00"}], ... }',
    },

    // ----- Commerce -----
    allow_order_creation: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
    },

    // ----- Comment-to-DM -----
    comment_to_dm_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
    comment_to_dm_post_filter: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        comment: 'Array of post IDs to restrict comment-to-DM to. Empty = all posts.',
    },
    comment_to_dm_keywords: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        comment: 'Keywords that trigger the comment-to-DM flow. Empty = any comment.',
    },
}, {
    tableName: 'meta_channel_settings',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
});

module.exports = MetaChannelSettings;
