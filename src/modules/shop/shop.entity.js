const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const Shop = sequelize.define('Shop', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    unique_code: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true
    },
    tenant_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'tenants',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    shop_name: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    name: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    timezone: {
        type: DataTypes.STRING(50),
        defaultValue: 'Asia/Dhaka'
    },
    business_hours: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {
            start: '09:00',
            end: '22:00',
            days: [0, 1, 2, 3, 4, 5, 6]
        }
    },
    settings: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {}
    }
    ,
    config_version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
    },
    workflow_webhook_url: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Per-tenant Make.com or n8n webhook URL for automation forwarding'
    },
    workflow_webhook_secret: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Secret sent as X-Internal-Webhook-Secret header when forwarding to workflow'
    }
}, {
    tableName: 'shops',
    underscored: true,
    timestamps: true
});

module.exports = Shop;
