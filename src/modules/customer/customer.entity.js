const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

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
    phone: {
        type: DataTypes.STRING,
        allowNull: true
    },
    email: {
        type: DataTypes.STRING,
        allowNull: true
    },
    last_active: {
        type: DataTypes.DATE,
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSON,
        defaultValue: {}
    }
}, {
    tableName: 'customers',
    underscored: true,
    timestamps: true,
    scopes: {
        shopScoped(shopId) {
            return { where: { shop_id: shopId } };
        }
    },
    indexes: [
        {
            unique: true,
            fields: ['shop_id', 'phone']
        },
        {
            unique: true,
            fields: ['shop_id', 'email']
        }
    ],
    hooks: {
        beforeDestroy: (customer, options) => {
            customer.phone = null;
            customer.email = null;
            customer.name = null;
        }
    }
});
// ...existing code...

module.exports = Customer;
