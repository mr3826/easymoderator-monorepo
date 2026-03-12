const { DataTypes } = require('sequelize');

// Import sequelize from a working path
const { sequelize } = require('../order/order.entity');

const OrderSession = sequelize.define('OrderSession', {
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
    customer_channel_id: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Platform-specific customer ID (sender ID from Meta)'
    },
    channel: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'messenger'
    },
    current_step: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'INITIAL'
    },
    step_data: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {},
        comment: 'Data collected at each step of the order flow'
    },
    product_info: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: null,
        comment: 'Product being ordered (name, variant, price, etc.)'
    },
    status: {
        type: DataTypes.ENUM('ACTIVE', 'COMPLETED', 'CANCELLED', 'ABANDONED'),
        allowNull: false,
        defaultValue: 'ACTIVE'
    },
    automation_mode: {
        type: DataTypes.ENUM('FULL_AUTO', 'DRAFT', 'NOTIFY_ONLY'),
        allowNull: false,
        defaultValue: 'DRAFT'
    },
    confidence_threshold: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 60
    },
    last_activity_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Session expiration time'
    },
    created_order_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'orders',
            key: 'id'
        }
    },
    final_summary: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Final order summary shown to customer'
    },
    metadata: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {}
    }
}, {
    tableName: 'order_sessions',
    underscored: true,
    timestamps: true,
    indexes: [
        { fields: ['shop_id'] },
        { fields: ['customer_id'] },
        { fields: ['customer_channel_id', 'shop_id'] },
        { fields: ['status'] },
        { fields: ['current_step'] },
        { fields: ['last_activity_at'] },
        { fields: ['expires_at'] }
    ]
});

module.exports = OrderSession;
