'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const ConversationTurn = sequelize.define('ConversationTurn', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    turn_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
    },
    trace_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'shops', key: 'id' },
        onDelete: 'CASCADE',
    },
    conversation_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'conversations', key: 'id' },
        onDelete: 'CASCADE',
    },
    intent_id: {
        type: DataTypes.STRING(80),
        allowNull: true,
    },
    state: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'RECEIVED',
    },
    retry_state: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'NOT_STARTED',
    },
    recovery_kind: {
        type: DataTypes.STRING(50),
        allowNull: true,
    },
    state_transitions: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
    },
    turn_started_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
    },
    first_holding_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    hard_timeout_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    handoff_created_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    handoff_ack_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    retry_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    idempotency_key: {
        type: DataTypes.STRING(64),
        allowNull: true,
    },
    mutation_status: {
        type: DataTypes.STRING(50),
        allowNull: true,
    },
    outbound_status: {
        type: DataTypes.STRING(50),
        allowNull: true,
    },
    provider_reference: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    recovery_reason: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    final_state: {
        type: DataTypes.STRING(50),
        allowNull: true,
    },
}, {
    tableName: 'conversation_turns',
    underscored: true,
    timestamps: true,
    indexes: [
        {
            unique: true,
            fields: ['conversation_id', 'turn_id'],
            name: 'idx_conversation_turns_conversation_turn',
        },
        { fields: ['shop_id', 'created_at'], name: 'idx_conversation_turns_shop_created' },
    ],
});

module.exports = ConversationTurn;
