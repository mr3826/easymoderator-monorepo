const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const Subscription = sequelize.define('Subscription', {
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
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    },
    plan_code: {
        type: DataTypes.STRING(20),
        allowNull: true,
        defaultValue: null
    },
    plan_name: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'Free'
    },
    plan_price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0
    },
    billing_cycle: {
        type: DataTypes.ENUM('monthly', 'yearly', 'per_order'),
        allowNull: false,
        defaultValue: 'monthly'
    },
    // Partner (per_order) billing fields
    billing_model: {
        type: DataTypes.ENUM('flat_monthly', 'per_order'),
        allowNull: false,
        defaultValue: 'flat_monthly'
    },
    // ৳ charged per delivered order (null for flat plans)
    per_order_charge_bdt: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: true,
        defaultValue: null
    },
    // Running count of delivered orders in current weekly billing window
    partner_orders_this_week: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    // Accumulated charge (partner_orders_this_week × per_order_charge_bdt)
    // Reset to 0 after each weekly invoice is generated
    partner_pending_invoice_amount: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0
    },
    status: {
        type: DataTypes.ENUM('active', 'inactive', 'cancelled', 'suspended'),
        allowNull: false,
        defaultValue: 'active'
    },
    // Usage limits
    conversations_limit: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 100
    },
    orders_limit: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 50
    },
    products_limit: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 100
    },
    // Current usage (resets monthly/yearly)
    conversations_used: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    orders_used: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    products_used: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    // Extra usage
    extra_conversations: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    extra_charge: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0
    },
    // Features
    features: {
        type: DataTypes.JSON,
        defaultValue: {
            image_understanding: false,
            advanced_ai: false,
            priority_support: false,
            custom_branding: false
        }
    },
    // Billing dates
    current_period_start: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    current_period_end: {
        type: DataTypes.DATE,
        allowNull: false
    },
    next_billing_date: {
        type: DataTypes.DATE,
        allowNull: false
    },
    trial_ends_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    cancelled_at: {
        type: DataTypes.DATE,
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
    tableName: 'subscriptions',
    timestamps: true,
    underscored: true,
    indexes: [
        {
            unique: true,
            fields: ['shop_id']
        },
        {
            fields: ['status']
        },
        {
            fields: ['next_billing_date']
        }
    ]
});

module.exports = Subscription;
