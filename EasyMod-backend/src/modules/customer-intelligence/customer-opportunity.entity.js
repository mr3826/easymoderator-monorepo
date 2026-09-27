'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

/**
 * A purchase-intent conversation that did not (yet) produce an order.
 *
 * Invariant: at most one live (OPEN | ACTIONED) row per (shop, customer),
 * enforced by the partial unique index idx_customer_opportunities_live.
 * `signals` holds message IDs and intent IDs only — never raw message text.
 */
const CustomerOpportunity = sequelize.define('CustomerOpportunity', {
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
    customer_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'customers', key: 'id' },
        onDelete: 'CASCADE',
    },
    conversation_id: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    order_session_id: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'OPEN',
    },
    strength: {
        type: DataTypes.STRING(10),
        allowNull: false,
    },
    reasons: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
    },
    signals: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
    },
    product_refs: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
    },
    first_signal_at: {
        type: DataTypes.DATE,
        allowNull: false,
    },
    last_signal_at: {
        type: DataTypes.DATE,
        allowNull: false,
    },
    detected_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
    },
    detector_version: {
        type: DataTypes.STRING(40),
        allowNull: false,
    },
    actioned_at: { type: DataTypes.DATE, allowNull: true },
    actioned_by: { type: DataTypes.UUID, allowNull: true },
    converted_order_id: { type: DataTypes.UUID, allowNull: true },
    resolved_at: { type: DataTypes.DATE, allowNull: true },
    resolved_by: { type: DataTypes.UUID, allowNull: true },
    resolution_reason: { type: DataTypes.STRING(40), allowNull: true },
}, {
    tableName: 'customer_opportunities',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
});

module.exports = CustomerOpportunity;
