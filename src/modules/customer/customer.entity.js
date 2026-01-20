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
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    email: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            isEmail: true
        }
    },
    number: {
        type: DataTypes.STRING,
        allowNull: false
    },
    channel: {
        type: DataTypes.ENUM('facebook', 'whatsapp', 'telegram', 'webchat', 'manual'),
        allowNull: false
    }
}, {
    tableName: 'customers',
    underscored: true,
    timestamps: true
});

module.exports = Customer;
