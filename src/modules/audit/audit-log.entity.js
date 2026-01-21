const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');

const AuditLog = sequelize.define('AuditLog', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'shops',
            key: 'id'
        }
    },
    action: {
        type: DataTypes.ENUM(
            'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT',
            'CHANNEL_CONNECT', 'CHANNEL_DISCONNECT', 'ORDER_CONFIRM',
            'ORDER_CANCEL', 'PAYMENT_PROCESS', 'EXPORT_DATA', 'DASHBOARD_ACCESS'
        ),
        allowNull: false
    },
    resource_type: {
        type: DataTypes.ENUM(
            'USER', 'SHOP', 'CHANNEL', 'CUSTOMER', 'PRODUCT',
            'ORDER', 'CATEGORY', 'CONVERSATION', 'MESSAGE', 'PAYMENT', 'DASHBOARD'
        ),
        allowNull: false
    },
    resource_id: {
        type: DataTypes.UUID,
        allowNull: false
    },
    old_values: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    new_values: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    ip_address: {
        type: DataTypes.INET,
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
        {
            fields: ['idempotency_key'],
            unique: true,
            where: {
                idempotency_key: {
                    [require('sequelize').Op.ne]: null
                }
            }
        }
    ]
});

module.exports = AuditLog;