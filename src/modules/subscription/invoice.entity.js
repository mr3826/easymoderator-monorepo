const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');

const Invoice = sequelize.define('Invoice', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    subscription_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'subscriptions',
            key: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'shops',
            key: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    },
    invoice_number: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    billing_period: {
        type: DataTypes.STRING,
        allowNull: false
    },
    invoice_type: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'Monthly subscription'
    },
    amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0
    },
    base_amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0
    },
    extra_usage_amount: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0
    },
    addon_amount: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0
    },
    status: {
        type: DataTypes.ENUM('pending', 'paid', 'cancelled', 'overdue'),
        allowNull: false,
        defaultValue: 'pending'
    },
    due_date: {
        type: DataTypes.DATE,
        allowNull: false
    },
    paid_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    payment_method: {
        type: DataTypes.STRING,
        allowNull: true
    },
    transaction_id: {
        type: DataTypes.STRING,
        allowNull: true
    },
    notes: {
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
    tableName: 'invoices',
    timestamps: true,
    underscored: true,
    indexes: [
        {
            fields: ['shop_id']
        },
        {
            fields: ['subscription_id']
        },
        {
            fields: ['status']
        },
        {
            fields: ['invoice_number']
        }
    ]
});

module.exports = Invoice;
