/**
 * MetaChannelConsentEvent entity
 *
 * Append-only audit log for consent changes (opt-in, opt-out, deauth, data deletion).
 * One row per consent event per customer per channel. Never updated or deleted.
 *
 * Satisfies: GDPR Art. 7(1) record-keeping, Meta Platform Policy user consent audit.
 */

'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const MetaChannelConsentEvent = sequelize.define('MetaChannelConsentEvent', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: 'Denormalized for efficient tenant-scoped queries without JOIN',
    },
    channel_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'meta_channels', key: 'id' },
        onDelete: 'CASCADE',
    },
    customer_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'customers', key: 'id' },
        onDelete: 'SET NULL',
        comment: 'Null if customer was deleted before the event was created',
    },
    event: {
        type: DataTypes.ENUM(
            'OPT_IN_IMPLICIT',   // user sent a message (implicit Messenger consent)
            'OPT_IN_EXPLICIT',   // user actively opted in via button/keyword
            'OPT_OUT',           // user sent STOP keyword or similar
            'DEAUTHORIZED',      // Meta deauth webhook received
            'DATA_DELETED'       // Meta data-deletion callback received
        ),
        allowNull: false,
    },
    source: {
        type: DataTypes.ENUM(
            'webhook_messaging_optins',  // Meta messaging_optins webhook event
            'message',                   // Inbound message (implicit opt-in)
            'keyword_stop',              // STOP/বন্ধ keyword detection
            'admin',                     // Manual action by shop admin
            'meta_callback'              // Deauth or data-deletion webhook from Meta
        ),
        allowNull: false,
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: null,
        comment: 'Arbitrary context: {message_id, comment_id, keyword_matched, etc.}',
    },
    // No updated_at — this is append-only.
}, {
    tableName: 'meta_channel_consent_events',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,   // append-only: no updates ever
    indexes: [
        { fields: ['shop_id', 'customer_id'], name: 'idx_consent_shop_customer' },
        { fields: ['channel_id'], name: 'idx_consent_channel' },
        { fields: ['customer_id', 'event'], name: 'idx_consent_customer_event' },
    ],
});

module.exports = MetaChannelConsentEvent;
