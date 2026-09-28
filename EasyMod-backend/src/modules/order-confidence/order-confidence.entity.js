'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

/**
 * RTO Shield v2 decision state for one order (UNIQUE order_id).
 *
 * Every write is a compare-and-set on `version` (ADR-0010). A merchant
 * resolution is bound to `resolution_fingerprint`; when the order's material
 * facts change the fingerprint changes and the resolution no longer applies.
 * `reasons` evidence never contains phone, address or name.
 */
const OrderConfidence = sequelize.define('OrderConfidence', {
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
    order_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'orders', key: 'id' },
        onDelete: 'CASCADE',
    },
    customer_id: { type: DataTypes.UUID, allowNull: true },
    decision: { type: DataTypes.STRING(20), allowNull: false },
    reasons: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    rules_version: { type: DataTypes.STRING(40), allowNull: false },
    input_fingerprint: { type: DataTypes.STRING(64), allowNull: false },
    evaluated_at: { type: DataTypes.DATE, allowNull: false },
    mode: { type: DataTypes.STRING(10), allowNull: false },
    resolution: { type: DataTypes.STRING(20), allowNull: true },
    resolution_level: { type: DataTypes.STRING(20), allowNull: true },
    resolution_fingerprint: { type: DataTypes.STRING(64), allowNull: true },
    resolution_method: { type: DataTypes.STRING(30), allowNull: true },
    resolution_note: { type: DataTypes.STRING(500), allowNull: true },
    resolved_by: { type: DataTypes.UUID, allowNull: true },
    resolved_at: { type: DataTypes.DATE, allowNull: true },
    last_gate_result: { type: DataTypes.STRING(30), allowNull: true },
    last_gate_at: { type: DataTypes.DATE, allowNull: true },
    held_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    released_decision: { type: DataTypes.JSONB, allowNull: true },
    released_at: { type: DataTypes.DATE, allowNull: true },
    outcome: { type: DataTypes.STRING(30), allowNull: true },
    outcome_at: { type: DataTypes.DATE, allowNull: true },
    history: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
}, {
    tableName: 'order_confidence',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        { unique: true, fields: ['order_id'], name: 'idx_order_confidence_order' },
        { fields: ['shop_id', 'decision'], name: 'idx_order_confidence_shop_decision' },
    ],
});

module.exports = OrderConfidence;
