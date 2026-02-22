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
        allowNull: true
    },
    customer_name: {
        type: DataTypes.STRING,
        allowNull: true
    },
    customer_phone: {
        type: DataTypes.STRING,
        allowNull: true
    },
    order_number: {
        type: DataTypes.STRING,
        allowNull: true
    },
    channel: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 'manual'
    },
    items: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: []
    },
    order_status: {
        type: DataTypes.STRING,
        defaultValue: 'draft'
    },
    payment_status: {
        type: DataTypes.STRING,
        defaultValue: 'pending'
    },
    fulfillment_status: {
        type: DataTypes.STRING,
        defaultValue: 'unfulfilled'
    },
    subtotal: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0
    },
    discount: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0
    },
    tax: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0
    },
    delivery_fee: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0
    },
    delivery_location: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    delivery_address: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    delivery_zone: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    delivery_provider: {
        type: DataTypes.STRING,
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
    total: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0
    },
    payment_method: {
        type: DataTypes.STRING(30),
        allowNull: true
    },
    note: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    tableName: 'orders',
    underscored: true,
    timestamps: true,
    // P2-1: Multi-tenant — enforce shop_id via scope or where in all queries
    scopes: {
        shopScoped(shopId) {
            return { where: { shop_id: shopId } };
        }
    },
    indexes: [
        { fields: ['shop_id'] },
        { fields: ['shop_id', 'order_status'] },
        { fields: ['shop_id', 'created_at'] },
        { fields: ['order_number'], unique: true },
        { fields: ['customer_id'] }
    ]
});

module.exports = Order;
