'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

/** Credit ledger used when a delivered Partner order is reversed after billing. */
const PartnerBillingAdjustment = sequelize.define('PartnerBillingAdjustment', {
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
    order_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'orders', key: 'id' },
        onDelete: 'CASCADE'
    },
    amount_bdt: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    reason: {
        type: DataTypes.STRING(128),
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('pending', 'applied'),
        allowNull: false,
        defaultValue: 'pending'
    },
    invoice_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'invoices', key: 'id' },
        onDelete: 'SET NULL'
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    applied_at: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'partner_billing_adjustments',
    timestamps: false,
    underscored: true,
    indexes: [
        { fields: ['shop_id', 'status', 'created_at'] },
        { unique: true, fields: ['shop_id', 'order_id'] }
    ]
});

module.exports = PartnerBillingAdjustment;
