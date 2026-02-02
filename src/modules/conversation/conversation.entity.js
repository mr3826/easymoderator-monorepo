const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');

const Conversation = sequelize.define('Conversation', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'shops',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    customer_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'customers',
            key: 'id'
        },
        onDelete: 'SET NULL'
    },
    customer_name: {
        type: DataTypes.STRING,
        allowNull: true
    },
    channel: {
        type: DataTypes.ENUM('facebook', 'whatsapp', 'instagram', 'telegram', 'webchat', 'manual'),
        allowNull: false
    },
    external_id: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'External platform conversation ID'
    },
    status: {
        type: DataTypes.ENUM('new', 'replied', 'closed'),
        defaultValue: 'new'
    },
    last_message: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    last_message_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    unread_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
}, {
    tableName: 'conversations',
    underscored: true,
    timestamps: true
});

const Message = sequelize.define('Message', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    conversation_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'conversations',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    content: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    sender: {
        type: DataTypes.ENUM('customer', 'ai', 'business'),
        allowNull: false
    },
    external_id: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'External platform message ID'
    },
    ai_suggestion: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    ai_confidence: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: true
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
}, {
    tableName: 'messages',
    underscored: true,
    timestamps: true,
    updatedAt: false
});

module.exports = {
    Conversation,
    Message
};