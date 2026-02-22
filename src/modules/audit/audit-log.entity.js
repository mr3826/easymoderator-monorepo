const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');

const AuditLog = sequelize.define('AuditLog', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    // Nullable: system jobs (cron, queue workers) have no user context
    user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    // Nullable: system-wide jobs are not scoped to a single shop
    shop_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'shops',
            key: 'id'
        }
    },
    // Free-form string: covers both HTTP actions ('CREATE', 'UPDATE') and
    // job actions ('job:daily_overage_calculator', 'job:invoice_generator:error')
    action: {
        type: DataTypes.STRING(128),
        allowNull: false
    },
    // Free-form string: covers entity types ('USER', 'SHOP') and 'job'
    resource_type: {
        type: DataTypes.STRING(64),
        allowNull: false
    },
    // String (not UUID): job execution IDs are date-based strings, not UUIDs
    resource_id: {
        type: DataTypes.STRING,
        allowNull: false
    },
    old_values: {
        type: DataTypes.JSON,
        allowNull: true
    },
    new_values: {
        type: DataTypes.JSON,
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSON,
        allowNull: true
    },
    // STRING instead of INET: INET is PostgreSQL-specific; SQLite uses TEXT
    ip_address: {
        type: DataTypes.STRING(45),
        allowNull: true
    },
    user_agent: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    idempotency_key: {
        type: DataTypes.STRING,
        allowNull: true,
        index: true
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'audit_logs',
    underscored: true,
    timestamps: false,
    indexes: [
        {
            fields: ['user_id', 'created_at']
        },
        {
            fields: ['shop_id', 'created_at']
        },
        {
            fields: ['resource_type', 'resource_id']
        },
        // Composite index for the most common audit query: shop + type + time window
        {
            fields: ['shop_id', 'resource_type', 'created_at']
        },
        {
            fields: ['idempotency_key']
        }
    ]
});

module.exports = AuditLog;
