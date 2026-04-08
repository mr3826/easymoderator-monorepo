const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const OwnerNotification = sequelize.define('OwnerNotification', {
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
    type: {
        type: DataTypes.STRING(50),
        allowNull: false,
        comment: 'payment_confirmation, order_modification, return_request, escalation'
    },
    customer_message: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Original message from customer'
    },
    customer_data: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'Customer and order related data'
    },
    status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'pending',
        comment: 'pending, completed, expired'
    },
    owner_response: {
        type: DataTypes.STRING(20),
        allowNull: true,
        comment: 'approve, reject, needs_review'
    },
    owner_info: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'Information about who responded'
    },
    responded_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'When owner responded'
    },
    expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'When notification expires'
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
    tableName: 'owner_notifications',
    underscored: true,
    timestamps: true,
    indexes: [
        { fields: ['shop_id'] },
        { fields: ['type'] },
        { fields: ['status'] },
        { fields: ['owner_response'] },
        { fields: ['shop_id', 'status'] },
        { fields: ['shop_id', 'type'] },
        { fields: ['created_at'] },
        { fields: ['expires_at'] }
    ]
});

module.exports = OwnerNotification;
