const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const DeliveryTracking = sequelize.define('DeliveryTracking', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    order_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'orders',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    provider: {
        type: DataTypes.STRING(50),
        allowNull: false,
        comment: 'Delivery provider: pathao, redx, ecourier, manual'
    },
    tracking_number: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: 'Tracking number from provider'
    },
    current_status: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: 'Current delivery status'
    },
    previous_status: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: 'Previous delivery status for tracking changes'
    },
    status_history: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'Array of status changes with timestamps'
    },
    location_info: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'Current location information'
    },
    estimated_delivery: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Estimated delivery date/time'
    },
    actual_delivery: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Actual delivery date/time'
    },
    delivery_agent_info: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'Delivery agent information'
    },
    webhook_received_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Last time webhook was received from provider'
    },
    last_api_check: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Last time API was checked for status'
    },
    customer_notified: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: 'Whether customer has been notified of current status'
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'delivery_tracking',
    underscored: true,
    timestamps: true,
    indexes: [
        { fields: ['order_id'] },
        { fields: ['provider'] },
        { fields: ['tracking_number'] },
        { fields: ['current_status'] },
        { fields: ['webhook_received_at'] },
        { fields: ['last_api_check'] },
        { fields: ['estimated_delivery'] },
        { fields: ['created_at'] }
    ]
});

module.exports = DeliveryTracking;
