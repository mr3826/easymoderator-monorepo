'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

/**
 * Customer Interactions (Pilot+ P+02) — server-authoritative structured
 * choice proposals. Rows carry ONLY ids, registry option references and
 * statuses: never free customer text, never payment/stock facts.
 * See docs/pilot-plus-v1/03 §4.
 */
const CustomerInteraction = sequelize.define('CustomerInteraction', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    shop_id: { type: DataTypes.UUID, allowNull: false },
    customer_id: { type: DataTypes.UUID, allowNull: true },
    // Channel-scoped identity — mirrors order_sessions' PSID discipline.
    // Messenger and storefront identities are NEVER merged (spec §5.3).
    customer_channel_id: { type: DataTypes.STRING(255), allowNull: false },
    meta_channel_id: { type: DataTypes.UUID, allowNull: true },
    conversation_id: { type: DataTypes.UUID, allowNull: true },
    kind: { type: DataTypes.STRING(40), allowNull: false },
    bound_entity_type: { type: DataTypes.STRING(30), allowNull: true },
    bound_entity_id: { type: DataTypes.STRING(64), allowNull: true },
    bound_context_version: { type: DataTypes.STRING(128), allowNull: true },
    allowed_operation_ids: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    options: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    language: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'bn' },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'GENERATED' },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    resolution: { type: DataTypes.JSONB, allowNull: true },
    created_by: { type: DataTypes.STRING(40), allowNull: false },
}, {
    tableName: 'customer_interactions',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
});

module.exports = CustomerInteraction;
