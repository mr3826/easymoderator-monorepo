/**
 * PolicyDecision entity
 *
 * Append-only audit log. Every call to `policy.engine.evaluateOutbound()` writes
 * exactly one row, regardless of allow/deny. The raw message body is never stored
 * — only a sha256 hash for forensic linkage.
 *
 * Insert-only by convention. There is no service method to update or delete rows
 * outside the migration system.
 */

'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const PolicyDecision = sequelize.define('PolicyDecision', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    shop_id:         { type: DataTypes.UUID, allowNull: false },
    channel_id:      { type: DataTypes.UUID, allowNull: true },
    conversation_id: { type: DataTypes.UUID, allowNull: true },
    customer_id:     { type: DataTypes.UUID, allowNull: true },
    platform:        { type: DataTypes.STRING(32), allowNull: false },
    direction:       { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'outbound' },
    allow:           { type: DataTypes.BOOLEAN, allowNull: false },
    reason:          { type: DataTypes.STRING(64), allowNull: false },
    rule_results:    { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    transform_applied: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    augment:         { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    policy_version:  { type: DataTypes.STRING(32), allowNull: false },
    message_hash:    { type: DataTypes.STRING(64), allowNull: true },
}, {
    tableName: 'policy_decisions',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    indexes: [
        { fields: ['shop_id', 'created_at'] },
        { fields: ['reason'] },
    ],
});

module.exports = PolicyDecision;
