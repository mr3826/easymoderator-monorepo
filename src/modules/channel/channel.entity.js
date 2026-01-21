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
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    type: {
        type: DataTypes.ENUM('facebook', 'whatsapp', 'telegram', 'webchat'),
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('active', 'inactive', 'error'),
        defaultValue: 'inactive'
    },
    connected: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    config: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    last_sync: {
        type: DataTypes.DATE,
        allowNull: true
    },
    message_count: {
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
    }
}, {
    tableName: 'channels',
    underscored: true,
    timestamps: true,
    indexes: [
        {
            unique: true,
            fields: ['shop_id', 'type']
        }
    ]
});

module.exports = Channel;