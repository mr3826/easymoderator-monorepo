'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const CourierDispatch = sequelize.define('CourierDispatch', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'shops', key: 'id' },
        onDelete: 'CASCADE',
    },
    order_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'orders', key: 'id' },
        onDelete: 'CASCADE',
    },
    provider: {
        type: DataTypes.STRING(50),
        allowNull: false,
    },
    idempotency_key: {
        type: DataTypes.STRING(64),
        allowNull: false,
    },
    status: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: 'PENDING',
    },
    consignment_id: {
        type: DataTypes.STRING(120),
        allowNull: true,
    },
    tracking_code: {
        type: DataTypes.STRING(120),
        allowNull: true,
    },
    error: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
    },
}, {
    tableName: 'courier_dispatch',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            unique: true,
            fields: ['shop_id', 'order_id', 'provider'],
            name: 'idx_courier_dispatch_shop_order_provider',
        },
        { fields: ['shop_id', 'status'] },
        { fields: ['idempotency_key'] },
    ],
});

module.exports = CourierDispatch;
