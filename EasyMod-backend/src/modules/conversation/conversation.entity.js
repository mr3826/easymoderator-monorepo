const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

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
        allowNull: true
    },
    channel: {
        type: DataTypes.STRING(20),
        allowNull: false
    },
    // Phase 2: explicit FK to the specific Meta page/IG account this conversation
    // belongs to. Nullable for backward-compat with rows created before Phase 2
    // (those get backfilled by migration 013 when unambiguous, else lazily filled
    // by app code on next inbound message).
    meta_channel_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'meta_channels', key: 'id' },
        onDelete: 'SET NULL'
    },
    title: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'active'
    },
    role: {
        type: DataTypes.ENUM('user', 'assistant', 'system'),
        allowNull: false
    },
    message: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    intent: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    confidence: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    llm_used: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    cache_hit: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    keyword_match: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    hitl: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: 'Human-in-the-loop: true = agent handling, AI auto-replies paused'
    },
    assignee_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Shop team member assigned to this conversation'
    },
    resolution_note: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    resolved_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSON,
        defaultValue: {}
    }
}, {
    tableName: 'conversations',
    underscored: true,
    timestamps: true,
    indexes: [
        {
            // Inbox list query: filter by shop + channel + status
            fields: ['shop_id', 'channel', 'status']
        },
        {
            // 24h window lookup on every inbound webhook: most recent conv for a customer
            fields: ['shop_id', 'customer_id', 'channel', 'created_at']
        },
        {
            // Phase 2: per-channel inbox filtering and routing
            fields: ['meta_channel_id']
        }
    ]
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
    message_tag: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: 'Meta message tag for out-of-24h-window messages'
    },
    metadata: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {}
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
}, {
    tableName: 'messages',
    underscored: true,
    timestamps: true,
    updatedAt: false,
    indexes: [
        {
            // Message list for a conversation (most common query)
            fields: ['conversation_id', 'created_at']
        },
        {
            // Idempotency: fast lookup by external platform message ID
            unique: true,
            fields: ['external_id'],
            where: { external_id: { [require('sequelize').Op.ne]: null } }
        }
    ]
});

module.exports = {
    Conversation,
    Message
};
