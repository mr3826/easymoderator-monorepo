const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

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
    // Legacy initial-schema PII column retained for compatibility. The Meta
    // deletion path must clear it together with delivery_location/address.
    delivery_area: {
        type: DataTypes.STRING,
        allowNull: true
    },
    delivery_address: {
        type: DataTypes.TEXT,
        allowNull: true,
        get() {
            const raw = this.getDataValue('delivery_address');
            if (!raw) return null;
            try {
                return JSON.parse(raw);
            } catch {
                return raw;
            }
        },
        set(value) {
            this.setDataValue('delivery_address', typeof value === 'object' && value !== null ? JSON.stringify(value) : value);
        }
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
    payment_method_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'payment_configs',
            key: 'id'
        },
        onDelete: 'SET NULL'
    },
    // Bug #12: track when payment was confirmed (null = not yet paid)
    paid_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    note: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    // Legacy initial-schema free-text PII column.
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    // Same order on retry: createOrderInternal looks an order up by this key
    // before creating (the chatbot passes its session id). Without the column
    // on the model, Sequelize emitted raw SQL against a nonexistent column.
    idempotency_key: {
        type: DataTypes.STRING,
        allowNull: true
    },
    usage_transaction_id: {
        type: DataTypes.STRING,
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
