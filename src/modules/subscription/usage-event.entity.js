const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');

/**
 * UsageEvent Entity
 * 
 * Tracks every usage increment with transactional guarantees.
 * Ensures idempotency via (shop_id, resource_type, request_id) unique constraint.
 * 
 * Used for:
 * - Idempotent duplicate detection (same request_id = same increment)
 * - Transaction rollback verification (status field)
 * - Audit trail for billing disputes
 * - Concurrent usage tracking validation
 */
const UsageEvent = sequelize.define('UsageEvent', {
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
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    },
    resource_type: {
        type: DataTypes.ENUM('conversations', 'orders', 'products'),
        allowNull: false
    },
    request_id: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: 'Idempotency key - identifies the original request'
    },
    delta: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment: 'Amount of usage to increment (typically 1)'
    },
    // Transaction lifecycle tracking
    transaction_id: {
        type: DataTypes.STRING(36),
        allowNull: true,
        comment: 'Sequelize transaction ID for rollback detection'
    },
    status: {
        type: DataTypes.ENUM('pending', 'committed', 'rolled_back'),
        allowNull: false,
        defaultValue: 'pending'
    },
    // Metadata for audit trail
    resource_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'ID of the resource created (e.g., conversation_id, order_id)'
    },
    resource_metadata: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'Additional context (e.g., {conversation_id, channel, customer_id})'
    },
    // Error tracking
    error_message: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Error message if transaction failed'
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    committed_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Timestamp when transaction was committed'
    }
}, {
    tableName: 'usage_events',
    timestamps: false,
    underscored: true,
    indexes: [
        // Composite unique constraint for idempotency
        {
            unique: true,
            fields: ['shop_id', 'resource_type', 'request_id'],
            name: 'idx_usage_idempotency_key'
        },
        // For querying by shop
        {
            fields: ['shop_id']
        },
        // For querying by resource type
        {
            fields: ['resource_type']
        },
        // For status queries (e.g., finding pending/rolled_back)
        {
            fields: ['status']
        },
        // For transaction analysis
        {
            fields: ['transaction_id']
        },
        // For audit queries
        {
            fields: ['shop_id', 'created_at']
        }
    ]
});

module.exports = UsageEvent;
