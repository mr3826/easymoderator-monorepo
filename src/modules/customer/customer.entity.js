const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');

const Customer = sequelize.define('Customer', {
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
    phone: {
        type: DataTypes.STRING,
        allowNull: false
    },
    email: {
        type: DataTypes.STRING,
        allowNull: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: true
    },
    channel_type: {
        type: DataTypes.ENUM('messenger', 'whatsapp', 'instagram', 'webchat', 'manual', 'facebook', 'telegram'),
        allowNull: false
    },
    channel_user_id: {
        type: DataTypes.STRING,
        allowNull: false
    },
    language_preference: {
        type: DataTypes.ENUM('bangla', 'english', 'banglish'),
        allowNull: true
    },
    last_active: {
        type: DataTypes.DATE,
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSONB,
        defaultValue: {}
    }
}, {
    tableName: 'customers',
    underscored: true,
    timestamps: true,
    getterMethods: {
        number() { return this.getDataValue('phone'); },
        channel() { return this.getDataValue('channel_type'); }
    }
});

module.exports = Customer;
