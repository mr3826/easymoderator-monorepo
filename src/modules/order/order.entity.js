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
        allowNull: true,
        references: {
            model: 'customers',
            key: 'id'
        },
        onDelete: 'SET NULL'
    },
    customer_name: {
        type: DataTypes.STRING,
        allowNull: true
        },
        customer_phone: {
            type: DataTypes.STRING,
            allowNull: true
        },
        delivery_address: {
            type: DataTypes.TEXT,
            allowNull: true
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
        type: DataTypes.ENUM('draft', 'confirmed', 'processing', 'completed', 'cancelled'),
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
    // Delivery tracking fields
    delivery_provider: {
        type: DataTypes.ENUM('pathao', 'steadfast'),
        allowNull: true
    },
    delivery_consignment_id: {
        type: DataTypes.STRING,
        allowNull: true
    },
    delivery_tracking_code: {
        type: DataTypes.STRING,
        allowNull: true
    },
    delivery_status: {
        type: DataTypes.STRING,
        allowNull: true
    },
    delivery_dispatched_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    delivery_delivered_at: {
        type: DataTypes.DATE,
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
