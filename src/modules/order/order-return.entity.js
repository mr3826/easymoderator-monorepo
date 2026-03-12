const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const OrderReturn = sequelize.define('OrderReturn', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    order_id: {
        type: DataTypes.UUID,
        allowNull: false
    },
    customer_id: {
        type: DataTypes.UUID,
        allowNull: false
    },
    reason: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    items: {
        type: DataTypes.JSON,
        defaultValue: []
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    status: {
        type: DataTypes.ENUM('pending_approval', 'approved', 'rejected'),
        defaultValue: 'pending_approval'
    }
}, {
    tableName: 'order_returns',
    underscored: true,
    timestamps: true
});

module.exports = OrderReturn;
