const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const PushSubscription = sequelize.define('PushSubscription', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'shops', key: 'id' },
        onDelete: 'CASCADE'
    },
    user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE'
    },
    type: {
        type: DataTypes.ENUM('web', 'fcm'),
        allowNull: false
    },
    // Web Push (VAPID): the full PushSubscription JSON object from the browser
    subscription_json: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    // FCM: device registration token from firebase-admin
    device_token: {
        type: DataTypes.TEXT,
        allowNull: true
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
    tableName: 'push_subscriptions',
    underscored: true,
    timestamps: true,
    indexes: [
        { fields: ['shop_id'] },
        { fields: ['user_id'] },
        { fields: ['type'] },
        { fields: ['shop_id', 'type'] }
    ]
});

module.exports = PushSubscription;
