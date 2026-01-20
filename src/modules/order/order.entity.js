const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');

const Order = sequelize.define('Order', {
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
        allowNull: false,
        references: {
            model: 'customers',
            key: 'id'
        },
        onDelete: 'RESTRICT'
    },
    order_number: {
        type: DataTypes.STRING,
        allowNull: false
    },
    channel: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'manual'
    },
    order_status: {
        type: DataTypes.ENUM('draft', 'confirmed', 'finalized', 'cancelled'),
        defaultValue: 'draft'
    },
    payment_status: {
        type: DataTypes.ENUM('pending', 'paid', 'unpaid', 'refunded', 'partially_paid'),
        defaultValue: 'pending'
    },
    fulfillment_status: {
        type: DataTypes.ENUM('unfulfilled', 'fulfilled', 'cancelled', 'partially_fulfilled'),
        defaultValue: 'unfulfilled'
    },
    subtotal: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0.00
    },
    discount: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0.00
    },
    tax: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0.00
    },
    delivery_fee: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0.00
    },
    total: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0.00
    },
    note: {
        type: DataTypes.TEXT,
        allowNull: true
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
    tableName: 'orders',
    underscored: true,
    timestamps: true,
    indexes: [
        {
            unique: true,
            fields: ['shop_id', 'order_number']
        }
    ]
});

module.exports = Order;
