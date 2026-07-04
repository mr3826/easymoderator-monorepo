const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const TelegramNotificationBinding = sequelize.define('TelegramNotificationBinding', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'shops', key: 'id' },
        onDelete: 'CASCADE'
    },
    telegram_chat_id: {
        type: DataTypes.STRING(64),
        allowNull: true
    },
    chat_title: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    chat_type: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'disconnected'
    },
    enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    preferences: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    },
    connect_token_hash: {
        type: DataTypes.STRING(128),
        allowNull: true
    },
    connection_expires_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    last_error: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    last_tested_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    last_sent_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    connected_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    disconnected_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'telegram_notification_bindings',
    underscored: true,
    timestamps: true,
    indexes: [
        { unique: true, fields: ['shop_id'] },
        { unique: true, fields: ['telegram_chat_id'] },
        { fields: ['status'] },
        { fields: ['connect_token_hash'] }
    ]
});

module.exports = TelegramNotificationBinding;
