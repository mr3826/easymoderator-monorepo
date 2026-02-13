const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');

const Channel = sequelize.define('Channel', {
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
    channel_type: {
        type: DataTypes.ENUM('messenger', 'whatsapp', 'instagram', 'webchat', 'telegram'),
        allowNull: false
    },
    page_id: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    access_token: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    verify_token: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    webhook_secret: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    settings: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: {}
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'channel_configs',
    underscored: true,
    timestamps: true,
    indexes: [
        {
            unique: true,
            fields: ['shop_id', 'channel_type']
        }
    ]
});

module.exports = Channel;